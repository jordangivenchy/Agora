-- ============================================================
-- 20260843_profile_v2.sql
--
-- Profile v2: banners, social links, and richer profile reads.
--
--   1. users.banner_url / users.social_links — profile cosmetics.
--      social_links is a jsonb array of https URLs; the shape is
--      constraint-enforced at the column and validated in depth by
--      update_profile_extras (clients never write the row directly).
--   2. update_profile_extras — caller-only writes, same null/empty
--      semantics as update_profile: null leaves a field unchanged,
--      empty-string banner clears it. Links are trimmed and must be
--      1..200 chars, http(s), at most 5 — server-side, so a hostile
--      client can't stash javascript: URLs for other profiles to
--      render.
--   3. get_user_profile v4 — adds banner/links, karma (aggregate
--      only: individual ballots stay private, same posture as the
--      community feed RPCs), the user's current live room (only
--      rooms with status = 'live' where they are actively seated —
--      no history leaks), and up to 3 mutual follows relative to
--      the CALLER (anon callers naturally get none via auth.uid()).
--   4. get_user_comments — a profile tab over community_comments,
--      gated per-row on community_visible() so private-board
--      activity never leaks off the board.
--   5. get_user_communities — memberships, same visibility gate:
--      belonging to a private board is only shown to people who can
--      see that board anyway.
-- ============================================================

-- ─── 1. columns ──────────────────────────────────────────────
alter table public.users add column if not exists banner_url text;
alter table public.users add column if not exists social_links jsonb not null default '[]'::jsonb;

alter table public.users drop constraint if exists users_social_links_is_array;
alter table public.users add constraint users_social_links_is_array
  check (jsonb_typeof(social_links) = 'array');

-- ─── 2. update_profile_extras ────────────────────────────────
-- Writes ONLY the caller's row. null = leave unchanged; empty-string
-- banner clears. Link validation happens here (definer) because the
-- column constraint alone can't check element shape.
create or replace function public.update_profile_extras(
  p_banner_url   text,
  p_social_links jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me    uuid := auth.uid();
  v_clean jsonb;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if p_banner_url is not null then
    if char_length(p_banner_url) > 500 then
      raise exception 'banner_url_too_long' using errcode = '22023';
    end if;
    update public.users
       set banner_url = nullif(btrim(p_banner_url), '')
     where id = v_me;
  end if;

  if p_social_links is not null then
    if jsonb_typeof(p_social_links) <> 'array' then
      raise exception 'social_links_not_array' using errcode = '22023';
    end if;
    if jsonb_array_length(p_social_links) > 5 then
      raise exception 'too_many_links' using errcode = '22023';
    end if;
    if exists (
      select 1 from jsonb_array_elements(p_social_links) e
      where jsonb_typeof(e.value) <> 'string'
         or char_length(btrim(e.value #>> '{}')) not between 1 and 200
         or btrim(e.value #>> '{}') !~ '^https?://'
    ) then
      raise exception 'invalid_link' using errcode = '22023';
    end if;

    -- store the trimmed form so the client renders exactly what passed
    select coalesce(jsonb_agg(to_jsonb(btrim(e.value #>> '{}'))), '[]'::jsonb)
      into v_clean
      from jsonb_array_elements(p_social_links) e;

    update public.users set social_links = v_clean where id = v_me;
  end if;
end;
$$;

revoke all on function public.update_profile_extras(text, jsonb) from public, anon;
grant execute on function public.update_profile_extras(text, jsonb) to authenticated;

-- ─── 3. get_user_profile v4 ──────────────────────────────────
-- Return-type change = drop+create; grants restored to the audited
-- state (anon + authenticated + service_role). All v3 columns are
-- preserved; banner_url, social_links, karma, live_room_*, and
-- mutual_names are appended.
drop function if exists public.get_user_profile(uuid);

create function public.get_user_profile(p_user uuid)
returns table(
  id uuid, username text, display_name text, avatar_url text, bio text,
  created_at timestamptz, username_changed_at timestamptz,
  follower_count bigint, following_count bigint,
  is_following boolean, is_followed_by boolean, is_friend boolean,
  verified boolean,
  banner_url text, social_links jsonb,
  karma bigint,
  live_room_id uuid, live_room_motion text,
  mutual_names text[]
)
language sql stable security definer set search_path = public
as $$
  with me as (select auth.uid() as uid)
  select
    u.id,
    u.username,
    u.display_name,
    u.avatar_url,
    u.bio,
    u.created_at,
    u.username_changed_at,
    (select count(*) from public.user_follows f where f.following_id = u.id) as follower_count,
    (select count(*) from public.user_follows f where f.follower_id  = u.id) as following_count,
    exists(
      select 1 from public.user_follows f, me
      where f.follower_id = me.uid and f.following_id = u.id
    ) as is_following,
    exists(
      select 1 from public.user_follows f, me
      where f.follower_id = u.id and f.following_id = me.uid
    ) as is_followed_by,
    exists(
      select 1 from public.user_follows a, public.user_follows b, me
      where a.follower_id  = me.uid and a.following_id = u.id
        and b.follower_id  = u.id   and b.following_id = me.uid
    ) as is_friend,
    u.verified,
    u.banner_url,
    u.social_links,
    -- karma: aggregate score across the user's posts and comments.
    -- Only sums leave the DB; individual ballots stay private.
    (
      coalesce((
        select sum(v.value)::bigint
        from public.community_post_votes v
        join public.community_posts p on p.id = v.post_id
        where p.author_id = u.id
      ), 0)
      +
      coalesce((
        select sum(v.value)::bigint
        from public.community_comment_votes v
        join public.community_comments c on c.id = v.comment_id
        where c.author_id = u.id
      ), 0)
    ) as karma,
    live.room_id  as live_room_id,
    live.motion   as live_room_motion,
    -- mutuals: people the CALLER follows who follow p_user. Empty
    -- for anon (uid null) and for your own profile.
    coalesce((
      select array_agg(m.username)
      from (
        select mu.username
        from me
        join public.user_follows a on a.follower_id = me.uid
        join public.user_follows b
          on b.follower_id = a.following_id and b.following_id = u.id
        join public.users mu on mu.id = a.following_id
        where me.uid is distinct from u.id
          and a.following_id <> u.id
          and a.following_id <> me.uid
        order by mu.username
        limit 3
      ) m
    ), '{}'::text[]) as mutual_names
  from public.users u
  left join lateral (
    -- current live room: actively seated (left_at is null) in a room
    -- that is live right now; most recently joined wins.
    select r.id as room_id, r.motion
    from public.debate_participants dp
    join public.debate_rooms r on r.id = dp.room_id
    where dp.user_id = u.id
      and dp.left_at is null
      and r.status = 'live'
    order by dp.joined_at desc
    limit 1
  ) live on true
  where u.id = p_user
  limit 1;
$$;

revoke all on function public.get_user_profile(uuid) from public;
grant execute on function public.get_user_profile(uuid) to anon, authenticated, service_role;

-- ─── 4. get_user_comments ────────────────────────────────────
-- The profile's comment tab. Every row is gated on the post's
-- community being visible to the CALLER, so a private board's
-- discussion never surfaces on a public profile. Aggregate score
-- only (same posture as get_post_comments).
create or replace function public.get_user_comments(
  p_author uuid,
  p_limit  int default 30,
  p_offset int default 0
)
returns table(
  id uuid, body text, image_url text, created_at timestamptz,
  score bigint, post_id uuid, post_title text,
  community_id uuid, community_name text
)
language sql stable security definer set search_path = public
as $$
  select
    c.id,
    c.body,
    c.image_url,
    c.created_at,
    coalesce(v.score, 0) as score,
    c.post_id,
    p.title as post_title,
    p.community_id,
    co.name as community_name
  from public.community_comments c
  join public.community_posts p on p.id = c.post_id
  join public.communities co on co.id = p.community_id
  left join lateral (
    select sum(value)::bigint as score
    from public.community_comment_votes
    where comment_id = c.id
  ) v on true
  where c.author_id = p_author
    and public.community_visible(p.community_id, auth.uid())
  order by c.created_at desc
  limit greatest(1, least(coalesce(p_limit, 30), 50))
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.get_user_comments(uuid, int, int) from public;
grant execute on function public.get_user_comments(uuid, int, int) to anon, authenticated;

create index if not exists idx_community_comments_author
  on public.community_comments (author_id, created_at desc);

-- ─── 5. get_user_communities ─────────────────────────────────
-- Memberships for the profile sidebar. Private boards only show to
-- callers who can already see them (community_visible), so a
-- membership list can't be used to enumerate private communities.
create or replace function public.get_user_communities(p_user uuid)
returns table(
  id uuid, name text, color text, avatar_url text,
  role text, member_count bigint
)
language sql stable security definer set search_path = public
as $$
  select
    c.id,
    c.name,
    c.color,
    c.avatar_url,
    cm.role,
    (select count(*) from public.community_members m
      where m.community_id = c.id) as member_count
  from public.community_members cm
  join public.communities c on c.id = cm.community_id
  where cm.user_id = p_user
    and public.community_visible(c.id, auth.uid())
  order by
    case cm.role when 'owner' then 0 when 'moderator' then 1 else 2 end,
    c.name asc;
$$;

revoke all on function public.get_user_communities(uuid) from public;
grant execute on function public.get_user_communities(uuid) to anon, authenticated;
