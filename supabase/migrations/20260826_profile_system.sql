-- Profile system: verification badges + profile-tab query support.

alter table public.users add column if not exists verified boolean not null default false;

-- Moderators grant/revoke the badge (surfaced on the profile page).
create or replace function public.set_user_verified(p_user uuid, p_value boolean)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (
    select 1 from public.users
    where id = auth.uid() and is_moderator = true
  ) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  update public.users set verified = p_value where id = p_user;
end;
$$;

revoke all on function public.set_user_verified(uuid, boolean) from public;
grant execute on function public.set_user_verified(uuid, boolean) to authenticated;

-- Profile tabs page over these.
create index if not exists idx_community_posts_author on public.community_posts (author_id, created_at desc);
create index if not exists idx_clips_uploader on public.clips (uploader_id, created_at desc);

-- get_user_profile now returns `verified` (return-type change = drop+create;
-- grants restored to the audited state: anon + authenticated + service_role).
drop function if exists public.get_user_profile(uuid);

create function public.get_user_profile(p_user uuid)
returns table(
  id uuid, username text, display_name text, avatar_url text, bio text,
  created_at timestamptz, username_changed_at timestamptz,
  follower_count bigint, following_count bigint,
  is_following boolean, is_followed_by boolean, is_friend boolean,
  verified boolean
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
    u.verified
  from public.users u
  where u.id = p_user
  limit 1;
$$;

revoke all on function public.get_user_profile(uuid) from public;
grant execute on function public.get_user_profile(uuid) to anon, authenticated, service_role;
