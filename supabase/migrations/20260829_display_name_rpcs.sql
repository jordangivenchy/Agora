-- Display names in every social RPC + a single-post fetch.
-- The UI prefers users.display_name (falling back to @username) everywhere;
-- these functions predate the column. Return types change, so drop+recreate.
-- Applied to the live DB on 2026-08-17.

drop function if exists public.search_users(text);
create function public.search_users(p_query text)
returns table(id uuid, username text, avatar_url text, bio text, display_name text)
language sql stable security definer
set search_path to 'public'
as $$
  with q as (
    select lower(trim(coalesce(p_query, ''))) as needle
  )
  select u.id, u.username, u.avatar_url, u.bio, u.display_name
  from public.users u, q
  where q.needle <> ''
    and u.id <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid)
    and (
      lower(u.username) like q.needle || '%'
      or lower(coalesce(u.display_name, '')) like q.needle || '%'
      or lower(coalesce(u.display_name, '')) like '% ' || q.needle || '%'
    )
  order by (lower(u.username) like q.needle || '%') desc,
           length(u.username) asc, u.username asc
  limit 10;
$$;
grant execute on function public.search_users(text) to anon, authenticated;

drop function if exists public.get_friends(uuid);
create function public.get_friends(p_user uuid default null::uuid)
returns table(id uuid, username text, avatar_url text, bio text, since timestamptz, display_name text)
language sql stable security definer
set search_path to 'public'
as $$
  with target as (select coalesce(p_user, auth.uid()) as uid)
  select
    u.id, u.username, u.avatar_url, u.bio,
    greatest(a.created_at, b.created_at) as since,
    u.display_name
  from target
  join public.user_follows a on a.follower_id  = target.uid       -- me → them
  join public.user_follows b on b.follower_id  = a.following_id   -- them → me
                            and b.following_id = target.uid
  join public.users u on u.id = a.following_id
  order by since desc;
$$;
grant execute on function public.get_friends(uuid) to anon, authenticated;

drop function if exists public.get_followers(uuid);
create function public.get_followers(p_user uuid)
returns table(id uuid, username text, avatar_url text, bio text, i_am_following boolean, display_name text)
language sql stable security definer
set search_path to 'public'
as $$
  select
    u.id, u.username, u.avatar_url, u.bio,
    exists (
      select 1 from public.user_follows me
      where me.follower_id = auth.uid() and me.following_id = u.id
    ) as i_am_following,
    u.display_name
  from public.user_follows f
  join public.users u on u.id = f.follower_id
  where f.following_id = p_user
  order by f.created_at desc;
$$;
grant execute on function public.get_followers(uuid) to anon, authenticated;

drop function if exists public.get_following(uuid);
create function public.get_following(p_user uuid)
returns table(id uuid, username text, avatar_url text, bio text, i_am_following boolean, display_name text)
language sql stable security definer
set search_path to 'public'
as $$
  select
    u.id, u.username, u.avatar_url, u.bio,
    exists (
      select 1 from public.user_follows me
      where me.follower_id = auth.uid() and me.following_id = u.id
    ) as i_am_following,
    u.display_name
  from public.user_follows f
  join public.users u on u.id = f.following_id
  where f.follower_id = p_user
  order by f.created_at desc;
$$;
grant execute on function public.get_following(uuid) to anon, authenticated;

drop function if exists public.get_community_posts(uuid, text, integer);
create function public.get_community_posts(p_community uuid default null, p_sort text default 'new', p_limit integer default 50)
returns table(
  id uuid, community_id uuid, community_name text, author_id uuid,
  author_username text, title text, body text, created_at timestamptz,
  score bigint, my_vote smallint, comment_count bigint, author_display_name text
)
language sql stable security definer
set search_path to 'public'
as $$
  select
    p.id, p.community_id, c.name, p.author_id,
    coalesce(u.username, '(deleted)'), p.title, p.body, p.created_at,
    coalesce(v.score, 0), mv.value, coalesce(cc.n, 0),
    u.display_name
  from public.community_posts p
  join public.communities c on c.id = p.community_id
  left join public.users u on u.id = p.author_id
  left join lateral (
    select sum(value)::bigint as score from public.community_post_votes
    where post_id = p.id
  ) v on true
  left join public.community_post_votes mv
    on mv.post_id = p.id and mv.user_id = auth.uid()
  left join lateral (
    select count(*)::bigint as n from public.community_comments
    where post_id = p.id
  ) cc on true
  where (p_community is null or p.community_id = p_community)
  order by
    case when p_sort = 'top' then coalesce(v.score, 0) end desc nulls last,
    p.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 100));
$$;
grant execute on function public.get_community_posts(uuid, text, integer) to anon, authenticated;

-- Single post, same row shape — used by search deep-links so vote totals
-- are real even when the post is outside the feed's loaded page.
drop function if exists public.get_community_post(uuid);
create function public.get_community_post(p_post uuid)
returns table(
  id uuid, community_id uuid, community_name text, author_id uuid,
  author_username text, title text, body text, created_at timestamptz,
  score bigint, my_vote smallint, comment_count bigint, author_display_name text
)
language sql stable security definer
set search_path to 'public'
as $$
  select
    p.id, p.community_id, c.name, p.author_id,
    coalesce(u.username, '(deleted)'), p.title, p.body, p.created_at,
    coalesce(v.score, 0), mv.value, coalesce(cc.n, 0),
    u.display_name
  from public.community_posts p
  join public.communities c on c.id = p.community_id
  left join public.users u on u.id = p.author_id
  left join lateral (
    select sum(value)::bigint as score from public.community_post_votes
    where post_id = p.id
  ) v on true
  left join public.community_post_votes mv
    on mv.post_id = p.id and mv.user_id = auth.uid()
  left join lateral (
    select count(*)::bigint as n from public.community_comments
    where post_id = p.id
  ) cc on true
  where p.id = p_post;
$$;
grant execute on function public.get_community_post(uuid) to anon, authenticated;

drop function if exists public.get_post_comments(uuid);
create function public.get_post_comments(p_post uuid)
returns table(
  id uuid, post_id uuid, parent_id uuid, author_id uuid, author_username text,
  body text, created_at timestamptz, score bigint, my_vote smallint, author_display_name text
)
language sql stable security definer
set search_path to 'public'
as $$
  select
    c.id, c.post_id, c.parent_id, c.author_id,
    coalesce(u.username, '(deleted)'), c.body, c.created_at,
    coalesce(v.score, 0), mv.value,
    u.display_name
  from public.community_comments c
  left join public.users u on u.id = c.author_id
  left join lateral (
    select sum(value)::bigint as score from public.community_comment_votes
    where comment_id = c.id
  ) v on true
  left join public.community_comment_votes mv
    on mv.comment_id = c.id and mv.user_id = auth.uid()
  where c.post_id = p_post
  order by c.created_at asc;
$$;
grant execute on function public.get_post_comments(uuid) to anon, authenticated;

drop function if exists public.get_dm_threads();
create function public.get_dm_threads()
returns table(
  peer_id uuid, peer_username text, peer_avatar_url text, last_content text,
  last_at timestamptz, last_from_me boolean, unread bigint, peer_display_name text
)
language sql stable security definer
set search_path to 'public'
as $$
  with mine as (
    select *,
      case when sender_id = auth.uid() then recipient_id else sender_id end as peer
    from direct_messages
    where auth.uid() in (sender_id, recipient_id)
  ),
  latest as (
    select distinct on (peer) peer, content, created_at, sender_id
    from mine
    order by peer, created_at desc
  )
  select
    l.peer, u.username, u.avatar_url, l.content, l.created_at,
    l.sender_id = auth.uid(),
    (select count(*) from mine m
      where m.peer = l.peer and m.recipient_id = auth.uid() and m.read_at is null),
    u.display_name
  from latest l
  join users u on u.id = l.peer
  order by l.created_at desc;
$$;
grant execute on function public.get_dm_threads() to authenticated;

drop function if exists public.get_notifications(integer);
create function public.get_notifications(p_limit integer default 30)
returns table(
  id uuid, type text, actor_id uuid, actor_username text, room_id uuid,
  room_motion text, read_at timestamptz, created_at timestamptz, actor_display_name text
)
language sql stable security definer
set search_path to 'public'
as $$
  select
    n.id, n.type, n.actor_id,
    u.username, n.room_id, r.motion, n.read_at, n.created_at,
    u.display_name
  from public.notifications n
  left join public.users u on u.id = n.actor_id
  left join public.debate_rooms r on r.id = n.room_id
  where n.user_id = auth.uid()
  order by n.created_at desc
  limit greatest(1, least(coalesce(p_limit, 30), 100));
$$;
grant execute on function public.get_notifications(integer) to authenticated;
