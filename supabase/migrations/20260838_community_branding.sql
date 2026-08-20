-- ============================================================
-- 20260838_community_branding.sql
--
-- Communities get real branding: an uploadable banner image and a
-- profile picture (falling back to the color gradient / letter tile
-- when unset). Files live in the existing public post-images bucket
-- under the uploader's folder; only the URL columns are guarded —
-- update_community_settings (mods; privacy still owner-only) learns
-- p_banner_url / p_avatar_url ('' clears, null leaves unchanged).
--
-- Also: mods can pin comments. community_comments.pinned_at orders
-- multiple pins (oldest pin first); set_comment_pinned is the only
-- write path and checks moderator role in the post's community.
-- ============================================================

alter table public.communities
  add column if not exists banner_url text check (char_length(banner_url) <= 500),
  add column if not exists avatar_url text check (char_length(avatar_url) <= 500);

drop function if exists public.update_community_settings(uuid, text, text, boolean);
create function public.update_community_settings(
  p_community   uuid,
  p_description text default null,
  p_rules       text default null,
  p_is_private  boolean default null,
  p_banner_url  text default null,
  p_avatar_url  text default null
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null or not public.is_community_mod(p_community, v_me) then
    raise exception 'not_moderator' using errcode = '42501';
  end if;
  if p_is_private is not null and not exists (
    select 1 from public.community_members
    where community_id = p_community and user_id = v_me and role = 'owner'
  ) then
    raise exception 'owner_only: Only the owner can change privacy.' using errcode = '42501';
  end if;
  update public.communities set
    description = case when p_description is null then description
                       when p_description = '' then null
                       else left(p_description, 500) end,
    rules       = case when p_rules is null then rules
                       when p_rules = '' then null
                       else left(p_rules, 4000) end,
    is_private  = coalesce(p_is_private, is_private),
    banner_url  = case when p_banner_url is null then banner_url
                       when p_banner_url = '' then null
                       else left(p_banner_url, 500) end,
    avatar_url  = case when p_avatar_url is null then avatar_url
                       when p_avatar_url = '' then null
                       else left(p_avatar_url, 500) end
  where id = p_community;
end;
$$;
revoke all on function public.update_community_settings(uuid, text, text, boolean, text, text) from public, anon;
grant execute on function public.update_community_settings(uuid, text, text, boolean, text, text) to authenticated;

-- ─── Pinned comments ─────────────────────────────────────────
alter table public.community_comments
  add column if not exists pinned_at timestamptz;

create or replace function public.set_comment_pinned(p_comment uuid, p_pinned boolean)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_me        uuid := auth.uid();
  v_community uuid;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  select p.community_id into v_community
  from public.community_comments c
  join public.community_posts p on p.id = c.post_id
  where c.id = p_comment;
  if v_community is null then
    raise exception 'comment_not_found' using errcode = 'P0001';
  end if;
  if not public.is_community_mod(v_community, v_me) then
    raise exception 'not_moderator' using errcode = '42501';
  end if;
  update public.community_comments
  set pinned_at = case when p_pinned then now() end
  where id = p_comment;
end;
$$;
revoke all on function public.set_comment_pinned(uuid, boolean) from public, anon;
grant execute on function public.set_comment_pinned(uuid, boolean) to authenticated;

-- get_post_comments returns pinned_at (append-only, as usual).
drop function if exists public.get_post_comments(uuid);
create function public.get_post_comments(p_post uuid)
returns table(
  id uuid, post_id uuid, parent_id uuid, author_id uuid, author_username text,
  body text, created_at timestamptz, score bigint, my_vote smallint,
  author_display_name text, author_role text, image_url text, pinned_at timestamptz
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
    c.image_url,
    c.pinned_at
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
