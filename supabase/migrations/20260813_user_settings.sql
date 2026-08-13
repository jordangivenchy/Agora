-- ============================================================
-- 20260813_user_settings.sql
--
-- Backing store + enforcement for the /settings page. Only settings
-- with real behavior exist here — no speculative columns.
--
--   1. user_settings — one row per user, RLS own-row only.
--        join_muted / join_camera_off  → applied by the room page when
--                                        connecting to LiveKit
--        reduce_motion                 → applied as a root CSS class
--        show_debate_history           → enforced SERVER-SIDE below
--   2. Privacy enforcement: get_user_recent_debates and
--      get_user_live_and_scheduled (the two RPCs that expose a user's
--      debate activity to OTHER users) now return nothing for users
--      who turned show_debate_history off. Owner always sees their own.
--      Bodies otherwise preserved verbatim from live defs (2026-08-13).
--   3. delete_own_account — anonymize-then-destroy. Debate content
--      FKs are NO ACTION (hard-deleting a user would break other
--      people's debate records), so the row is scrubbed of PII and
--      the auth.users row is deleted, killing credentials + sessions.
-- ============================================================

-- ─── 1. Settings table ───────────────────────────────────────
create table if not exists public.user_settings (
  user_id             uuid primary key references public.users(id) on delete cascade,
  join_muted          boolean not null default false,
  join_camera_off     boolean not null default false,
  reduce_motion       boolean not null default false,
  show_debate_history boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

alter table public.user_settings enable row level security;

drop policy if exists "users read own settings" on public.user_settings;
create policy "users read own settings"
  on public.user_settings for select using (auth.uid() = user_id);

drop policy if exists "users insert own settings" on public.user_settings;
create policy "users insert own settings"
  on public.user_settings for insert with check (auth.uid() = user_id);

drop policy if exists "users update own settings" on public.user_settings;
create policy "users update own settings"
  on public.user_settings for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function public.touch_user_settings()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end; $$;

drop trigger if exists trg_touch_user_settings on public.user_settings;
create trigger trg_touch_user_settings
  before update on public.user_settings
  for each row execute function public.touch_user_settings();

-- ─── 2a. get_user_recent_debates: honor show_debate_history ──
create or replace function public.get_user_recent_debates(p_user uuid, p_limit integer default 5)
returns table(room_id uuid, motion text, topic_key text, status text, stance text, started_at timestamptz, ended_at timestamptz, is_private boolean)
language sql
stable security definer
set search_path to 'public'
as $function$
  select
    r.id,
    r.motion,
    r.topic_key,
    r.status,
    dp.stance,
    r.started_at,
    r.ended_at,
    r.is_private
  from public.debate_participants dp
  join public.debate_rooms r on r.id = dp.room_id
  where dp.user_id = p_user
    and dp.role    = 'debater'
    and (r.is_private = false or r.allow_spectators = true)
    -- Privacy: hidden from everyone but the owner when the owner
    -- turned "show my discussions on my profile" off.
    and (auth.uid() = p_user
         or coalesce((select s.show_debate_history from public.user_settings s
                       where s.user_id = p_user), true))
  order by coalesce(r.ended_at, r.started_at, r.created_at) desc
  limit greatest(1, least(coalesce(p_limit, 5), 25));
$function$;

-- ─── 2b. get_user_live_and_scheduled: same gate ──────────────
create or replace function public.get_user_live_and_scheduled(p_user uuid)
returns table(room_id uuid, motion text, topic_key text, status text, stance text, started_at timestamptz, scheduled_start timestamptz, is_scheduled boolean, is_private boolean, host_id uuid)
language sql
stable security definer
set search_path to 'public'
as $function$
  select
    r.id,
    r.motion,
    r.topic_key,
    r.status,
    dp.stance,
    r.started_at,
    r.scheduled_start,
    (r.status = 'created'
       and r.scheduled_start is not null
       and r.scheduled_start > now()) as is_scheduled,
    r.is_private,
    r.host_id
  from public.debate_participants dp
  join public.debate_rooms r on r.id = dp.room_id
  where dp.user_id = p_user
    and dp.role    = 'debater'
    and dp.left_at is null
    -- Private rooms are only revealed to the account owner.
    -- Anyone else only sees public (non-private) debates.
    and (r.is_private = false or auth.uid() = p_user)
    -- Privacy: hidden from everyone but the owner when the owner
    -- turned "show my discussions on my profile" off.
    and (auth.uid() = p_user
         or coalesce((select s.show_debate_history from public.user_settings s
                       where s.user_id = p_user), true))
    and r.status <> 'cancelled'
    and (
      r.status = 'live'
      or (r.status = 'created'
          and r.scheduled_start is not null
          and r.scheduled_start > now())
    )
  order by
    (case when r.status = 'live' then 0 else 1 end),
    r.started_at      desc nulls last,
    r.scheduled_start asc  nulls last;
$function$;

-- ─── 3. Account deletion (anonymize + destroy credentials) ───
-- Debate rows (participants, votes, messages, hosted rooms) are kept
-- so other people's debate records stay intact, but attributed to a
-- scrubbed "deleted-xxxxxxxx" identity. Social graph and settings rows
-- are removed outright.
--
-- The auth.users row is NOT deleted: auth.users → public.users is an
-- ON DELETE CASCADE, and public.users is pinned by NO ACTION debate
-- FKs, so deletion is impossible without destroying other people's
-- records. Instead the auth identity is scrubbed in place — tombstone
-- email, password hash nulled (password login can never succeed),
-- OAuth identities removed, and every session/refresh token deleted.
-- Result is identical for the user: instant sign-out everywhere and
-- no way to ever sign back in.
create or replace function public.delete_own_account()
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

  -- Social graph + personal rows.
  delete from public.user_follows   where follower_id = v_me or following_id = v_me;
  delete from public.user_blocks    where blocker_id = v_me or blocked_id = v_me;
  delete from public.community_members where user_id = v_me;
  delete from public.debate_queue   where user_id = v_me;
  delete from public.user_settings  where user_id = v_me;
  delete from public.clip_likes     where user_id = v_me;

  -- Scrub PII from the public profile; keep the row for FK integrity.
  update public.users
  set username           = 'deleted-' || substr(v_me::text, 1, 8),
      display_name       = null,
      bio                = null,
      avatar_url         = null,
      -- users.email is NOT NULL; use an unroutable tombstone (.invalid TLD)
      email              = 'deleted-' || substr(v_me::text, 1, 8) || '@deleted.invalid',
      is_moderator       = false,
      suspended_until    = null,
      username_changed_at = now()
  where id = v_me;

  -- Destroy the auth identity in place (see header for why not DELETE).
  delete from auth.refresh_tokens where user_id = v_me::text;
  delete from auth.sessions       where user_id = v_me;
  delete from auth.identities     where user_id = v_me;
  delete from auth.mfa_factors    where user_id = v_me;
  update auth.users
  set email              = 'deleted-' || substr(v_me::text, 1, 8) || '@deleted.invalid',
      encrypted_password = null,
      raw_user_meta_data = '{}'::jsonb,
      phone              = null
  where id = v_me;
end;
$$;

revoke all on function public.delete_own_account() from public;
grant execute on function public.delete_own_account() to authenticated;
