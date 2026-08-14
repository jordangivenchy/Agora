-- ============================================================
-- 20260819_lifecycle_and_queue_hygiene.sql
--
-- Two closely related pieces of housekeeping, both driven by a
-- once-a-minute pg_cron tick (platform_tick):
--
-- A. Scheduled-room lifecycle
--    - "Starting soon": ~10 minutes before scheduled_start, the host
--      and everyone who set a reminder get a 'room_starting_soon'
--      notification (new notification type). Sent once per room.
--    - No-shows: scheduled rooms that never went live within 30
--      minutes of their start time are cancelled (close_reason
--      'no_show') and their reminders cleaned up.
--    - Stale lobbies: unscheduled 'created' rooms older than 24h are
--      cancelled (close_reason 'expired') so the Browse tabs don't
--      fill with dead rooms.
--
-- B. Topic-queue hygiene
--    - topic_queue.last_seen_at, touched by the client's existing
--      2.5s check_topic_match poll. The matcher and the public
--      queue counts only trust entries seen in the last 30 seconds,
--      so closed tabs stop counting as "waiting" almost immediately.
--    - The tick purges entries not seen for 2 minutes.
-- ============================================================

-- ─── B1. Heartbeat column ────────────────────────────────────
alter table public.topic_queue
  add column if not exists last_seen_at timestamptz not null default now();

-- ─── B2. Poll doubles as heartbeat ───────────────────────────
create or replace function public.check_topic_match()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me   uuid := auth.uid();
  v_room uuid;
begin
  if v_me is null then return null; end if;
  -- The waiting client calls this every ~2.5s; use it as a liveness
  -- signal so ghost entries stop absorbing matches and inflating counts.
  update public.topic_queue set last_seen_at = now()
  where user_id = v_me and matched_room_id is null;

  select matched_room_id into v_room
  from public.topic_queue
  where user_id = v_me and matched_room_id is not null
  limit 1;
  if v_room is not null then
    delete from public.topic_queue where user_id = v_me and matched_room_id = v_room;
  end if;
  return v_room;
end;
$$;
revoke all on function public.check_topic_match() from public, anon;
grant execute on function public.check_topic_match() to authenticated;

-- ─── B3. Matcher trusts only fresh waiters ───────────────────
create or replace function public.queue_for_topic(p_topic uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me      uuid := auth.uid();
  v_partner uuid;
  v_room    uuid;
  v_q       record;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if public.is_suspended(v_me) then
    raise exception using errcode = 'P0001', message = 'account_suspended: Your account is suspended.';
  end if;

  select * into v_q from public.debate_topics where id = p_topic and active;
  if v_q.id is null then
    raise exception 'topic_not_found' using errcode = 'P0002';
  end if;

  -- Already waiting on this question → idempotent (and counts as a heartbeat).
  if exists (select 1 from public.topic_queue
             where topic_id = p_topic and user_id = v_me and matched_room_id is null) then
    update public.topic_queue set last_seen_at = now()
    where topic_id = p_topic and user_id = v_me;
    return jsonb_build_object('status', 'queued');
  end if;

  -- Drop stale entries so ghosts don't absorb matches.
  delete from public.topic_queue
  where topic_id = p_topic and matched_room_id is null
    and last_seen_at < now() - interval '2 minutes';

  -- Oldest FRESH waiter who isn't me and isn't suspended. Lock the row
  -- so two simultaneous joiners can't both match the same person.
  select q.user_id into v_partner
  from public.topic_queue q
  where q.topic_id = p_topic
    and q.user_id <> v_me
    and q.matched_room_id is null
    and q.last_seen_at > now() - interval '30 seconds'
    and not public.is_suspended(q.user_id)
  order by q.created_at asc
  limit 1
  for update skip locked;

  if v_partner is null then
    insert into public.topic_queue (topic_id, user_id) values (p_topic, v_me)
    on conflict (topic_id, user_id)
      do update set matched_room_id = null, created_at = now(), last_seen_at = now();
    return jsonb_build_object('status', 'queued');
  end if;

  -- Match: the room is 1v1 on the question. The longer-waiting side
  -- hosts and argues PRO; the joiner argues CON. Sides can be renegotiated
  -- in the room — this just seats people.
  insert into public.debate_rooms (
    motion, host_id, topic_key, format, language,
    status, is_private, allow_spectators,
    pro_size, con_size, fact_check_intensity, time_limit_seconds,
    allow_audience_questions, recording_consent, started_at
  ) values (
    v_q.question, v_partner, v_q.topic_key, 'open', 'EN',
    'live', false, true,
    1, 1, 'off', null,
    false, false, now()
  ) returning id into v_room;

  insert into public.debate_participants (room_id, user_id, role, stance)
  values (v_room, v_partner, 'debater', 'PRO'),
         (v_room, v_me,      'debater', 'CON');

  update public.topic_queue
  set matched_room_id = v_room
  where topic_id = p_topic and user_id = v_partner;

  return jsonb_build_object('status', 'matched', 'room_id', v_room);
end;
$$;
revoke all on function public.queue_for_topic(uuid) from public, anon;
grant execute on function public.queue_for_topic(uuid) to authenticated;

-- ─── B4. Public counts trust only fresh waiters ──────────────
create or replace function public.get_debate_topics()
returns table (
  id uuid,
  question text,
  topic_key text,
  queue_count bigint,
  am_queued boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    t.id,
    t.question,
    t.topic_key,
    (select count(*) from public.topic_queue q
      where q.topic_id = t.id and q.matched_room_id is null
        and q.last_seen_at > now() - interval '30 seconds') as queue_count,
    exists (select 1 from public.topic_queue q
             where q.topic_id = t.id and q.user_id = auth.uid()
               and q.matched_room_id is null) as am_queued
  from public.debate_topics t
  where t.active
  order by queue_count desc, t.created_at asc;
$$;
revoke all on function public.get_debate_topics() from public;
grant execute on function public.get_debate_topics() to anon, authenticated;

-- ─── A1. New notification type ───────────────────────────────
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications
  add constraint notifications_type_check
  check (type in ('new_follower', 'room_live', 'room_starting_soon'));

-- ─── A2. The minute tick ─────────────────────────────────────
create or replace function public.platform_tick()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Starting soon: host + reminder-setters, once per room, inside the
  -- 10-minute window before scheduled_start. Public rooms only.
  insert into public.notifications (user_id, type, actor_id, room_id)
  select s.uid, 'room_starting_soon', r.host_id, r.id
  from public.debate_rooms r
  cross join lateral (
    select r.host_id as uid
    union
    select rr.user_id from public.room_reminders rr where rr.room_id = r.id
  ) s
  where r.status in ('created', 'scheduled')
    and r.is_private = false
    and r.scheduled_start between now() and now() + interval '10 minutes'
    and not exists (
      select 1 from public.notifications n
      where n.room_id = r.id and n.type = 'room_starting_soon'
    );

  -- No-shows: scheduled but never went live within 30 minutes of start.
  update public.debate_rooms
     set status = 'cancelled', ended_at = now(), close_reason = 'no_show'
   where status in ('created', 'scheduled')
     and scheduled_start is not null
     and scheduled_start < now() - interval '30 minutes';

  -- Stale lobbies: unscheduled 'created' rooms older than 24 hours.
  update public.debate_rooms
     set status = 'cancelled', ended_at = now(), close_reason = 'expired'
   where status = 'created'
     and scheduled_start is null
     and created_at < now() - interval '24 hours';

  -- Reminders pointing at rooms that can no longer go live.
  delete from public.room_reminders rr
  using public.debate_rooms r
  where r.id = rr.room_id
    and r.status not in ('created', 'scheduled', 'live');

  -- Queue sweep: entries whose client stopped heartbeating.
  delete from public.topic_queue
  where matched_room_id is null
    and last_seen_at < now() - interval '2 minutes';
end;
$$;
-- Cron-only: no client role may call this.
revoke all on function public.platform_tick() from public, anon, authenticated;

-- ─── A3. Schedule it ─────────────────────────────────────────
create extension if not exists pg_cron;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'platform-tick') then
    perform cron.unschedule('platform-tick');
  end if;
  perform cron.schedule('platform-tick', '* * * * *', 'select public.platform_tick()');
end $$;
