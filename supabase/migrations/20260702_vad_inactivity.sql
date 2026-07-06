-- ============================================================
-- 20260702_vad_inactivity.sql
--
-- Voice-activity / inactivity monitoring for live debates.
--
-- Debater clients heartbeat their own participant row (last_seen_at
-- every ~15s, last_spoke_at while LiveKit VAD reports speech,
-- mic_muted on change). The close_inactive_room() function is the
-- authority: clients may REQUEST a close when their local 1s loop
-- sees the conditions, but the function re-validates everything
-- against the DB timestamps and no-ops unless the room is genuinely:
--   • silent  — no debater speech for >85s (60s warning + 30s
--               countdown, with clock tolerance)   → 'inactive'
--   • abandoned — both sides gone                  → 'inactive'
--   • one-sided — one side gone for >110s (~2 min) → 'participant_left'
-- ============================================================

alter table public.debate_participants
  add column if not exists last_seen_at  timestamptz,
  add column if not exists last_spoke_at timestamptz,
  add column if not exists mic_muted     boolean default false;

alter table public.debate_rooms
  add column if not exists close_reason text;

create or replace function public.close_inactive_room(p_room uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room        record;
  v_now         timestamptz := now();
  v_pro         record;
  v_con         record;
  v_pro_gone    timestamptz;
  v_con_gone    timestamptz;
  v_last_speech timestamptz;
  v_reason      text;
begin
  select * into v_room
  from public.debate_rooms
  where id = p_room
  for update;

  if v_room is null or v_room.status <> 'live' then
    return null;
  end if;

  -- Aggregate each side's active debaters.
  select count(*) as n,
         max(coalesce(last_seen_at, joined_at)) as seen,
         max(last_spoke_at) as spoke
    into v_pro
  from public.debate_participants
  where room_id = p_room and role = 'debater' and stance = 'PRO' and left_at is null;

  select count(*) as n,
         max(coalesce(last_seen_at, joined_at)) as seen,
         max(last_spoke_at) as spoke
    into v_con
  from public.debate_participants
  where room_id = p_room and role = 'debater' and stance = 'CON' and left_at is null;

  -- When did each side effectively disappear (graceful leave OR stale
  -- heartbeat)? Heartbeats land every ~15s, so >40s stale = disconnected.
  if v_pro.n = 0 then
    select max(left_at) into v_pro_gone
    from public.debate_participants
    where room_id = p_room and role = 'debater' and stance = 'PRO';
  elsif v_pro.seen < v_now - interval '40 seconds' then
    v_pro_gone := v_pro.seen;
  end if;

  if v_con.n = 0 then
    select max(left_at) into v_con_gone
    from public.debate_participants
    where room_id = p_room and role = 'debater' and stance = 'CON';
  elsif v_con.seen < v_now - interval '40 seconds' then
    v_con_gone := v_con.seen;
  end if;

  if v_pro_gone is not null and v_con_gone is not null then
    v_reason := 'inactive';                       -- both sides gone
  elsif v_pro_gone is not null and v_pro_gone < v_now - interval '110 seconds' then
    v_reason := 'participant_left';               -- PRO gone ~2 min
  elsif v_con_gone is not null and v_con_gone < v_now - interval '110 seconds' then
    v_reason := 'participant_left';               -- CON gone ~2 min
  elsif v_pro.n > 0 and v_con.n > 0 then
    -- Both present: check the shared silence clock.
    v_last_speech := greatest(
      coalesce(v_pro.spoke, 'epoch'::timestamptz),
      coalesce(v_con.spoke, 'epoch'::timestamptz),
      coalesce(v_room.started_at, v_room.created_at)
    );
    if v_last_speech < v_now - interval '85 seconds' then
      v_reason := 'inactive';
    end if;
  end if;

  if v_reason is null then
    return null;
  end if;

  update public.debate_rooms
     set status = 'ended',
         ended_at = v_now,
         close_reason = v_reason
   where id = p_room;

  update public.debate_queue
     set status = 'cancelled'
   where room_id = p_room and status = 'waiting';

  return v_reason;
end;
$$;

revoke all on function public.close_inactive_room(uuid) from public;
grant execute on function public.close_inactive_room(uuid) to authenticated;
