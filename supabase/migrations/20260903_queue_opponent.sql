-- Who to be matched with: anyone, or only someone who disagrees (holds
-- the other side). Kept on the queue row so a waiter's wish is honoured
-- when someone else joins, and passed by the joiner for their own.

alter table public.topic_queue add column if not exists opponent text not null default 'anyone';
alter table public.topic_queue drop constraint if exists topic_queue_opponent_check;
alter table public.topic_queue add constraint topic_queue_opponent_check check (opponent in ('anyone', 'disagree'));

drop function if exists public.queue_for_topic(uuid, text);
create or replace function public.queue_for_topic(p_topic uuid, p_stance text default 'PRO', p_opponent text default 'anyone')
returns jsonb language plpgsql security definer set search_path = public as $$
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
  if p_stance not in ('PRO', 'CON') then p_stance := 'PRO'; end if;
  if p_opponent not in ('anyone', 'disagree') then p_opponent := 'anyone'; end if;

  select * into v_q from public.debate_topics where id = p_topic and active;
  if v_q.id is null then
    raise exception 'topic_not_found' using errcode = 'P0002';
  end if;

  -- Already waiting on this question → heartbeat (and the latest wish).
  if exists (select 1 from public.topic_queue
             where topic_id = p_topic and user_id = v_me and matched_room_id is null) then
    update public.topic_queue set last_seen_at = now(), stance = p_stance, opponent = p_opponent
    where topic_id = p_topic and user_id = v_me;
    return jsonb_build_object('status', 'queued');
  end if;

  -- Drop stale entries so ghosts don't absorb matches.
  delete from public.topic_queue
  where topic_id = p_topic and matched_room_id is null
    and last_seen_at < now() - interval '2 minutes';

  -- The longest-waiting fresh partner who isn't me and isn't suspended,
  -- honouring both wishes: if either of us only wants disagreement, the
  -- sides must differ. Someone on the other side is preferred anyway.
  -- Locked so two simultaneous joiners can't both take them.
  select q.user_id, q.stance into v_partner, v_partner_stance
  from public.topic_queue q
  where q.topic_id = p_topic
    and q.user_id <> v_me
    and q.matched_room_id is null
    and q.last_seen_at > now() - interval '30 seconds'
    and not public.is_suspended(q.user_id)
    and (p_opponent = 'anyone' or coalesce(q.stance, 'PRO') <> p_stance)
    and (q.opponent = 'anyone' or coalesce(q.stance, 'PRO') <> p_stance)
  order by (coalesce(q.stance, 'PRO') <> p_stance) desc, q.created_at asc
  limit 1
  for update skip locked;

  if v_partner is null then
    insert into public.topic_queue (topic_id, user_id, stance, opponent) values (p_topic, v_me, p_stance, p_opponent)
    on conflict (topic_id, user_id)
      do update set matched_room_id = null, created_at = now(), last_seen_at = now(), stance = excluded.stance, opponent = excluded.opponent;
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

drop function if exists public.queue_for_headline(text, text, text, text);
create or replace function public.queue_for_headline(p_question text, p_topic_key text, p_stance text default 'PRO', p_source_url text default null, p_opponent text default 'anyone')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me   uuid := auth.uid();
  v_q    text := btrim(regexp_replace(coalesce(p_question, ''), '\s+', ' ', 'g'));
  v_id   uuid;
  v_made int;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if public.is_suspended(v_me) then
    raise exception using errcode = 'P0001', message = 'account_suspended: Your account is suspended.';
  end if;
  if char_length(v_q) < 5 or char_length(v_q) > 200 then
    raise exception using errcode = 'P0001', message = 'bad_question: Headline must be 5–200 characters.';
  end if;
  if p_topic_key not in ('politics-law','politics-ethics','sports','culture','economics','science-tech','foreign-policy','philosophy') then
    raise exception using errcode = 'P0001', message = 'bad_topic: Unknown field.';
  end if;
  if p_source_url is not null and p_source_url !~ '^https://' then
    raise exception using errcode = 'P0001', message = 'bad_source: Source must be an https URL.';
  end if;

  select id into v_id from public.debate_topics where question = v_q;

  if v_id is null then
    select count(*) into v_made
    from public.debate_topics
    where created_by = v_me and created_at > now() - interval '1 hour';
    if v_made >= 10 then
      raise exception using errcode = 'P0001', message = 'rate_limited: Too many new questions this hour.';
    end if;

    insert into public.debate_topics (question, topic_key, active, created_by, source_url)
    values (v_q, p_topic_key, true, v_me, p_source_url)
    returning id into v_id;
  else
    update public.debate_topics set active = true where id = v_id and not active;
  end if;

  return public.queue_for_topic(v_id, p_stance, p_opponent) || jsonb_build_object('topic_id', v_id);
end;
$$;
