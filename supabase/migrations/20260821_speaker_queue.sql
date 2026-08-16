-- ============================================================
-- 20260821_speaker_queue.sql
--
-- Physical speaker queue for the amphitheater: one mic, one line.
--
--   1. debate_rooms.queue_auto_advance — host toggle: when the mic frees,
--      the front of the queue is brought up automatically (open-mic) vs.
--      the host clicking "Bring up next" (curated).
--   2. debate_rooms.mic_user_id — who currently holds the mic (null = free).
--      Single explicit slot: the queue's output.
--   3. raise_hand(p_room, p_raised) — server-stamped hand raises. The old
--      client wrote its own clock's timestamp, so two near-simultaneous
--      raises could order differently per client; now() makes Postgres the
--      one true clock, so every client derives the same line.
--   4. advance_speaker_queue(p_room) — host/cohost: demote the current mic
--      holder (if any), promote the oldest raised hand to the mic.
--   5. step_down_from_mic(p_room) — the holder (or a host) frees the mic.
--
-- Queue ORDER stays fully derived: hand_raised_at asc, user_id asc as the
-- tiebreak. No queue table — the timestamps are the queue.
-- ============================================================

alter table public.debate_rooms
  add column if not exists queue_auto_advance boolean not null default false;
alter table public.debate_rooms
  add column if not exists mic_user_id uuid references public.users(id) on delete set null;

-- ── 3. raise_hand ───────────────────────────────────────────
create or replace function public.raise_hand(p_room uuid, p_raised boolean)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_locked boolean;
  v_existing uuid;
begin
  if v_me is null then raise exception 'not_authenticated' using errcode = '28000'; end if;

  select speaker_requests_locked into v_locked from public.debate_rooms where id = p_room;
  if v_locked is null then raise exception 'room_not_found' using errcode = 'P0002'; end if;
  if p_raised and coalesce(v_locked, false) then
    raise exception 'requests_locked' using errcode = 'P0001';
  end if;

  select id into v_existing
  from public.debate_participants
  where room_id = p_room and user_id = v_me;

  if v_existing is null then
    insert into public.debate_participants (room_id, user_id, role, stance, hand_raised_at)
    values (p_room, v_me, 'spectator', null, case when p_raised then now() else null end);
  else
    update public.debate_participants
       set hand_raised_at = case when p_raised then now() else null end,
           left_at = null
     where id = v_existing;
  end if;
end;
$$;

revoke all on function public.raise_hand(uuid, boolean) from public;
grant execute on function public.raise_hand(uuid, boolean) to authenticated;

-- ── 4. advance_speaker_queue ────────────────────────────────
-- Returns the new mic holder's user id (null when the queue was empty).
create or replace function public.advance_speaker_queue(p_room uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_holder uuid;
  v_next uuid;
begin
  if not public.is_stage_host(p_room) then
    raise exception 'not_host' using errcode = '42501';
  end if;

  -- Serialize concurrent advances on the room row.
  select mic_user_id into v_holder from public.debate_rooms where id = p_room for update;

  -- The outgoing holder returns to the audience (debaters keep their seat
  -- panels — only queue-promoted spectators are demoted).
  if v_holder is not null then
    update public.debate_participants
       set stage_role = 'audience'
     where room_id = p_room and user_id = v_holder
       and role = 'spectator' and left_at is null;
  end if;

  -- Oldest hand first; user_id tiebreak keeps every client's math identical.
  select user_id into v_next
  from public.debate_participants
  where room_id = p_room and left_at is null and hand_raised_at is not null
    and stage_role not in ('host', 'cohost')
  order by hand_raised_at asc, user_id asc
  limit 1;

  if v_next is null then
    update public.debate_rooms set mic_user_id = null where id = p_room;
    return null;
  end if;

  update public.debate_participants
     set stage_role = 'speaker', hand_raised_at = null
   where room_id = p_room and user_id = v_next and left_at is null;
  update public.debate_rooms set mic_user_id = v_next where id = p_room;
  return v_next;
end;
$$;

revoke all on function public.advance_speaker_queue(uuid) from public;
grant execute on function public.advance_speaker_queue(uuid) to authenticated;

-- ── 5. step_down_from_mic ───────────────────────────────────
create or replace function public.step_down_from_mic(p_room uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_holder uuid;
begin
  if v_me is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select mic_user_id into v_holder from public.debate_rooms where id = p_room for update;
  if v_holder is null then return; end if;
  if v_holder <> v_me and not public.is_stage_host(p_room) then
    raise exception 'not_holder' using errcode = '42501';
  end if;

  update public.debate_participants
     set stage_role = 'audience'
   where room_id = p_room and user_id = v_holder
     and role = 'spectator' and left_at is null;
  update public.debate_rooms set mic_user_id = null where id = p_room;
end;
$$;

revoke all on function public.step_down_from_mic(uuid) from public;
grant execute on function public.step_down_from_mic(uuid) to authenticated;
