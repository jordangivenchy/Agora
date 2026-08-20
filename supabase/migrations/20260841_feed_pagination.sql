-- ============================================================
-- 20260841_feed_pagination.sql
--
-- get_community_posts gains p_offset so the feed can page ("Load
-- more") instead of hard-capping at one fetch. Offset pagination is
-- fine at beta scale and works for every sort; revisit as keyset if
-- boards ever get deep. Signature append-only: named-arg callers
-- keep working untouched.
-- ============================================================

drop function if exists public.get_community_posts(uuid, text, integer, uuid);
create function public.get_community_posts(
  p_community uuid default null, p_sort text default 'new',
  p_limit integer default 50, p_author uuid default null,
  p_offset integer default 0
)
returns table(
  id uuid, community_id uuid, community_name text, author_id uuid,
  author_username text, title text, body text, created_at timestamptz,
  score bigint, my_vote smallint, comment_count bigint, author_display_name text,
  image_url text, tag_id uuid, tag_name text, tag_color text, author_role text,
  is_repost boolean, repost_of uuid, orig_title text, orig_body text,
  orig_image_url text, orig_community_name text,
  orig_author_username text, orig_author_display_name text,
  pinned_at timestamptz
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
    p.is_repost,
    case when ov.visible then p.repost_of end,
    case when ov.visible then op.title end,
    case when ov.visible then op.body end,
    case when ov.visible then op.image_url end,
    case when ov.visible then oc.name end,
    case when ov.visible then coalesce(ou.username, '(deleted)') end,
    case when ov.visible then ou.display_name end,
    p.pinned_at
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
    case when p_community is not null and p.pinned_at is not null then p.pinned_at end asc nulls last,
    case when p_sort = 'top' then coalesce(v.score, 0) end desc nulls last,
    case when p_sort = 'best'
      then public.wilson_lower_bound(coalesce(v.ups, 0), coalesce(v.downs, 0)) end desc nulls last,
    p.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 100))
  offset greatest(0, coalesce(p_offset, 0));
$$;
grant execute on function public.get_community_posts(uuid, text, integer, uuid, integer) to anon, authenticated;
