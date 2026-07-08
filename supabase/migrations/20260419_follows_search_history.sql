-- ═══════════════════════════════════════════════════════════════════════════
-- Friends / Following / Profile search / Debate history
--
-- What this adds
-- ──────────────
-- 1. public.user_follows  — directed follow edges (follower → following).
-- 2. RLS policies on user_follows so anyone can read who follows whom, but
--    users can only create/delete their own follow edges.
-- 3. search_users(q text) RPC — fuzzy-ish username/email lookup returning
--    lightweight profile rows for the nav-bar search dropdown.
-- 4. follow_user(p_target uuid) / unfollow_user(p_target uuid) — thin helpers.
-- 5. get_user_profile(p_user uuid) — returns the profile plus follower /
--    following counts and the caller's own follow state toward p_user.
-- 6. get_user_recent_debates(p_user uuid, p_limit int) — recent rooms the
--    target user debated in, with the user's stance on each.
-- 7. get_user_history(p_user uuid) — ended debates the user participated in,
--    including stance + the room's winning stance (by vote count) so we can
--    mark Won / Lost / Tied.
-- 8. get_friends(p_user uuid) — mutual-follow set (followers ∩ following).
--
-- Run AFTER 20260418_private_rooms_rpc_v2.sql.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1. user_follows ────────────────────────────────────────────────────────
create table if not exists public.user_follows (
  follower_id  uuid not null references public.users(id) on delete cascade,
  following_id uuid not null references public.users(id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (follower_id, following_id),
  check (follower_id <> following_id)
);

create index if not exists idx_user_follows_follower  on public.user_follows(follower_id);
create index if not exists idx_user_follows_following on public.user_follows(following_id);

alter table public.user_follows enable row level security;

drop policy if exists "user_follows_read_all"     on public.user_follows;
drop policy if exists "user_follows_self_insert"  on public.user_follows;
drop policy if exists "user_follows_self_delete"  on public.user_follows;

-- anyone (even anon) may read follow edges; this is needed to show follower
-- counts on profile pages without leaking anything sensitive.
create policy "user_follows_read_all"
  on public.user_follows for select
  using (true);

-- you may only insert a row where YOU are the follower
create policy "user_follows_self_insert"
  on public.user_follows for insert
  with check (auth.uid() = follower_id);

-- you may only delete your own follow edges
create policy "user_follows_self_delete"
  on public.user_follows for delete
  using (auth.uid() = follower_id);

-- ─── 2. search_users ────────────────────────────────────────────────────────
-- Returns up to 10 matches on username (prefix match wins, then contains).
-- Excludes the calling user (you can't follow yourself).
create or replace function public.search_users(p_query text)
returns table (
  id         uuid,
  username   text,
  avatar_url text,
  bio        text
)
language sql
stable
security definer
set search_path = public
as $$
  with q as (
    select lower(trim(coalesce(p_query, ''))) as needle
  )
  select u.id, u.username, u.avatar_url, u.bio
  from public.users u, q
  where q.needle <> ''
    and u.id <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid)
    and lower(u.username) like q.needle || '%'
  order by length(u.username) asc, u.username asc
  limit 10;
$$;

revoke all on function public.search_users(text) from public;
grant execute on function public.search_users(text) to authenticated, anon;

-- ─── 3. follow / unfollow helpers ───────────────────────────────────────────
create or replace function public.follow_user(p_target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_target is null or p_target = v_me then
    raise exception 'invalid_target' using errcode = '22023';
  end if;

  insert into public.user_follows (follower_id, following_id)
  values (v_me, p_target)
  on conflict (follower_id, following_id) do nothing;
end;
$$;

create or replace function public.unfollow_user(p_target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  delete from public.user_follows
  where follower_id = v_me and following_id = p_target;
end;
$$;

revoke all on function public.follow_user(uuid)   from public;
revoke all on function public.unfollow_user(uuid) from public;
grant execute on function public.follow_user(uuid)   to authenticated;
grant execute on function public.unfollow_user(uuid) to authenticated;

-- ─── 4. get_user_profile ────────────────────────────────────────────────────
-- Returns the profile row plus follower/following counts and booleans for
-- the caller's follow state toward p_user (for Follow / Unfollow button).
create or replace function public.get_user_profile(p_user uuid)
returns table (
  id              uuid,
  username        text,
  avatar_url      text,
  bio             text,
  created_at      timestamptz,
  follower_count  bigint,
  following_count bigint,
  is_following    boolean,
  is_followed_by  boolean,
  is_friend       boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with me as (select auth.uid() as uid)
  select
    u.id,
    u.username,
    u.avatar_url,
    u.bio,
    u.created_at,
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
    ) as is_friend
  from public.users u
  where u.id = p_user
  limit 1;
$$;

revoke all on function public.get_user_profile(uuid) from public;
grant execute on function public.get_user_profile(uuid) to authenticated, anon;

-- ─── 5. get_user_recent_debates ─────────────────────────────────────────────
-- Most recent rooms p_user participated in as a debater, with their stance.
-- Used on the profile modal. Limits to rooms that are NOT private-hidden so
-- we don't leak hidden-room participation to third parties.
create or replace function public.get_user_recent_debates(p_user uuid, p_limit int default 5)
returns table (
  room_id      uuid,
  motion       text,
  topic_key    text,
  status       text,
  stance       text,
  started_at   timestamptz,
  ended_at     timestamptz,
  is_private   boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    r.id,
    r.motion,
    r.topic_key,
    r.status,
    dp.stance,
    r.started_at,
    r.ended_at,
    r.is_private
  from public.debate_participants dp
  join public.debate_rooms r on r.id = dp.room_id
  where dp.user_id = p_user
    and dp.role    = 'debater'
    and (r.is_private = false or r.allow_spectators = true)
  order by coalesce(r.ended_at, r.started_at, r.created_at) desc
  limit greatest(1, least(coalesce(p_limit, 5), 25));
$$;

revoke all on function public.get_user_recent_debates(uuid, int) from public;
grant execute on function public.get_user_recent_debates(uuid, int) to authenticated, anon;

-- ─── 6. get_user_history ────────────────────────────────────────────────────
-- All debates the caller participated in (any role), with their stance and
-- the winning stance computed from the vote totals. Returns 'won' / 'lost' /
-- 'tied' / null (null for spectators or rooms with no votes).
create or replace function public.get_user_history(p_user uuid default null)
returns table (
  room_id        uuid,
  motion         text,
  topic_key      text,
  status         text,
  role           text,
  stance         text,
  joined_at      timestamptz,
  ended_at       timestamptz,
  started_at     timestamptz,
  pro_votes      bigint,
  con_votes      bigint,
  winning_stance text,
  outcome        text
)
language sql
stable
security definer
set search_path = public
as $$
  with target as (select coalesce(p_user, auth.uid()) as uid),
  vote_counts as (
    select
      dv.room_id,
      count(*) filter (where dv.stance = 'PRO') as pro_votes,
      count(*) filter (where dv.stance = 'CON') as con_votes
    from public.debate_votes dv
    group by dv.room_id
  )
  select
    r.id as room_id,
    r.motion,
    r.topic_key,
    r.status,
    dp.role,
    dp.stance,
    dp.joined_at,
    r.ended_at,
    r.started_at,
    coalesce(vc.pro_votes, 0) as pro_votes,
    coalesce(vc.con_votes, 0) as con_votes,
    case
      when coalesce(vc.pro_votes, 0) > coalesce(vc.con_votes, 0) then 'PRO'
      when coalesce(vc.con_votes, 0) > coalesce(vc.pro_votes, 0) then 'CON'
      when coalesce(vc.pro_votes, 0) = 0 and coalesce(vc.con_votes, 0) = 0 then null
      else 'TIE'
    end as winning_stance,
    case
      when dp.role <> 'debater' or dp.stance is null then null
      when coalesce(vc.pro_votes, 0) + coalesce(vc.con_votes, 0) = 0 then null
      when coalesce(vc.pro_votes, 0) = coalesce(vc.con_votes, 0) then 'tied'
      when (dp.stance = 'PRO' and coalesce(vc.pro_votes,0) > coalesce(vc.con_votes,0))
        or (dp.stance = 'CON' and coalesce(vc.con_votes,0) > coalesce(vc.pro_votes,0))
        then 'won'
      else 'lost'
    end as outcome
  from target
  join public.debate_participants dp on dp.user_id = target.uid
  join public.debate_rooms r on r.id = dp.room_id
  left join vote_counts vc on vc.room_id = r.id
  order by coalesce(r.ended_at, r.started_at, dp.joined_at) desc;
$$;

revoke all on function public.get_user_history(uuid) from public;
grant execute on function public.get_user_history(uuid) to authenticated;

-- ─── 7. get_friends ─────────────────────────────────────────────────────────
-- Mutual-follow set (you follow them AND they follow you).
create or replace function public.get_friends(p_user uuid default null)
returns table (
  id         uuid,
  username   text,
  avatar_url text,
  bio        text,
  since      timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with target as (select coalesce(p_user, auth.uid()) as uid)
  select
    u.id,
    u.username,
    u.avatar_url,
    u.bio,
    greatest(a.created_at, b.created_at) as since
  from target
  join public.user_follows a on a.follower_id  = target.uid       -- me → them
  join public.user_follows b on b.follower_id  = a.following_id   -- them → me
                            and b.following_id = target.uid
  join public.users u on u.id = a.following_id
  order by since desc;
$$;

revoke all on function public.get_friends(uuid) from public;
grant execute on function public.get_friends(uuid) to authenticated, anon;
