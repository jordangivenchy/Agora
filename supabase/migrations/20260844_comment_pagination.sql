-- ============================================================
-- 20260844_comment_pagination.sql
--
-- get_post_comments gains p_limit/p_offset so comment sections can
-- page ("Load more comments") instead of shipping the entire tree in
-- one call. Pagination applies to TOP-LEVEL comments only: a page is
-- the next slice of root comments — pinned roots first (oldest pin
-- first), then oldest root first, exactly the order the tree shipped
-- in before — and EVERY descendant of those roots rides along in the
-- same result, so a thread is never split across pages. The client
-- keeps re-sorting locally (Top/New) as it always has. Has-more
-- signal: the caller counts the returned parent_id-is-null rows and
-- compares to p_limit (a short page means the roots are exhausted).
-- Offset pagination is fine at beta scale and dedupe-by-id on the
-- client absorbs row drift; revisit as keyset if a post ever goes
-- truly viral. Signature append-only: named-arg callers keep working
-- untouched (they just get the first 60 threads during rollout).
-- ============================================================

drop function if exists public.get_post_comments(uuid);
create function public.get_post_comments(
  p_post uuid, p_limit int default 60, p_offset int default 0
)
returns table(
  id uuid, post_id uuid, parent_id uuid, author_id uuid, author_username text,
  body text, created_at timestamptz, score bigint, my_vote smallint,
  author_display_name text, author_role text, image_url text, pinned_at timestamptz
)
language sql stable security definer
set search_path to 'public'
as $$
  with recursive page_roots as (
    select c.id
    from public.community_comments c
    join public.community_posts p on p.id = c.post_id
    where c.post_id = p_post
      and c.parent_id is null
      and public.community_visible(p.community_id, auth.uid())
    order by (c.pinned_at is not null) desc, c.pinned_at asc, c.created_at asc
    limit greatest(1, least(coalesce(p_limit, 60), 100))
    offset greatest(0, coalesce(p_offset, 0))
  ),
  thread as (
    select pr.id from page_roots pr
    union all
    select c.id
    from public.community_comments c
    join thread t on t.id = c.parent_id
  )
  select
    c.id, c.post_id, c.parent_id, c.author_id,
    coalesce(u.username, '(deleted)'), c.body, c.created_at,
    coalesce(v.score, 0), mv.value,
    u.display_name,
    (select cm.role from public.community_members cm
      where cm.community_id = p.community_id and cm.user_id = c.author_id),
    c.image_url,
    c.pinned_at
  from thread t
  join public.community_comments c on c.id = t.id
  join public.community_posts p on p.id = c.post_id
  left join public.users u on u.id = c.author_id
  left join lateral (
    select sum(value)::bigint as score from public.community_comment_votes
    where comment_id = c.id
  ) v on true
  left join public.community_comment_votes mv
    on mv.comment_id = c.id and mv.user_id = auth.uid()
  order by c.created_at asc;
$$;
grant execute on function public.get_post_comments(uuid, integer, integer) to anon, authenticated;
