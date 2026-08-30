-- Blocking a community is supposed to hide it from the aggregate home
-- feed (20260867's stated behavior), but get_home_feed never consulted
-- community_blocks — a blocked public board's posts (and rooms/comments)
-- kept appearing. Found by the launch-QA role-simulation pass.
--
-- Fix: a blocked_comms CTE, filtered in the rooms, posts, and
-- comment_items CTEs. Everything else is unchanged from the deployed
-- definition (which matches 20260871's replay feed).

create or replace function public.get_home_feed(
  p_filter text default 'all',
  p_limit integer default 40,
  p_before timestamptz default null
)
returns table(kind text, item_id uuid, score numeric, created_at timestamptz, reason text, payload jsonb)
language sql
stable security definer
set search_path to 'public'
as $function$
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
  blocked_comms as (
    select cb.community_id as cid
    from public.community_blocks cb, me
    where cb.user_id = me.uid
  ),
  mycomms as (
    select cm.community_id as cid, c.name
    from public.community_members cm
    join public.communities c on c.id = cm.community_id, me
    where cm.user_id = me.uid
  ),
  rooms as (
    select r.id, r.host_id, r.status, r.scheduled_start, r.created_at, r.ended_at,
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
    where coalesce(r.is_private, false) = false
      and r.host_id not in (select uid from blocked)
      and (r.community_id is null or public.community_visible(r.community_id, me.uid))
      and (r.community_id is null or r.community_id not in (select cid from blocked_comms))
      and (
        (r.status in ('live', 'scheduled', 'created') and p_before is null)
        or (r.status = 'ended' and r.recording_url is not null
            and (p_before is null or coalesce(r.ended_at, r.created_at) < p_before))
      )
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
  replay_items as (
    select 'replay'::text as kind, r.id as item_id,
      (18 * (case when f.f = 'popular' then 1 + r.viewers
                  when r.mine then 1
                  else r.aff end)
        / (1 + extract(epoch from (now() - coalesce(r.ended_at, r.created_at))) / 3600.0 / 12.0))::numeric as score,
      coalesce(r.ended_at, r.created_at) as created_at,
      coalesce(r.why, 'Replay') as reason,
      public.feed_room_payload(r.id) as payload
    from room_scored r, flt f
    where r.status = 'ended'
      and (
        f.f in ('all', 'popular')
        or (f.f = 'following' and (r.friend_name is not null or r.followed_name is not null or r.speaker_followed))
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
      and p.community_id not in (select cid from blocked_comms)
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
      and p.community_id not in (select cid from blocked_comms)
      and public.community_visible(p.community_id, me.uid)
  ),
  everything as (
    select * from live_items
    union all select * from sched_items
    union all select * from replay_items
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
$function$;
