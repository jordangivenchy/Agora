-- ============================================================
-- 20260815_community_posts.sql
--
-- Turns Communities from a membership list into a discussion forum:
-- posts with up/down votes and threaded comments (Reddit/Quora-style).
--
--   community_posts        — title + body inside a community
--   community_post_votes   — one ±1 per user per post (PK-enforced);
--                            individual votes are private (own-row
--                            select only), aggregate score comes from
--                            the definer RPC
--   community_comments     — parent_id gives threading
--
-- Posture matches the rest of the schema:
--   - content readable by everyone (public forum)
--   - authors write as themselves (RLS with check author_id = uid)
--   - suspended users blocked by RESTRICTIVE policies on the direct
--     write paths, and by an explicit guard inside vote_post (definer
--     functions bypass RLS)
--   - flood control by trigger, not client courtesy
-- ============================================================

-- ─── Tables ──────────────────────────────────────────────────
create table if not exists public.community_posts (
  id           uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  -- set null keeps the thread readable if the author deletes their account
  author_id    uuid references public.users(id) on delete set null,
  title        text not null check (char_length(title) between 1 and 200),
  body         text check (char_length(body) <= 10000),
  created_at   timestamptz not null default now()
);
create index if not exists idx_community_posts_feed
  on public.community_posts (community_id, created_at desc);
create index if not exists idx_community_posts_recent
  on public.community_posts (created_at desc);

create table if not exists public.community_post_votes (
  post_id    uuid not null references public.community_posts(id) on delete cascade,
  user_id    uuid not null references public.users(id) on delete cascade,
  value      smallint not null check (value in (-1, 1)),
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table if not exists public.community_comments (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.community_posts(id) on delete cascade,
  parent_id  uuid references public.community_comments(id) on delete cascade,
  author_id  uuid references public.users(id) on delete set null,
  body       text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index if not exists idx_community_comments_post
  on public.community_comments (post_id, created_at);

-- ─── RLS ─────────────────────────────────────────────────────
alter table public.community_posts enable row level security;
alter table public.community_post_votes enable row level security;
alter table public.community_comments enable row level security;

drop policy if exists "posts are readable by everyone" on public.community_posts;
create policy "posts are readable by everyone"
  on public.community_posts for select using (true);
drop policy if exists "users post as themselves" on public.community_posts;
create policy "users post as themselves"
  on public.community_posts for insert with check (auth.uid() = author_id);
drop policy if exists "authors delete own posts" on public.community_posts;
create policy "authors delete own posts"
  on public.community_posts for delete using (auth.uid() = author_id);
drop policy if exists "suspended users cannot post" on public.community_posts;
create policy "suspended users cannot post"
  on public.community_posts as restrictive for insert
  with check (not public.is_suspended(auth.uid()));

-- Individual votes are private; only your own row is visible.
drop policy if exists "users see own post votes" on public.community_post_votes;
create policy "users see own post votes"
  on public.community_post_votes for select using (auth.uid() = user_id);
-- All writes go through vote_post() — no client write policies.

drop policy if exists "comments are readable by everyone" on public.community_comments;
create policy "comments are readable by everyone"
  on public.community_comments for select using (true);
drop policy if exists "users comment as themselves" on public.community_comments;
create policy "users comment as themselves"
  on public.community_comments for insert with check (auth.uid() = author_id);
drop policy if exists "authors delete own comments" on public.community_comments;
create policy "authors delete own comments"
  on public.community_comments for delete using (auth.uid() = author_id);
drop policy if exists "suspended users cannot comment" on public.community_comments;
create policy "suspended users cannot comment"
  on public.community_comments as restrictive for insert
  with check (not public.is_suspended(auth.uid()));

-- ─── Flood control ───────────────────────────────────────────
create or replace function public.community_posts_rate_limit()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if (select count(*) from public.community_posts
      where author_id = new.author_id
        and created_at > now() - interval '10 minutes') >= 5 then
    raise exception using errcode = 'P0001',
      message = 'rate_limited: You''re posting too quickly — try again in a few minutes.';
  end if;
  return new;
end;
$$;
revoke execute on function public.community_posts_rate_limit() from anon, authenticated;
drop trigger if exists trg_community_posts_rate_limit on public.community_posts;
create trigger trg_community_posts_rate_limit
  before insert on public.community_posts
  for each row execute function public.community_posts_rate_limit();

create or replace function public.community_comments_rate_limit()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if (select count(*) from public.community_comments
      where author_id = new.author_id
        and created_at > now() - interval '60 seconds') >= 8 then
    raise exception using errcode = 'P0001',
      message = 'rate_limited: Slow down — you''re commenting too quickly.';
  end if;
  return new;
end;
$$;
revoke execute on function public.community_comments_rate_limit() from anon, authenticated;
drop trigger if exists trg_community_comments_rate_limit on public.community_comments;
create trigger trg_community_comments_rate_limit
  before insert on public.community_comments
  for each row execute function public.community_comments_rate_limit();

-- ─── RPCs ────────────────────────────────────────────────────
-- The feed: posts with author, score, the caller's vote, and comment
-- count, sorted 'new' or 'top'. Definer so the private votes table can
-- be aggregated; exposes only aggregates plus the caller's own vote.
create or replace function public.get_community_posts(
  p_community uuid default null,
  p_sort      text default 'new',
  p_limit     integer default 50
)
returns table (
  id uuid,
  community_id uuid,
  community_name text,
  author_id uuid,
  author_username text,
  title text,
  body text,
  created_at timestamptz,
  score bigint,
  my_vote smallint,
  comment_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id,
    p.community_id,
    c.name as community_name,
    p.author_id,
    coalesce(u.username, '(deleted)') as author_username,
    p.title,
    p.body,
    p.created_at,
    coalesce(v.score, 0) as score,
    mv.value as my_vote,
    coalesce(cc.n, 0) as comment_count
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

revoke all on function public.get_community_posts(uuid, text, integer) from public;
grant execute on function public.get_community_posts(uuid, text, integer) to anon, authenticated;

-- Vote: +1 / -1 / 0 (0 removes the vote). One row per user per post.
create or replace function public.vote_post(p_post uuid, p_value integer)
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
  if public.is_suspended(v_me) then
    raise exception using errcode = 'P0001', message = 'account_suspended: Your account is suspended.';
  end if;
  if p_value not in (-1, 0, 1) then
    raise exception 'invalid_vote' using errcode = '22023';
  end if;

  if p_value = 0 then
    delete from public.community_post_votes where post_id = p_post and user_id = v_me;
  else
    insert into public.community_post_votes (post_id, user_id, value)
    values (p_post, v_me, p_value)
    on conflict (post_id, user_id) do update set value = excluded.value;
  end if;
end;
$$;

revoke all on function public.vote_post(uuid, integer) from public, anon;
grant execute on function public.vote_post(uuid, integer) to authenticated;
