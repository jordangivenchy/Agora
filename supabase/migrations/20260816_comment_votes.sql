-- ============================================================
-- 20260816_comment_votes.sql
--
-- Thread refinement: comments get the same vote treatment as posts.
--   community_comment_votes — one ±1 per user per comment, private
--                             rows (own-row select only)
--   get_post_comments        — comments with author, score, and the
--                             caller's vote, one call per post
--   vote_comment             — ±1 / 0, auth + suspension guarded
-- Same posture as 20260815: aggregates leave the DB, ballots don't.
-- ============================================================

create table if not exists public.community_comment_votes (
  comment_id uuid not null references public.community_comments(id) on delete cascade,
  user_id    uuid not null references public.users(id) on delete cascade,
  value      smallint not null check (value in (-1, 1)),
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);

alter table public.community_comment_votes enable row level security;

drop policy if exists "users see own comment votes" on public.community_comment_votes;
create policy "users see own comment votes"
  on public.community_comment_votes for select using (auth.uid() = user_id);
-- Writes go through vote_comment() only.

create or replace function public.get_post_comments(p_post uuid)
returns table (
  id uuid,
  post_id uuid,
  parent_id uuid,
  author_id uuid,
  author_username text,
  body text,
  created_at timestamptz,
  score bigint,
  my_vote smallint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id,
    c.post_id,
    c.parent_id,
    c.author_id,
    coalesce(u.username, '(deleted)') as author_username,
    c.body,
    c.created_at,
    coalesce(v.score, 0) as score,
    mv.value as my_vote
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

revoke all on function public.get_post_comments(uuid) from public;
grant execute on function public.get_post_comments(uuid) to anon, authenticated;

create or replace function public.vote_comment(p_comment uuid, p_value integer)
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
    delete from public.community_comment_votes where comment_id = p_comment and user_id = v_me;
  else
    insert into public.community_comment_votes (comment_id, user_id, value)
    values (p_comment, v_me, p_value)
    on conflict (comment_id, user_id) do update set value = excluded.value;
  end if;
end;
$$;

revoke all on function public.vote_comment(uuid, integer) from public, anon;
grant execute on function public.vote_comment(uuid, integer) to authenticated;
