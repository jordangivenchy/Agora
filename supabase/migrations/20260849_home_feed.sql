-- ============================================================
-- 20260849_home_feed.sql
--
-- "Your feed" (the signed-in home) + people discovery.
--
--   get_home_feed(p_filter, p_limit, p_before)
--     Ranked stream of live rooms, upcoming rooms, community posts,
--     reposts and (filter='following' only) comments. Security
--     definer: visibility is enforced here (community_visible for
--     boards, public rooms only, blocks both directions), so the
--     client never touches RLS-gated tables directly.
--
--     score = base(kind) × affinity × decay
--       base:      live 100 · scheduled 60 (<24h) / 40 · post 20 ·
--                  repost 10 · comment 5
--       affinity:  max(friend ×4, followed author/host ×3,
--                  my community ×2, else ×1). Own items ×1.
--       decay:     1/(1 + hours_old/6); live rooms don't decay;
--                  scheduled rooms use 1/(1 + hours_until_start/12).
--     Filters: 'all' | 'following' | 'communities' | 'popular'.
--       'all' also includes every public live room at a flat 50 so the
--       Live rail is never empty (reason 'Live now').
--       'popular' ignores affinity: public posts ranked by
--       base × (1 + votes + comments/2) × decay, plus all live rooms
--       ranked by viewers.
--     Pagination: the page is ordered by score desc. "Load more"
--       passes p_before = min(created_at) seen so far; only posts /
--       reposts / comments created before that cursor are considered
--       (live + scheduled rooms belong to the first page only). Items
--       can therefore shift between pages as scores decay — accepted
--       for a feed at beta scale.
--
--   feed_post_payload(p_post)   internal — one post as the exact column
--     set get_community_posts returns (+ community_avatar_url /
--     community_color) so PostCard renders feed rows unchanged.
--   get_people_suggestions(p_limit)  who to follow, with a reason.
--   get_active_hosts(p_limit)        hosts of live rooms, last 14 days.
--   get_following(p_user, p_limit, p_offset)  who someone follows.
--
-- Idempotent: every object is create-or-replace / drop-if-exists.
-- ============================================================

-- ─── Post payload (internal) ────────────────────────────────
create or replace function public.feed_post_payload(p_post uuid)
returns jsonb
language sql stable security definer
set search_path to 'public'
as $$
  select to_jsonb(x) from (
    select
      p.id, p.community_id, c.name as community_name, p.author_id,
      coalesce(u.username, '(deleted)') as author_username,
      p.title, p.body, p.created_at,
      coalesce(v.score, 0) as score, mv.value as my_vote, coalesce(cc.n, 0) as comment_count,
      u.display_name as author_display_name,
      p.image_url, p.tag_id, t.name as tag_name, t.color as tag_color,
      (select cm.role from public.community_members cm
        where cm.community_id = p.community_id and cm.user_id = p.author_id) as author_role,
      p.is_repost,
      case when ov.visible then p.repost_of end as repost_of,
      case when ov.visible then op.title end as orig_title,
      case when ov.visible then op.body end as orig_body,
      case when ov.visible then op.image_url end as orig_image_url,
      case when ov.visible then oc.name end as orig_community_name,
      case when ov.visible then coalesce(ou.username, '(deleted)') end as orig_author_username,
      case when ov.visible then ou.display_name end as orig_author_display_name,
      p.pinned_at,
      c.avatar_url as community_avatar_url,
      c.color as community_color,
      u.avatar_url as author_avatar_url
    from public.community_posts p
    join public.communities c on c.id = p.community_id
    left join public.users u on u.id = p.author_id
    left join public.community_tags t on t.id = p.tag_id
    left join public.community_posts op on op.id = p.repost_of
    left join public.users ou on ou.id = op.author_id
    left join public.communities oc on oc.id = op.community_id
    left join lateral (
      select op.id is not null
         and public.community_visible(op.community_id, auth.uid()) as visible
    ) ov on true
    left join lateral (
      select sum(value)::bigint as score
      from public.community_post_votes where post_id = p.id
    ) v on true
    left join public.community_post_votes mv
      on mv.post_id = p.id and mv.user_id = auth.uid()
    left join lateral (
      select count(*)::bigint as n from public.community_comments where post_id = p.id
    ) cc on true
    where p.id = p_post
  ) x;
$$;
revoke all on function public.feed_post_payload(uuid) from public, anon, authenticated;

-- ─── Room payload (internal) — the shape RoomCard needs ──────
create or replace function public.feed_room_payload(p_room uuid)
returns jsonb
language sql stable security definer
set search_path to 'public'
as $$
  select jsonb_build_object(
    'id', r.id,
    'motion', r.motion,
    'topic_key', r.topic_key,
    'status', r.status,
    'format', r.format,
    'scheduled_start', r.scheduled_start,
    'viewer_count', coalesce(r.viewer_count, 0),
    'thumbnail_url', r.thumbnail_url,
    'created_at', r.created_at,
    'host', case when h.id is null then null else jsonb_build_object(
      'id', h.id, 'username', h.username, 'display_name', h.display_name, 'avatar_url', h.avatar_url) end,
    'community', case when c.id is null then null else jsonb_build_object(
      'id', c.id, 'name', c.name, 'color', c.color) end,
    'speakers', (select count(*) from public.debate_participants dp
                  where dp.room_id = r.id and dp.left_at is null and dp.role = 'debater'),
    'reminder_count', (select count(*) from public.room_reminders rr where rr.room_id = r.id),
    'am_set', exists (select 1 from public.room_reminders rr
                       where rr.room_id = r.id and rr.user_id = auth.uid())
  )
  from public.debate_rooms r
  left join public.users h on h.id = r.host_id
  left join public.communities c on c.id = r.community_id
  where r.id = p_room;
$$;
revoke all on function public.feed_room_payload(uuid) from public, anon, authenticated;

-- ─── The feed ────────────────────────────────────────────────
drop function if exists public.get_home_feed(text, integer, timestamptz);
create function public.get_home_feed(
  p_filter text default 'all',
  p_limit integer default 40,
  p_before timestamptz default null
)
returns table(
  kind text, item_id uuid, score numeric, created_at timestamptz,
  reason text, payload jsonb
)
language sql stable security definer
set search_path to 'public'
as $$
  with
  me as (select auth.uid() as uid),
  flt as (
    select case when p_filter in ('all', 'following', 'communities', 'popular')
                then p_filter else 'all' end as f
  ),
  followed as (
    select uf.following_id as uid, u.username
    from public.user_follows uf
    join public.users u on u.id = uf.following_id, me
    where uf.follower_id = me.uid
  ),
  friends as (
    select a.following_id as uid, u.username
    from public.user_follows a
    join public.user_follows b
      on b.follower_id = a.following_id and b.following_id = a.follower_id
    join public.users u on u.id = a.following_id, me
    where a.follower_id = me.uid
  ),
  blocked as (
    select ub.blocked_id as uid from public.user_blocks ub, me where ub.blocker_id = me.uid
    union
    select ub.blocker_id from public.user_blocks ub, me where ub.blocked_id = me.uid
  ),
  mycomms as (
    select cm.community_id as cid, c.name
    from public.community_members cm
    join public.communities c on c.id = cm.community_id, me
    where cm.user_id = me.uid
  ),

  -- Candidate rooms with their relationship flags.
  rooms as (
    select r.id, r.host_id, r.status, r.scheduled_start, r.created_at,
           coalesce(r.viewer_count, 0) as viewers,
           (r.host_id = me.uid) as mine,
           fr.username as friend_name,
           fo.username as followed_name,
           exists (
             select 1 from public.debate_participants dp
             where dp.room_id = r.id and dp.left_at is null
               and dp.user_id in (select uid from followed)
           ) as speaker_followed,
           mc.name as my_comm_name
    from public.debate_rooms r
    cross join me
    left join friends fr on fr.uid = r.host_id
    left join followed fo on fo.uid = r.host_id
    left join mycomms mc on mc.cid = r.community_id
    where r.status in ('live', 'scheduled', 'created')
      and coalesce(r.is_private, false) = false
      and r.host_id not in (select uid from blocked)
      and (r.community_id is null or public.community_visible(r.community_id, me.uid))
      and p_before is null            -- rooms: first page only
  ),
  room_scored as (
    select rs.*,
      case when rs.mine then 1
           else greatest(case when rs.friend_name is not null then 4 else 1 end,
                         case when rs.followed_name is not null or rs.speaker_followed then 3 else 1 end,
                         case when rs.my_comm_name is not null then 2 else 1 end) end as aff,
      (rs.friend_name is not null or rs.followed_name is not null
        or rs.speaker_followed or rs.my_comm_name is not null) as connected,
      case when rs.mine then 'Your room'
           when rs.friend_name is not null then 'Because you''re friends with @' || rs.friend_name
           when rs.followed_name is not null then 'Because you follow @' || rs.followed_name
           when rs.speaker_followed then 'Because you follow a speaker'
           when rs.my_comm_name is not null then 'From ' || rs.my_comm_name
           else null end as why
    from rooms rs
  ),

  live_items as (
    select 'live'::text as kind, r.id as item_id,
      case when f.f = 'popular' then (100 + r.viewers)::numeric
           when r.connected or r.mine then (100 * r.aff)::numeric
           else 50::numeric end as score,
      r.created_at,
      coalesce(r.why, 'Live now') as reason,
      public.feed_room_payload(r.id) as payload
    from room_scored r, flt f
    where r.status = 'live'
      and (f.f in ('all', 'popular')
        or (f.f = 'following' and (r.friend_name is not null or r.followed_name is not null or r.speaker_followed))
        or (f.f = 'communities' and r.my_comm_name is not null))
  ),

  sched_items as (
    select 'scheduled'::text as kind, r.id as item_id,
      (case when r.scheduled_start < now() + interval '24 hours' then 60 else 40 end
        * r.aff
        / (1 + greatest(extract(epoch from (r.scheduled_start - now())) / 3600.0, 0) / 12.0))::numeric as score,
      r.created_at,
      coalesce(r.why, 'Coming up') as reason,
      public.feed_room_payload(r.id) as payload
    from room_scored r, flt f
    where r.status <> 'live'
      and r.scheduled_start between now() and now() + interval '7 days'
      and (
        (f.f = 'all' and (r.connected or r.mine))
        or (f.f = 'following' and (r.friend_name is not null or r.followed_name is not null))
        or (f.f = 'communities' and r.my_comm_name is not null)
      )
  ),

  posts as (
    select p.id, p.community_id, p.author_id, p.is_repost, p.created_at,
      c.name as community_name, c.is_private,
      (p.author_id = me.uid) as mine,
      fr.username as friend_name,
      fo.username as followed_name,
      mc.name as my_comm_name,
      coalesce((select sum(value) from public.community_post_votes v where v.post_id = p.id), 0) as votes,
      (select count(*) from public.community_comments cc where cc.post_id = p.id) as comments
    from public.community_posts p
    join public.communities c on c.id = p.community_id
    cross join me
    left join friends fr on fr.uid = p.author_id
    left join followed fo on fo.uid = p.author_id
    left join mycomms mc on mc.cid = p.community_id
    where p.created_at > now() - interval '30 days'
      and (p_before is null or p.created_at < p_before)
      and (p.author_id is null or p.author_id not in (select uid from blocked))
      and public.community_visible(p.community_id, me.uid)
  ),
  post_items as (
    select case when p.is_repost then 'repost' else 'post' end as kind,
      p.id as item_id,
      (case when p.is_repost then 10 else 20 end
        * case when f.f = 'popular'
               then 1 + greatest(p.votes, 0) + p.comments / 2.0
               when p.mine then 1
               else greatest(case when p.friend_name is not null then 4 else 1 end,
                             case when p.followed_name is not null then 3 else 1 end,
                             case when p.my_comm_name is not null then 2 else 1 end) end
        / (1 + extract(epoch from (now() - p.created_at)) / 3600.0 / 6.0))::numeric as score,
      p.created_at,
      case when f.f = 'popular' then 'Popular in ' || p.community_name
           when p.mine then 'Your post'
           when p.friend_name is not null then 'Because you''re friends with @' || p.friend_name
           when p.followed_name is not null then 'Because you follow @' || p.followed_name
           when p.my_comm_name is not null then 'From ' || p.my_comm_name
           else 'Popular in ' || p.community_name end as reason,
      public.feed_post_payload(p.id) as payload
    from posts p, flt f
    where (f.f = 'all')
       or (f.f = 'following' and (p.friend_name is not null or p.followed_name is not null))
       or (f.f = 'communities' and p.my_comm_name is not null)
       or (f.f = 'popular' and not coalesce(p.is_private, false))
  ),

  comment_items as (
    select 'comment'::text as kind, cm.id as item_id,
      (5 * greatest(case when fr.uid is not null then 4 else 1 end, 3)
        / (1 + extract(epoch from (now() - cm.created_at)) / 3600.0 / 6.0))::numeric as score,
      cm.created_at,
      case when fr.uid is not null then 'Because you''re friends with @' || fr.username
           else 'Because you follow @' || fo.username end as reason,
      jsonb_build_object(
        'id', cm.id,
        'post_id', cm.post_id,
        'post_title', p.title,
        'body', left(cm.body, 280),
        'created_at', cm.created_at,
        'community_name', c.name,
        'author', jsonb_build_object('id', u.id, 'username', u.username,
                                     'display_name', u.display_name, 'avatar_url', u.avatar_url)
      ) as payload
    from public.community_comments cm
    join followed fo on fo.uid = cm.author_id
    left join friends fr on fr.uid = cm.author_id
    join public.community_posts p on p.id = cm.post_id
    join public.communities c on c.id = p.community_id
    join public.users u on u.id = cm.author_id
    cross join me
    cross join flt f
    where f.f = 'following'
      and cm.created_at > now() - interval '14 days'
      and (p_before is null or cm.created_at < p_before)
      and cm.author_id not in (select uid from blocked)
      and public.community_visible(p.community_id, me.uid)
  ),

  everything as (
    select * from live_items
    union all select * from sched_items
    union all select * from post_items
    union all select * from comment_items
  )
  select e.kind, e.item_id, round(e.score, 4), e.created_at, e.reason, e.payload
  from everything e, me
  where me.uid is not null or (select f from flt) = 'popular'
  order by
    case e.kind when 'live' then 0 else 1 end,
    e.score desc,
    e.created_at desc
  limit greatest(1, least(coalesce(p_limit, 40), 100));
$$;
revoke all on function public.get_home_feed(text, integer, timestamptz) from public;
-- anon may call it, but every branch except 'popular' returns nothing
-- without auth.uid() (see the final where clause).
grant execute on function public.get_home_feed(text, integer, timestamptz) to anon, authenticated;

-- ─── Who to follow ───────────────────────────────────────────
drop function if exists public.get_people_suggestions(integer);
create function public.get_people_suggestions(p_limit integer default 8)
returns table(
  id uuid, username text, display_name text, avatar_url text, verified boolean,
  reason text, mutual_count bigint, debates_30d bigint
)
language sql stable security definer
set search_path to 'public'
as $$
  with
  me as (select auth.uid() as uid),
  followed as (select uf.following_id as uid from public.user_follows uf, me where uf.follower_id = me.uid),
  friends as (
    select a.following_id as uid
    from public.user_follows a
    join public.user_follows b on b.follower_id = a.following_id and b.following_id = a.follower_id, me
    where a.follower_id = me.uid
  ),
  blocked as (
    select ub.blocked_id as uid from public.user_blocks ub, me where ub.blocker_id = me.uid
    union
    select ub.blocker_id from public.user_blocks ub, me where ub.blocked_id = me.uid
  ),
  mycomms as (select cm.community_id as cid from public.community_members cm, me where cm.user_id = me.uid),
  cand as (
    select u.id, u.username, u.display_name, u.avatar_url, coalesce(u.verified, false) as verified,
      u.created_at,
      -- people I follow who follow them
      (select count(*) from public.user_follows x
        where x.following_id = u.id and x.follower_id in (select uid from followed)) as mutual_count,
      (select mu.username from public.user_follows x
        join public.users mu on mu.id = x.follower_id
        where x.following_id = u.id and x.follower_id in (select uid from followed)
        order by x.created_at desc limit 1) as mutual_name,
      (select count(*) from public.debate_rooms r
        where r.host_id = u.id and coalesce(r.is_private, false) = false
          and r.created_at > now() - interval '30 days') as debates_30d,
      (select r.topic_key from public.debate_rooms r
        where r.host_id = u.id and coalesce(r.is_private, false) = false
          and r.created_at > now() - interval '30 days'
        group by r.topic_key order by count(*) desc limit 1) as top_topic,
      exists (select 1 from public.user_follows x
        where x.following_id = u.id and x.follower_id in (select uid from friends)) as fof,
      (select c.name from public.community_members cm
        join public.communities c on c.id = cm.community_id
        where cm.user_id = u.id and cm.community_id in (select cid from mycomms)
        order by cm.joined_at desc limit 1) as shared_comm,
      (select count(*) from public.user_follows x where x.following_id = u.id) as followers
    from public.users u, me
    where me.uid is not null
      and u.id <> me.uid
      and u.username is not null
      and u.id not in (select uid from followed)
      and u.id not in (select uid from blocked)
      and coalesce(u.suspended_until, '-infinity'::timestamptz) < now()
  ),
  scored as (
    select c.*,
      (c.mutual_count * 3 + c.debates_30d * 2
        + case when c.fof then 1 else 0 end
        + case when c.shared_comm is not null then 1 else 0 end) as score
    from cand c
  )
  select s.id, s.username, s.display_name, s.avatar_url, s.verified,
    case
      when s.mutual_count > 0 then
        'Followed by @' || s.mutual_name
        || case when s.mutual_count > 1
                then ' and ' || (s.mutual_count - 1) || case when s.mutual_count = 2 then ' other' else ' others' end
                else '' end
      when s.debates_30d > 0 then
        'Hosts debates in ' || case s.top_topic
          when 'politics-law' then 'Politics & Law'
          when 'sports' then 'Sports'
          when 'culture' then 'Culture'
          when 'economics' then 'Economics'
          when 'science-tech' then 'Science & Tech'
          when 'foreign-policy' then 'Foreign Policy'
          when 'philosophy' then 'Philosophy'
          else coalesce(s.top_topic, 'the Agora') end
      when s.shared_comm is not null then 'In ' || s.shared_comm || ' with you'
      when s.fof then 'Friend of a friend'
      when s.followers > 0 then 'Popular on AgoraSphere'
      else 'New on AgoraSphere'
    end as reason,
    s.mutual_count::bigint, s.debates_30d::bigint
  from scored s
  order by s.score desc, s.followers desc, s.created_at desc
  limit greatest(1, least(coalesce(p_limit, 8), 50));
$$;
revoke all on function public.get_people_suggestions(integer) from public, anon;
grant execute on function public.get_people_suggestions(integer) to authenticated;

-- ─── Active hosts (last 14 days) ─────────────────────────────
drop function if exists public.get_active_hosts(integer);
create function public.get_active_hosts(p_limit integer default 12)
returns table(
  id uuid, username text, display_name text, avatar_url text, verified boolean,
  rooms_14d bigint, live_now boolean, is_following boolean
)
language sql stable security definer
set search_path to 'public'
as $$
  with me as (select auth.uid() as uid),
  blocked as (
    select ub.blocked_id as uid from public.user_blocks ub, me where ub.blocker_id = me.uid
    union
    select ub.blocker_id from public.user_blocks ub, me where ub.blocked_id = me.uid
  )
  select u.id, u.username, u.display_name, u.avatar_url, coalesce(u.verified, false),
    count(r.id)::bigint as rooms_14d,
    bool_or(r.status = 'live') as live_now,
    exists (select 1 from public.user_follows f, me
             where f.follower_id = me.uid and f.following_id = u.id) as is_following
  from public.debate_rooms r
  join public.users u on u.id = r.host_id
  where coalesce(r.is_private, false) = false
    and r.status in ('live', 'ended')
    and coalesce(r.started_at, r.created_at) > now() - interval '14 days'
    and u.username is not null
    and u.id not in (select uid from blocked)
  group by u.id, u.username, u.display_name, u.avatar_url, u.verified
  order by rooms_14d desc, live_now desc, max(coalesce(r.started_at, r.created_at)) desc
  limit greatest(1, least(coalesce(p_limit, 12), 50));
$$;
revoke all on function public.get_active_hosts(integer) from public;
grant execute on function public.get_active_hosts(integer) to anon, authenticated;

-- ─── Following list ──────────────────────────────────────────
drop function if exists public.get_following(uuid, integer, integer);
create function public.get_following(
  p_user uuid, p_limit integer default 50, p_offset integer default 0
)
returns table(
  id uuid, username text, display_name text, avatar_url text, verified boolean,
  followed_at timestamptz
)
language sql stable security definer
set search_path to 'public'
as $$
  select u.id, u.username, u.display_name, u.avatar_url, coalesce(u.verified, false), f.created_at
  from public.user_follows f
  join public.users u on u.id = f.following_id
  where f.follower_id = p_user
    and u.username is not null
  order by f.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 200))
  offset greatest(0, coalesce(p_offset, 0));
$$;
revoke all on function public.get_following(uuid, integer, integer) from public;
grant execute on function public.get_following(uuid, integer, integer) to anon, authenticated;
