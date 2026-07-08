-- ============================================================
-- 20260422_hardening.sql
-- Three security/integrity fixes from adversarial review:
--   1. get_user_live_and_scheduled — stop leaking private room
--      data to arbitrary callers; private rooms are only returned
--      when the caller IS the target user.
--   2. approve_queue_entry — serialize with FOR UPDATE lock so
--      concurrent approvals cannot overbook a stance slot.
--   3. create_room — new atomic RPC that creates the room AND
--      inserts the host participant in a single transaction so
--      partial-failure "zombie rooms" are impossible.
-- ============================================================


-- ─── 1. Fix get_user_live_and_scheduled privacy gate ───────────────────────
--
-- Old filter: (r.is_private = false OR r.allow_spectators = true)
-- Problem:    any authenticated or anonymous caller could see another user's
--             private debates as long as spectators are allowed, exposing
--             motion, scheduled_start, and host_id.
-- Fix:        private rooms are only returned when auth.uid() = p_user
--             (the caller is looking at their own profile). Everyone else sees
--             only public rooms for that user.
-- ───────────────────────────────────────────────────────────────────────────

create or replace function public.get_user_live_and_scheduled(p_user uuid)
returns table (
  room_id         uuid,
  motion          text,
  topic_key       text,
  status          text,
  stance          text,
  started_at      timestamptz,
  scheduled_start timestamptz,
  is_scheduled    boolean,
  is_private      boolean,
  host_id         uuid
)
language sql
stable
security definer
set search_path = public
as $$
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
$$;

revoke all on function public.get_user_live_and_scheduled(uuid) from public;
grant execute on function public.get_user_live_and_scheduled(uuid) to authenticated, anon;


-- ─── 2. Fix approve_queue_entry race condition ──────────────────────────────
--
-- Old:  reads room row, counts taken slots, then mutates — no lock, so two
--       concurrent calls can both see v_taken < capacity and both succeed.
-- Fix:  lock the debate_rooms row FOR UPDATE before counting, serializing all
--       concurrent approvals for the same room.
-- ───────────────────────────────────────────────────────────────────────────

create or replace function public.approve_queue_entry(p_entry uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me          uuid := auth.uid();
  v_room        uuid;
  v_user        uuid;
  v_stance      text;
  v_status      text;
  v_host        uuid;
  v_pro_size    int;
  v_con_size    int;
  v_room_status text;
  v_taken       int;
  v_existing_id uuid;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  -- Read the queue entry first (no lock needed here).
  select q.room_id, q.user_id, q.stance, q.status
    into v_room, v_user, v_stance, v_status
  from public.debate_queue q
  where q.id = p_entry;

  if v_room is null then
    raise exception 'queue_entry_not_found' using errcode = 'P0002';
  end if;

  if v_status <> 'waiting' then
    raise exception 'queue_entry_not_waiting' using errcode = 'P0001';
  end if;

  -- Lock the room row so concurrent approve calls on the same room are
  -- serialized.  All capacity checks and mutations happen inside this lock.
  select r.host_id, r.pro_size, r.con_size, r.status
    into v_host, v_pro_size, v_con_size, v_room_status
  from public.debate_rooms r
  where r.id = v_room
  for update;

  if v_host <> v_me then
    raise exception 'not_host' using errcode = '42501';
  end if;

  if v_room_status not in ('created', 'live') then
    raise exception 'room_not_active' using errcode = 'P0001';
  end if;

  -- Re-count inside the lock so we see the committed state after any
  -- concurrent approval that grabbed the lock just before us.
  select count(*) into v_taken
  from public.debate_participants
  where room_id = v_room
    and role    = 'debater'
    and stance  = v_stance
    and left_at is null
    and user_id <> v_user;

  if v_stance = 'PRO' and v_taken >= v_pro_size then
    raise exception 'pro_slot_full' using errcode = 'P0001';
  end if;
  if v_stance = 'CON' and v_taken >= v_con_size then
    raise exception 'con_slot_full' using errcode = 'P0001';
  end if;

  -- Upsert participant row.
  select id into v_existing_id
  from public.debate_participants
  where room_id = v_room and user_id = v_user;

  if v_existing_id is not null then
    update public.debate_participants
       set role     = 'debater',
           stance   = v_stance,
           left_at  = null,
           joined_at = now()
     where id = v_existing_id;
  else
    insert into public.debate_participants (room_id, user_id, role, stance)
    values (v_room, v_user, 'debater', v_stance);
  end if;

  update public.debate_queue
     set status = 'matched'
   where id = p_entry;
end;
$$;

revoke all on function public.approve_queue_entry(uuid) from public;
grant execute on function public.approve_queue_entry(uuid) to authenticated;


-- ─── 3. Atomic room creation RPC ───────────────────────────────────────────
--
-- Old:  client inserts debate_rooms, then inserts debate_participants in two
--       separate round-trips.  A network drop after the first write leaves a
--       zombie room with no host participant and burns a scheduled-room slot.
-- Fix:  single plpgsql function that does both inserts in one transaction.
--       Returns (room_id, invite_code) so the client never needs to stitch.
-- ───────────────────────────────────────────────────────────────────────────

create or replace function public.create_room(
  p_motion              text,
  p_topic_key           text,
  p_language            text,
  p_stance              text,         -- host's initial stance: 'PRO' | 'CON'
  p_is_private          boolean,
  p_allow_spectators    boolean,
  p_pro_size            int,
  p_con_size            int,
  p_time_limit_seconds  int,          -- null = no limit
  p_scheduled_start     timestamptz   -- null = start immediately
)
returns table (room_id uuid, invite_code text)
language plpgsql
security definer
set search_path = public
as $$
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
$$;

revoke all on function public.create_room(text,text,text,text,boolean,boolean,int,int,int,timestamptz) from public;
grant execute on function public.create_room(text,text,text,text,boolean,boolean,int,int,int,timestamptz) to authenticated;
