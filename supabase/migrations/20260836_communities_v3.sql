-- ============================================================
-- 20260836_communities_v3.sql
--
-- Follow-ups on the communities v2 pass:
--   Comment images — community_comments.image_url; the comment
--                    composer gets the same attach flow posts have.
--   Profile reposts — get_community_posts gains p_author so a
--                    profile can list one user's posts/reposts
--                    (TikTok-style repost tab). Privacy still holds:
--                    the community_visible predicate hides private-
--                    board posts from outsiders regardless of author.
-- ============================================================

alter table public.community_comments
  add column if not exists image_url text check (char_length(image_url) <= 500);

-- get_post_comments learns image_url (append-only, as usual).
drop function if exists public.get_post_comments(uuid);
create function public.get_post_comments(p_post uuid)
returns table(
  id uuid, post_id uuid, parent_id uuid, author_id uuid, author_username text,
  body text, created_at timestamptz, score bigint, my_vote smallint,
  author_display_name text, author_role text, image_url text
)
language sql stable security definer
set search_path to 'public'
as $$
  select
    c.id, c.post_id, c.parent_id, c.author_id,
    coalesce(u.username, '(deleted)'), c.body, c.created_at,
    coalesce(v.score, 0), mv.value,
    u.display_name,
    (select cm.role from public.community_members cm
      where cm.community_id = p.community_id and cm.user_id = c.author_id),
    c.image_url
  from public.community_comments c
  join public.community_posts p on p.id = c.post_id
  left join public.users u on u.id = c.author_id
  left join lateral (
    select sum(value)::bigint as score from public.community_comment_votes
    where comment_id = c.id
  ) v on true
  left join public.community_comment_votes mv
    on mv.comment_id = c.id and mv.user_id = auth.uid()
  where c.post_id = p_post
    and public.community_visible(p.community_id, auth.uid())
  order by c.created_at asc;
$$;
grant execute on function public.get_post_comments(uuid) to anon, authenticated;

-- get_community_posts gains p_author (defaulted — named-arg callers
-- keep working). Row shape unchanged from v2.
drop function if exists public.get_community_posts(uuid, text, integer);
create function public.get_community_posts(
  p_community uuid default null, p_sort text default 'new',
  p_limit integer default 50, p_author uuid default null
)
returns table(
  id uuid, community_id uuid, community_name text, author_id uuid,
  author_username text, title text, body text, created_at timestamptz,
  score bigint, my_vote smallint, comment_count bigint, author_display_name text,
  image_url text, tag_id uuid, tag_name text, tag_color text, author_role text,
  is_repost boolean, repost_of uuid, orig_title text, orig_body text,
  orig_image_url text, orig_community_name text,
  orig_author_username text, orig_author_display_name text
)
language sql stable security definer
set search_path to 'public'
as $$
  select
    p.id, p.community_id, c.name, p.author_id,
    coalesce(u.username, '(deleted)'), p.title, p.body, p.created_at,
    coalesce(v.score, 0), mv.value, coalesce(cc.n, 0),
    u.display_name,
    p.image_url, p.tag_id, t.name, t.color,
    (select cm.role from public.community_members cm
      where cm.community_id = p.community_id and cm.user_id = p.author_id),
    p.is_repost, p.repost_of, op.title, op.body,
    op.image_url, oc.name,
    case when op.id is not null then coalesce(ou.username, '(deleted)') end,
    ou.display_name
  from public.community_posts p
  join public.communities c on c.id = p.community_id
  left join public.users u on u.id = p.author_id
  left join public.community_tags t on t.id = p.tag_id
  left join public.community_posts op on op.id = p.repost_of
  left join public.users ou on ou.id = op.author_id
  left join public.communities oc on oc.id = op.community_id
  left join lateral (
    select sum(value)::bigint as score,
           count(*) filter (where value = 1) as ups,
           count(*) filter (where value = -1) as downs
    from public.community_post_votes
    where post_id = p.id
  ) v on true
  left join public.community_post_votes mv
    on mv.post_id = p.id and mv.user_id = auth.uid()
  left join lateral (
    select count(*)::bigint as n from public.community_comments
    where post_id = p.id
  ) cc on true
  where (p_community is null or p.community_id = p_community)
    and (p_author is null or p.author_id = p_author)
    and public.community_visible(p.community_id, auth.uid())
  order by
    case when p_sort = 'top' then coalesce(v.score, 0) end desc nulls last,
    case when p_sort = 'best'
      then public.wilson_lower_bound(coalesce(v.ups, 0), coalesce(v.downs, 0)) end desc nulls last,
    p.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 100));
$$;
grant execute on function public.get_community_posts(uuid, text, integer, uuid) to anon, authenticated;
