-- Two access-control changes to private rooms, both flowing through the
-- single can_enter_room predicate (RLS on rooms/participants/messages/
-- utterances, the replay RPC, the LiveKit token route, the gate screen):
--
-- 1. CODE-ROOM PRIVACY FIX: can_enter_room returned true for anyone on
--    access_mode='code', ignoring allow_spectators — a fully-hidden code
--    room (and its replay) was readable and watchable with just the
--    link, no code. Now code rooms admit non-participants only when
--    allow_spectators is on (the documented "listed, spectate-only"
--    behavior); hidden ones are host/participants-only, and the denial
--    screen's invite-code input redeems the code via join_private_room
--    to seat everyone else.
--
-- 2. COMMUNITY-LOCKED ROOMS: new access_mode='community' — a private
--    room tied to a board that only that board's members may enter.
--    Created by community mods (create_room already requires mod for
--    community rooms); the invite code remains the escape hatch.

-- ── Constraint: allow the new mode ──────────────────────────────────
alter table public.debate_rooms drop constraint if exists debate_rooms_access_mode_check;
alter table public.debate_rooms add constraint debate_rooms_access_mode_check
  check (access_mode = any (array['code'::text, 'followers'::text, 'friends'::text, 'community'::text]));

-- ── The predicate ───────────────────────────────────────────────────
create or replace function public.can_enter_room(p_room uuid, p_user uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  select coalesce((
    select case
      when r.is_private = false then true
      -- Signed-out visitors can still watch listed spectatable code rooms.
      when p_user is null then (r.access_mode = 'code' and coalesce(r.allow_spectators, false))
      when p_user = r.host_id then true
      when public.is_room_banned(r.id, p_user) then false
      when exists (
        select 1 from debate_participants dp
        where dp.room_id = r.id and dp.user_id = p_user
      ) then true
      when r.access_mode = 'followers' then exists (
        select 1 from user_follows f
        where f.follower_id = p_user and f.following_id = r.host_id
      )
      when r.access_mode = 'friends' then public.are_friends(p_user, r.host_id)
      when r.access_mode = 'community' then r.community_id is not null and exists (
        select 1 from community_members cm
        where cm.community_id = r.community_id and cm.user_id = p_user
      )
      -- 'code': spectatable code rooms stay open to watch (that's their
      -- documented listing behavior); hidden ones are host/participants
      -- only — join_private_room seats you once you present the code.
      when r.access_mode = 'code' then coalesce(r.allow_spectators, false)
      else false
    end
    from debate_rooms r where r.id = p_room
  ), false);
$function$;

-- ── create_room: accept the new mode ────────────────────────────────
create or replace function public.create_room(
  p_motion text, p_topic_key text, p_language text, p_stance text,
  p_is_private boolean, p_allow_spectators boolean,
  p_pro_size integer, p_con_size integer, p_time_limit_seconds integer,
  p_scheduled_start timestamptz,
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

  if v_mode not in ('code', 'followers', 'friends', 'community') then
    raise exception 'invalid_access_mode' using errcode = '22023';
  end if;
  if v_mode = 'community' and p_community is null then
    raise exception 'community_mode_requires_community' using errcode = '22023';
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
    -- Followers/friends/community rooms are never listed; code rooms keep the toggle.
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

-- ── get_room_gate: carry the board name for the denial copy ─────────
drop function if exists public.get_room_gate(uuid);
create function public.get_room_gate(p_room uuid)
returns table(room_exists boolean, allowed boolean, motion text, host_username text, access_mode text, status text, community_name text)
language sql
stable security definer
set search_path to 'public'
as $function$
  select true,
         public.can_enter_room(r.id, auth.uid()),
         r.motion,
         u.username,
         r.access_mode,
         r.status,
         c.name
  from public.debate_rooms r
  join public.users u on u.id = r.host_id
  left join public.communities c on c.id = r.community_id
  where r.id = p_room;
$function$;

grant execute on function public.get_room_gate(uuid) to anon, authenticated;
