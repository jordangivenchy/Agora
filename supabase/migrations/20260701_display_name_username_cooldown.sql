-- ============================================================
-- 20260701_display_name_username_cooldown.sql
--
--   1. users.display_name  — free-form name shown alongside the
--      @username; changeable anytime (max 40 chars).
--   2. users.username_changed_at — stamps every username change;
--      update_profile enforces a 7-day cooldown between changes.
--      Accounts younger than 1 hour are exempt so onboarding
--      (and immediate typo fixes) don't burn the weekly change.
--   3. update_profile gains p_display_name and the cooldown check.
--      Passing an empty string for avatar/bio/display_name now
--      CLEARS the field (null still means "leave unchanged").
--   4. get_user_profile returns the new columns.
-- ============================================================

alter table public.users add column if not exists display_name text;
alter table public.users add column if not exists username_changed_at timestamptz;

-- ─── update_profile v2 ──────────────────────────────────────
drop function if exists public.update_profile(text, text, text);

create or replace function public.update_profile(
  p_username     text,
  p_avatar_url   text,
  p_bio          text,
  p_display_name text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me         uuid := auth.uid();
  v_clean      text;
  v_current    text;
  v_changed_at timestamptz;
  v_created    timestamptz;
  v_display    text;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select username, username_changed_at, created_at
    into v_current, v_changed_at, v_created
  from public.users
  where id = v_me;

  -- Username: weekly cooldown, uniqueness, format.
  if p_username is not null then
    v_clean := lower(trim(p_username));
    if v_clean !~ '^[a-z0-9_]{3,20}$' then
      raise exception 'invalid_username'
        using errcode = '22023',
              message = 'Username must be 3-20 chars: lowercase letters, numbers, or underscores.';
    end if;

    if v_clean <> lower(coalesce(v_current, '')) then
      if v_created < now() - interval '1 hour'
         and v_changed_at is not null
         and v_changed_at > now() - interval '7 days' then
        raise exception 'username_cooldown'
          using errcode = 'P0001',
                message = 'You can only change your username once every 7 days.';
      end if;

      if exists (
        select 1 from public.users
        where lower(username) = v_clean and id <> v_me
      ) then
        raise exception 'username_taken'
          using errcode = 'P0001',
                message = 'That username is already taken.';
      end if;

      update public.users
         set username = v_clean,
             username_changed_at = now()
       where id = v_me;
    end if;
  end if;

  -- Display name: changeable anytime; empty string clears it.
  if p_display_name is not null then
    v_display := trim(p_display_name);
    if length(v_display) > 40 then
      raise exception 'display_name_too_long'
        using errcode = '22023',
              message = 'Display name must be 40 characters or fewer.';
    end if;
    update public.users
       set display_name = nullif(v_display, '')
     where id = v_me;
  end if;

  -- Avatar / bio: null = leave unchanged, empty string = clear.
  update public.users
     set avatar_url = case when p_avatar_url is null then avatar_url
                           else nullif(p_avatar_url, '') end,
         bio        = case when p_bio is null then bio
                           else nullif(p_bio, '') end,
         updated_at = now()
   where id = v_me;
end;
$$;

revoke all on function public.update_profile(text, text, text, text) from public;
grant execute on function public.update_profile(text, text, text, text) to authenticated;

-- ─── get_user_profile v2 (adds display_name, username_changed_at) ───
drop function if exists public.get_user_profile(uuid);

create function public.get_user_profile(p_user uuid)
returns table (
  id                  uuid,
  username            text,
  display_name        text,
  avatar_url          text,
  bio                 text,
  created_at          timestamptz,
  username_changed_at timestamptz,
  follower_count      bigint,
  following_count     bigint,
  is_following        boolean,
  is_followed_by      boolean,
  is_friend           boolean
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
    ) as is_friend
  from public.users u
  where u.id = p_user
  limit 1;
$$;

revoke all on function public.get_user_profile(uuid) from public;
grant execute on function public.get_user_profile(uuid) to authenticated, anon;
