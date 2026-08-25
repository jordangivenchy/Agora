-- ─── Stanceless matchmaking ──────────────────────────────────────────
-- Pro/Con is gone as a product concept: queueing on a question matches
-- you with the oldest fresh waiter, period — no sides to pick, no
-- same-side strangers waiting forever next to each other. The stance
-- columns stay (participants are still seated in the two stage boxes),
-- but they're assigned automatically: the joiner takes the opposite
-- seat of whoever they matched with. p_stance is kept in the signature
-- for older clients and used only as the seat when nobody is waiting.

create or replace function public.queue_for_topic(p_topic uuid, p_stance text default 'PRO')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me      uuid := auth.uid();
  v_partner uuid;
  v_partner_stance text;
  v_my_stance text;
  v_room    uuid;
  v_q       record;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if public.is_suspended(v_me) then
    raise exception using errcode = 'P0001', message = 'account_suspended: Your account is suspended.';
  end if;
  if p_stance not in ('PRO', 'CON') then
    p_stance := 'PRO';
  end if;

  select * into v_q from public.debate_topics where id = p_topic and active;
  if v_q.id is null then
    raise exception 'topic_not_found' using errcode = 'P0002';
  end if;

  -- Already waiting on this question → heartbeat.
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

  -- Oldest FRESH waiter who isn't me and isn't suspended — ANY seat.
  -- Lock the row so two simultaneous joiners can't both match them.
  select q.user_id, q.stance into v_partner, v_partner_stance
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
    insert into public.topic_queue (topic_id, user_id, stance) values (p_topic, v_me, p_stance)
    on conflict (topic_id, user_id)
      do update set matched_room_id = null, created_at = now(), last_seen_at = now(), stance = excluded.stance;
    return jsonb_build_object('status', 'queued');
  end if;

  -- Seat the joiner opposite their partner; the longer-waiting side hosts.
  v_my_stance := case when coalesce(v_partner_stance, 'PRO') = 'PRO' then 'CON' else 'PRO' end;

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
  values (v_room, v_partner, 'debater', coalesce(v_partner_stance, 'PRO')),
         (v_room, v_me,      'debater', v_my_stance);

  update public.topic_queue
  set matched_room_id = v_room
  where topic_id = p_topic and user_id = v_partner;

  return jsonb_build_object('status', 'matched', 'room_id', v_room);
end;
$$;
revoke all on function public.queue_for_topic(uuid, text) from public, anon;
grant execute on function public.queue_for_topic(uuid, text) to authenticated;
