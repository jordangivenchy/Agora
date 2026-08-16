-- ============================================================
-- 20260812_enforce_suspension.sql
--
-- users.suspended_until has been *recorded* since the moderation
-- migrations but never *enforced*: a suspended account could still
-- create rooms, join debates, queue, chat, and vote. This migration
-- closes every write path a suspended user has:
--
--   1. is_suspended() helper — single source of truth, security
--      definer so it works regardless of users-table RLS.
--   2. RESTRICTIVE RLS policies on the four direct-insert tables
--      (debate_participants, debate_queue, room_messages,
--      debate_votes). Restrictive policies AND with the existing
--      permissive ones, so no existing policy is touched.
--   3. Guards inside create_room and join_private_room — these are
--      SECURITY DEFINER and bypass RLS, so the check must live in
--      the function body. Bodies otherwise preserved verbatim from
--      the live definitions (pg_get_functiondef, 2026-08-12).
--
-- Read paths are deliberately left open: suspension silences an
-- account, it does not hide the platform from them.
-- ============================================================

-- ─── 1. Helper ───────────────────────────────────────────────
create or replace function public.is_suspended(p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select u.suspended_until > now() from public.users u where u.id = p_user),
    false
  );
$$;

revoke all on function public.is_suspended(uuid) from public;
grant execute on function public.is_suspended(uuid) to anon, authenticated;

-- ─── 2. Restrictive policies on direct-insert paths ─────────
drop policy if exists "suspended users cannot join rooms" on public.debate_participants;
create policy "suspended users cannot join rooms"
  on public.debate_participants as restrictive for insert
  with check (not public.is_suspended(auth.uid()));

drop policy if exists "suspended users cannot queue" on public.debate_queue;
create policy "suspended users cannot queue"
  on public.debate_queue as restrictive for insert
  with check (not public.is_suspended(auth.uid()));

drop policy if exists "suspended users cannot chat" on public.room_messages;
create policy "suspended users cannot chat"
  on public.room_messages as restrictive for insert
  with check (not public.is_suspended(auth.uid()));

drop policy if exists "suspended users cannot vote" on public.debate_votes;
create policy "suspended users cannot vote"
  on public.debate_votes as restrictive for insert
  with check (not public.is_suspended(auth.uid()));

-- ─── 3a. create_room guard ───────────────────────────────────
create or replace function public.create_room(
  p_motion text, p_topic_key text, p_language text, p_stance text,
  p_is_private boolean, p_allow_spectators boolean,
  p_pro_size integer, p_con_size integer,
  p_time_limit_seconds integer, p_scheduled_start timestamptz
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

  -- Generate invite code for private rooms.
  if p_is_private then
    v_code := upper(substring(md5(gen_random_uuid()::text) from 1 for 6));
  else
    v_code := null;
  end if;

  -- Scheduled rooms start in 'created' status; immediate rooms go 'live'.
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

  -- Insert room.  The enforce_max_scheduled_rooms trigger fires here so we
  -- don't need to re-implement that check.
  insert into public.debate_rooms (
    motion, host_id, topic_key, format, language,
    status, is_private, invite_code, allow_spectators,
    pro_size, con_size, fact_check_intensity, time_limit_seconds,
    allow_audience_questions, recording_consent,
    scheduled_start, started_at
  ) values (
    trim(p_motion), v_me, p_topic_key, 'open', p_language,
    v_status, p_is_private, v_code,
    case when p_is_private then p_allow_spectators else true end,
    p_pro_size, p_con_size, 'off', p_time_limit_seconds,
    false, false,
    p_scheduled_start, v_started
  )
  returning id into v_room_id;

  -- Insert host as debater in the same transaction.  If this fails the whole
  -- transaction rolls back and no zombie room is left behind.
  insert into public.debate_participants (room_id, user_id, role, stance)
  values (v_room_id, v_me, 'debater', p_stance);

  return query select v_room_id, v_code;
end;
$function$;

-- ─── 3b. join_private_room guard ─────────────────────────────
create or replace function public.join_private_room(
  p_code text, p_role text default 'debater'::text, p_stance text default null::text
)
returns table(room_id uuid, queued boolean)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user_id uuid := auth.uid(); v_room uuid;
  v_code text := upper(trim(coalesce(p_code, ''))); v_stance text := upper(trim(coalesce(p_stance, '')));
  v_existing_id uuid; v_existing_role text; v_host_id uuid; v_status text;
begin
  if v_user_id is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if public.is_suspended(v_user_id) then
    raise exception using errcode = 'P0001', message = 'account_suspended: Your account is suspended.';
  end if;
  if length(v_code) = 0 then raise exception 'invite_code_required' using errcode = '22023'; end if;
  if p_role not in ('debater', 'spectator') then raise exception 'invalid_role' using errcode = '22023'; end if;
  if p_role = 'debater' and v_stance not in ('PRO', 'CON') then raise exception 'stance_required' using errcode = '22023'; end if;
  select id, host_id, status into v_room, v_host_id, v_status
  from public.debate_rooms where invite_code = v_code and is_private = true and status in ('live', 'created') limit 1;
  if v_room is null then raise exception 'invalid_or_expired_code' using errcode = 'P0002'; end if;
  if public.is_room_banned(v_room, v_user_id) then
    raise exception using errcode = 'P0001', message = 'banned_from_room: You have been removed from this room by the host.';
  end if;
  if p_role = 'debater' and v_status = 'live' and v_user_id <> v_host_id then
    raise exception using errcode = 'P0001', message = 'debate_live: This debate is already live — join as a spectator instead.';
  end if;
  if p_role = 'spectator' then
    select id, role into v_existing_id, v_existing_role from public.debate_participants where room_id = v_room and user_id = v_user_id;
    if v_existing_id is not null then
      update public.debate_participants set role = 'spectator', stance = null, left_at = null, joined_at = now() where id = v_existing_id;
    else
      insert into public.debate_participants (room_id, user_id, role, stance) values (v_room, v_user_id, 'spectator', null);
    end if;
    return query select v_room, false; return;
  end if;
  if v_user_id = v_host_id then
    select id into v_existing_id from public.debate_participants where room_id = v_room and user_id = v_user_id;
    if v_existing_id is not null then
      update public.debate_participants set role = 'debater', stance = v_stance, left_at = null, joined_at = now() where id = v_existing_id;
    else
      insert into public.debate_participants (room_id, user_id, role, stance) values (v_room, v_user_id, 'debater', v_stance);
    end if;
    return query select v_room, false; return;
  end if;
  update public.debate_queue set status = 'cancelled' where room_id = v_room and user_id = v_user_id and status = 'waiting';
  insert into public.debate_queue (room_id, user_id, stance, status) values (v_room, v_user_id, v_stance, 'waiting');
  select id, role into v_existing_id, v_existing_role from public.debate_participants where room_id = v_room and user_id = v_user_id;
  if v_existing_id is null then
    insert into public.debate_participants (room_id, user_id, role, stance) values (v_room, v_user_id, 'spectator', null);
  elsif v_existing_role <> 'debater' then
    update public.debate_participants set role = 'spectator', stance = null, left_at = null, joined_at = now() where id = v_existing_id;
  end if;
  return query select v_room, true;
end; $function$;

-- ─── 4. UPDATE-based paths ───────────────────────────────────
-- Rejoining reactivates an old participation row (left_at = null),
-- which a suspended user must not do. Leaving (left_at = timestamp)
-- stays allowed so suspension never traps someone "inside" a room.
drop policy if exists "suspended users cannot rejoin rooms" on public.debate_participants;
create policy "suspended users cannot rejoin rooms"
  on public.debate_participants as restrictive for update
  with check (not (public.is_suspended(auth.uid()) and left_at is null));

-- Vote switching is still influencing outcomes; deleting one's own
-- vote stays allowed.
drop policy if exists "suspended users cannot switch votes" on public.debate_votes;
create policy "suspended users cannot switch votes"
  on public.debate_votes as restrictive for update
  with check (not public.is_suspended(auth.uid()));
