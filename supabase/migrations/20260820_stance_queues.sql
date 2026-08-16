-- ============================================================
-- 20260820_stance_queues.sql
--
-- Pick a side when you queue. Topic questions become debatable
-- STATEMENTS ("God is real") so Pro/Con reads naturally: Pro argues
-- for the statement, Con against. The matcher now pairs opposite
-- stances only — two Pros keep waiting until a Con shows up.
--
--   topic_queue.stance          — 'PRO' | 'CON' per waiting row
--   queue_for_topic(topic, s)   — stance-aware; seats each side as
--                                 the stance they chose
--   get_debate_topics()         — per-side counts + my stance
-- ============================================================

-- ─── Stance on the queue row ─────────────────────────────────
alter table public.topic_queue
  add column if not exists stance text not null default 'PRO'
  check (stance in ('PRO', 'CON'));

-- ─── Rephrase the bank: questions → statements ───────────────
update public.debate_topics set question = v.new_q
from (values
  ('Is God real?',                                'God is real'),
  ('Do you approve of the current administration?','The current administration is doing a good job'),
  ('Does free will exist?',                       'Free will exists'),
  ('Should the death penalty be abolished?',      'The death penalty should be abolished'),
  ('Will AI do more good than harm?',             'AI will do more good than harm'),
  ('Is capitalism the best system we have?',      'Capitalism is the best system we have'),
  ('Should college be free?',                     'College should be free'),
  ('Is social media bad for society?',            'Social media does more harm than good'),
  ('Should voting be mandatory?',                 'Voting should be mandatory'),
  ('Is climate change humanity''s biggest threat?','Climate change is humanity''s biggest threat'),
  ('Should borders be more open?',                'Borders should be more open'),
  ('Are professional athletes overpaid?',         'Professional athletes are overpaid')
) as v(old_q, new_q)
where public.debate_topics.question = v.old_q;

-- ─── Queue up on a side (and match if the other side waits) ──
drop function if exists public.queue_for_topic(uuid);
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
    raise exception using errcode = 'P0001', message = 'bad_stance: Pick Pro or Con.';
  end if;

  select * into v_q from public.debate_topics where id = p_topic and active;
  if v_q.id is null then
    raise exception 'topic_not_found' using errcode = 'P0002';
  end if;

  -- Already waiting on this question → heartbeat, and allow switching sides.
  if exists (select 1 from public.topic_queue
             where topic_id = p_topic and user_id = v_me and matched_room_id is null) then
    update public.topic_queue set last_seen_at = now(), stance = p_stance
    where topic_id = p_topic and user_id = v_me;
    return jsonb_build_object('status', 'queued');
  end if;

  -- Drop stale entries so ghosts don't absorb matches.
  delete from public.topic_queue
  where topic_id = p_topic and matched_room_id is null
    and last_seen_at < now() - interval '2 minutes';

  -- Oldest FRESH waiter on the OPPOSITE side who isn't me and isn't
  -- suspended. Lock the row so two simultaneous joiners can't both
  -- match the same person.
  select q.user_id, q.stance into v_partner, v_partner_stance
  from public.topic_queue q
  where q.topic_id = p_topic
    and q.user_id <> v_me
    and q.matched_room_id is null
    and q.stance <> p_stance
    and q.last_seen_at > now() - interval '30 seconds'
    and not public.is_suspended(q.user_id)
  order by q.created_at asc
  limit 1
  for update skip locked;

  if v_partner is null then
    insert into public.topic_queue (topic_id, user_id, stance) values (p_topic, v_me, p_stance)
    on conflict (topic_id, user_id)
      do update set matched_room_id = null, created_at = now(), last_seen_at = now(), stance = p_stance;
    return jsonb_build_object('status', 'queued');
  end if;

  -- Match: 1v1 on the statement, each side seated as the stance they
  -- chose. The longer-waiting side hosts.
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
  values (v_room, v_partner, 'debater', v_partner_stance),
         (v_room, v_me,      'debater', p_stance);

  update public.topic_queue
  set matched_room_id = v_room
  where topic_id = p_topic and user_id = v_partner;

  return jsonb_build_object('status', 'matched', 'room_id', v_room);
end;
$$;
revoke all on function public.queue_for_topic(uuid, text) from public, anon;
grant execute on function public.queue_for_topic(uuid, text) to authenticated;

-- ─── The board: per-side counts ──────────────────────────────
drop function if exists public.get_debate_topics();
create or replace function public.get_debate_topics()
returns table (
  id uuid,
  question text,
  topic_key text,
  queue_count bigint,
  pro_count bigint,
  con_count bigint,
  am_queued boolean,
  my_stance text
)
language sql
stable
security definer
set search_path = public
as $$
  with fresh as (
    select q.topic_id, q.user_id, q.stance
    from public.topic_queue q
    where q.matched_room_id is null
      and q.last_seen_at > now() - interval '30 seconds'
  )
  select
    t.id,
    t.question,
    t.topic_key,
    (select count(*) from fresh f where f.topic_id = t.id) as queue_count,
    (select count(*) from fresh f where f.topic_id = t.id and f.stance = 'PRO') as pro_count,
    (select count(*) from fresh f where f.topic_id = t.id and f.stance = 'CON') as con_count,
    exists (select 1 from public.topic_queue q
             where q.topic_id = t.id and q.user_id = auth.uid()
               and q.matched_room_id is null) as am_queued,
    (select q.stance from public.topic_queue q
      where q.topic_id = t.id and q.user_id = auth.uid()
        and q.matched_room_id is null) as my_stance
  from public.debate_topics t
  where t.active
  order by queue_count desc, t.created_at asc;
$$;
revoke all on function public.get_debate_topics() from public;
grant execute on function public.get_debate_topics() to anon, authenticated;
