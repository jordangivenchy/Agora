-- ============================================================
-- 20260854_email_notifications.sql
--
-- Email delivery for social notifications + a weekly digest.
-- Builds on 20260852 (notifications.meta/delivered_at, notif_enabled,
-- dispatch_notification_push, app_config.reminder_webhook_secret /
-- app_origin).
--
--   user_settings.email_prefs          jsonb {type: bool}; defaults via
--                                      email_enabled() when the key is absent
--   user_settings.email_digest         'off' | 'weekly'
--   user_settings.email_unsubscribed_at global kill switch (unsubscribe link)
--   user_settings.last_digest_at       double-send guard for the digest
--   notifications.emailed_at           stamped by /api/cron/notifications
--
-- RPCs (authenticated): get_email_prefs(), set_email_pref(type, enabled),
--   set_email_digest(mode), set_email_unsubscribed(on).
-- Unsubscribe link (anon): email_unsubscribe(user, token) where token =
--   email_unsub_token(user) = hmac-sha256(user id, reminder_webhook_secret).
--
-- Cron: 'notification-push' (every minute) now also fires when un-emailed
--   rows exist; 'weekly-digest' Saturday 15:00 UTC → POST /api/cron/digest.
--
-- Idempotent; run in the Supabase SQL editor.
-- ============================================================

create extension if not exists pgcrypto;

-- ─── 1. Columns ──────────────────────────────────────────────
alter table public.user_settings
  add column if not exists email_prefs jsonb not null default '{}'::jsonb,
  add column if not exists email_digest text not null default 'weekly',
  add column if not exists email_unsubscribed_at timestamptz,
  add column if not exists last_digest_at timestamptz;

alter table public.user_settings drop constraint if exists user_settings_email_digest_check;
alter table public.user_settings add constraint user_settings_email_digest_check
  check (email_digest in ('off', 'weekly'));

alter table public.notifications
  add column if not exists emailed_at timestamptz;

create index if not exists idx_notifications_unemailed
  on public.notifications (created_at) where emailed_at is null;

-- ─── 2. Defaults + per-user resolution ───────────────────────
-- Types that email by default. Everything else (push-backed or noisy)
-- is opt-in.
create or replace function public.email_default_types()
returns text[]
language sql immutable
as $$
  select array[
    'followed_live', 'followed_scheduled', 'room_invite', 'mention',
    'post_reply', 'debate_replay_ready', 'friend_accepted'
  ]::text[];
$$;
revoke all on function public.email_default_types() from public, anon;
grant execute on function public.email_default_types() to authenticated;

-- Should this type be emailed to this user? Explicit jsonb key wins,
-- then the default list. Does NOT consider the global unsubscribe —
-- callers check email_unsubscribed_at separately so the settings UI can
-- still show the per-type state.
create or replace function public.email_enabled(p_user uuid, p_type text)
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select coalesce(
    (s.email_prefs ->> p_type)::boolean,
    p_type = any (public.email_default_types()))
  from (select 1) x
  left join public.user_settings s on s.user_id = p_user;
$$;
revoke all on function public.email_enabled(uuid, text) from public, anon, authenticated;

-- ─── 3. Preference RPCs ──────────────────────────────────────
create or replace function public.get_email_prefs()
returns jsonb
language plpgsql stable
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_types jsonb := '{}'::jsonb;
  v_digest text;
  v_unsub timestamptz;
  t text;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  foreach t in array public.notification_types() loop
    v_types := v_types || jsonb_build_object(t, public.email_enabled(v_me, t));
  end loop;
  select s.email_digest, s.email_unsubscribed_at into v_digest, v_unsub
  from public.user_settings s where s.user_id = v_me;
  return jsonb_build_object(
    'types', v_types,
    'digest', coalesce(v_digest, 'weekly'),
    'unsubscribed', v_unsub is not null);
end;
$$;
revoke all on function public.get_email_prefs() from public, anon;
grant execute on function public.get_email_prefs() to authenticated;

create or replace function public.set_email_pref(p_type text, p_enabled boolean)
returns jsonb
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
  if p_type is null or not (p_type = any (public.notification_types())) then
    raise exception 'invalid_notification_type' using errcode = '22023';
  end if;
  insert into public.user_settings (user_id, email_prefs)
  values (v_me, jsonb_build_object(p_type, coalesce(p_enabled, false)))
  on conflict (user_id) do update
    set email_prefs = public.user_settings.email_prefs
                      || jsonb_build_object(p_type, coalesce(p_enabled, false));
  return public.get_email_prefs();
end;
$$;
revoke all on function public.set_email_pref(text, boolean) from public, anon;
grant execute on function public.set_email_pref(text, boolean) to authenticated;

create or replace function public.set_email_digest(p_mode text)
returns jsonb
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
  if p_mode is null or p_mode not in ('off', 'weekly') then
    raise exception 'invalid_digest_mode' using errcode = '22023';
  end if;
  insert into public.user_settings (user_id, email_digest)
  values (v_me, p_mode)
  on conflict (user_id) do update set email_digest = excluded.email_digest;
  return public.get_email_prefs();
end;
$$;
revoke all on function public.set_email_digest(text) from public, anon;
grant execute on function public.set_email_digest(text) to authenticated;

create or replace function public.set_email_unsubscribed(p_on boolean)
returns jsonb
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
  insert into public.user_settings (user_id, email_unsubscribed_at)
  values (v_me, case when coalesce(p_on, false) then now() else null end)
  on conflict (user_id) do update
    set email_unsubscribed_at = case when coalesce(p_on, false) then now() else null end;
  return public.get_email_prefs();
end;
$$;
revoke all on function public.set_email_unsubscribed(boolean) from public, anon;
grant execute on function public.set_email_unsubscribed(boolean) to authenticated;

-- ─── 4. One-click unsubscribe (unauthenticated link) ─────────
-- Token = HMAC-SHA256(user id, reminder_webhook_secret). Service-role
-- only: the cron route mints it when rendering the footer link.
create or replace function public.email_unsub_token(p_user uuid)
returns text
language sql stable
security definer
set search_path = public
as $$
  select encode(extensions.hmac(
    p_user::text::bytea,
    (select value from public.app_config where key = 'reminder_webhook_secret')::bytea,
    'sha256'), 'hex');
$$;
revoke all on function public.email_unsub_token(uuid) from public, anon, authenticated;

-- Verifies and flips the kill switch. Returns true on success; false on
-- a bad token (constant-time compare not needed: the token is a random
-- 256-bit MAC, not a secret the caller can refine).
create or replace function public.email_unsubscribe(p_user uuid, p_token text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user is null or p_token is null
     or length(p_token) <> 64
     or public.email_unsub_token(p_user) is distinct from lower(p_token) then
    return false;
  end if;
  insert into public.user_settings (user_id, email_unsubscribed_at)
  values (p_user, now())
  on conflict (user_id) do update
    set email_unsubscribed_at = coalesce(public.user_settings.email_unsubscribed_at, now());
  return true;
end;
$$;
revoke all on function public.email_unsubscribe(uuid, text) from public;
grant execute on function public.email_unsubscribe(uuid, text) to anon, authenticated;

-- ─── 5. Minute cron: also wake for un-emailed rows ───────────
create or replace function public.dispatch_notification_push()
returns integer
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_secret text;
  v_origin text;
  n integer;
begin
  select count(*)::int into n
  from public.notifications nt
  where nt.created_at > now() - interval '30 minutes'
    and (
      (nt.delivered_at is null
        and nt.type in ('followed_live', 'followed_scheduled', 'debate_replay_ready'))
      or (nt.emailed_at is null and public.email_enabled(nt.user_id, nt.type))
    );
  if n = 0 then
    return 0;
  end if;

  select value into v_secret from public.app_config where key = 'reminder_webhook_secret';
  select value into v_origin from public.app_config where key = 'app_origin';
  if v_secret is null or v_origin is null then
    return 0;
  end if;

  perform net.http_post(
    url := v_origin || '/api/cron/notifications',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret
    ),
    body := '{}'::jsonb
  );
  return n;
end;
$$;
revoke execute on function public.dispatch_notification_push() from public, anon, authenticated;

-- ─── 6. Weekly digest cron ───────────────────────────────────
create or replace function public.dispatch_weekly_digest()
returns void
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_secret text;
  v_origin text;
begin
  select value into v_secret from public.app_config where key = 'reminder_webhook_secret';
  select value into v_origin from public.app_config where key = 'app_origin';
  if v_secret is null or v_origin is null then
    return;
  end if;
  perform net.http_post(
    url := v_origin || '/api/cron/digest',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret
    ),
    body := '{}'::jsonb
  );
end;
$$;
revoke execute on function public.dispatch_weekly_digest() from public, anon, authenticated;

do $$
begin
  perform cron.unschedule('weekly-digest');
exception when others then null;
end $$;
-- Saturday 15:00 UTC ≈ 8am Pacific.
select cron.schedule('weekly-digest', '0 15 * * 6', 'select public.dispatch_weekly_digest()');
