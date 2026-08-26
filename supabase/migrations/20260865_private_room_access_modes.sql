-- Private room access modes: who can enter without the invite code.
--   'code'      — today's behavior: the room link / invite code admits anyone.
--   'followers' — anyone who follows the host can enter directly.
--   'friends'   — mutual follows (are_friends) only.
--
-- The invite code keeps working in every mode as the host's escape hatch:
-- join_private_room is SECURITY DEFINER owned by postgres, so its seat
-- insert bypasses the restrictive policy below on purpose.
--
-- Followers/friends rooms are always unlisted (allow_spectators forced
-- false) — the public listings can't personalize per viewer, so "listed
-- but friends-only" would leak rooms people can't enter.

-- ── 1. Column ──────────────────────────────────────────────────────
alter table public.debate_rooms
  add column if not exists access_mode text not null default 'code'
  check (access_mode in ('code', 'followers', 'friends'));

-- ── 2. Eligibility helper ──────────────────────────────────────────
-- One answer for every enforcement point: seat-insert RLS, the LiveKit
-- token route, and the room page's gate screen. An existing participant
-- row keeps access (someone admitted via code stays admitted).
create or replace function public.can_enter_room(p_room uuid, p_user uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((
    select case
      when r.is_private = false then true
      when r.access_mode = 'code' then true
      when p_user is null then false
      when p_user = r.host_id then true
      when exists (
        select 1 from debate_participants dp
        where dp.room_id = r.id and dp.user_id = p_user
      ) then true
      when r.access_mode = 'followers' then exists (
        select 1 from user_follows f
        where f.follower_id = p_user and f.following_id = r.host_id
      )
      when r.access_mode = 'friends' then public.are_friends(p_user, r.host_id)
      else false
    end
    from debate_rooms r where r.id = p_room
  ), false);
$$;
-- Executed by the seat-gate policy as the inserting user, and by the
-- LiveKit token route as service_role — both need EXECUTE.
revoke all on function public.can_enter_room(uuid, uuid) from public;
grant execute on function public.can_enter_room(uuid, uuid) to authenticated, anon, service_role;

-- Client-callable form (the room page's gate check).
create or replace function public.can_enter_room(p_room uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.can_enter_room(p_room, auth.uid());
$$;
revoke all on function public.can_enter_room(uuid) from public;
grant execute on function public.can_enter_room(uuid) to authenticated, anon;

-- ── 3. Seat gate ───────────────────────────────────────────────────
-- Restrictive: ANDed with the permissive self-insert policy. Blocks the
-- room page's client-side spectator insert for ineligible users;
-- join_private_room (definer, table owner) is unaffected.
drop policy if exists "private room access modes" on public.debate_participants;
create policy "private room access modes"
  on public.debate_participants as restrictive for insert
  with check (public.can_enter_room(room_id, auth.uid()));

-- ── 4. create_room learns the mode ─────────────────────────────────
-- Drop the old signature so PostgREST doesn't see an ambiguous overload.
drop function if exists public.create_room(
  text, text, text, text, boolean, boolean,
  integer, integer, integer, timestamptz, uuid);

create or replace function public.create_room(
  p_motion text, p_topic_key text, p_language text, p_stance text,
  p_is_private boolean, p_allow_spectators boolean,
  p_pro_size integer, p_con_size integer,
  p_time_limit_seconds integer, p_scheduled_start timestamptz,
  p_community uuid default null,
  p_access_mode text default 'code'
)
returns table(room_id uuid, invite_code text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_me       uuid := auth.uid();
  v_room_id  uuid;
  v_code     text;
  v_status   text;
  v_started  timestamptz;
  v_mode     text := coalesce(p_access_mode, 'code');
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  if public.is_suspended(v_me) then
    raise exception using errcode = 'P0001', message = 'account_suspended: Your account is suspended.';
  end if;

  if char_length(trim(p_motion)) = 0 then
    raise exception 'motion_required' using errcode = 'P0001';
  end if;

  if p_pro_size + p_con_size > 20 then
    raise exception 'team_size_too_large' using errcode = 'P0001';
  end if;

  if v_mode not in ('code', 'followers', 'friends') then
    raise exception 'invalid_access_mode' using errcode = '22023';
  end if;
  -- Access modes only mean something on private rooms.
  if not p_is_private then
    v_mode := 'code';
  end if;

  -- Community discussions are scheduled by the board's moderators.
  if p_community is not null
     and not public.is_community_mod(p_community, v_me) then
    raise exception 'not_a_mod: Only moderators can start discussions for the community.' using errcode = '42501';
  end if;

  if p_is_private then
    v_code := upper(substring(md5(gen_random_uuid()::text) from 1 for 6));
  else
    v_code := null;
  end if;

  if p_scheduled_start is not null then
    if p_scheduled_start <= now() + interval '60 seconds' then
      raise exception 'scheduled_start_too_soon' using errcode = 'P0001';
    end if;
    v_status  := 'created';
    v_started := null;
  else
    v_status  := 'live';
    v_started := now();
  end if;

  insert into public.debate_rooms (
    motion, host_id, topic_key, format, language,
    status, is_private, invite_code, allow_spectators, access_mode,
    pro_size, con_size, fact_check_intensity, time_limit_seconds,
    allow_audience_questions, recording_consent,
    scheduled_start, started_at, community_id
  ) values (
    trim(p_motion), v_me, p_topic_key, 'open', p_language,
    v_status, p_is_private, v_code,
    -- Followers/friends rooms are never listed; code rooms keep the toggle.
    case
      when not p_is_private then true
      when v_mode <> 'code' then false
      else p_allow_spectators
    end,
    v_mode,
    p_pro_size, p_con_size, 'off', p_time_limit_seconds,
    false, false,
    p_scheduled_start, v_started, p_community
  )
  returning id into v_room_id;

  insert into public.debate_participants (room_id, user_id, role, stance)
  values (v_room_id, v_me, 'debater', p_stance);

  return query select v_room_id, v_code;
end;
$function$;

revoke all on function public.create_room(
  text, text, text, text, boolean, boolean,
  integer, integer, integer, timestamptz, uuid, text) from public, anon;
grant execute on function public.create_room(
  text, text, text, text, boolean, boolean,
  integer, integer, integer, timestamptz, uuid, text) to authenticated;
