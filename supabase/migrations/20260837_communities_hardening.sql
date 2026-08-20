-- ============================================================
-- 20260837_communities_hardening.sql
--
-- Fixes from the adversarial review of the communities work:
--
--   1. Repost-embed privacy: the feed RPCs joined the repost's
--      original with NO visibility check, so a repost created while
--      the source board was public kept serving the original's
--      title/body/image to everyone after the source flipped
--      private. The orig_* columns (and repost_of itself) are now
--      gated on community_visible(op.community_id, auth.uid()) —
--      hidden originals render as "unavailable" client-side.
--   2. Repost inserts are trigger-validated: repost_of must point
--      at an existing post in a non-private community. The plain
--      INSERT path could previously set repost_of to any post id,
--      bypassing repost_post()'s private-source guard.
--   3. communities.color is constrained to a hex color. The value
--      is interpolated into card markup on the homepage; a format
--      check at the source ends the stored-XSS class outright
--      (the client also validates before rendering).
--
-- Known accepted risk (unchanged): post/comment images live in the
-- public post-images bucket — same posture as avatars/thumbnails.
-- Private-board images are reachable by unguessable URL if shared.
-- ============================================================

-- ─── 3. color format ─────────────────────────────────────────
alter table public.communities drop constraint if exists communities_color_format;
alter table public.communities add constraint communities_color_format
  check (color is null or color ~ '^#[0-9a-fA-F]{3,8}$');

-- ─── 2. repost insert validation ─────────────────────────────
create or replace function public.validate_repost()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_src_community uuid;
begin
  if new.repost_of is not null then
    select community_id into v_src_community
    from public.community_posts where id = new.repost_of;
    if v_src_community is null then
      raise exception 'repost_source_missing' using errcode = 'P0001';
    end if;
    if (select is_private from public.communities where id = v_src_community) then
      raise exception 'private_source: Posts in private communities can''t be shared out.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.validate_repost() from anon, authenticated;
drop trigger if exists trg_validate_repost on public.community_posts;
create trigger trg_validate_repost
  before insert or update of repost_of on public.community_posts
  for each row execute function public.validate_repost();

-- ─── 1. feed RPCs: gate the embedded original ────────────────
drop function if exists public.get_community_posts(uuid, text, integer, uuid);
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
    p.is_repost,
    case when ov.visible then p.repost_of end,
    case when ov.visible then op.title end,
    case when ov.visible then op.body end,
    case when ov.visible then op.image_url end,
    case when ov.visible then oc.name end,
    case when ov.visible then coalesce(ou.username, '(deleted)') end,
    case when ov.visible then ou.display_name end
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
    case when p_sort = 'top' then coalesce(v.score, 0) end desc nulls last,
    case when p_sort = 'best'
      then public.wilson_lower_bound(coalesce(v.ups, 0), coalesce(v.downs, 0)) end desc nulls last,
    p.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 100));
$$;
grant execute on function public.get_community_posts(uuid, text, integer, uuid) to anon, authenticated;

drop function if exists public.get_community_post(uuid);
create function public.get_community_post(p_post uuid)
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
    p.is_repost,
    case when ov.visible then p.repost_of end,
    case when ov.visible then op.title end,
    case when ov.visible then op.body end,
    case when ov.visible then op.image_url end,
    case when ov.visible then oc.name end,
    case when ov.visible then coalesce(ou.username, '(deleted)') end,
    case when ov.visible then ou.display_name end
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
    from public.community_post_votes
    where post_id = p.id
  ) v on true
  left join public.community_post_votes mv
    on mv.post_id = p.id and mv.user_id = auth.uid()
  left join lateral (
    select count(*)::bigint as n from public.community_comments
    where post_id = p.id
  ) cc on true
  where p.id = p_post
    and public.community_visible(p.community_id, auth.uid());
$$;
grant execute on function public.get_community_post(uuid) to anon, authenticated;
