-- ============================================================
-- 20260817_topic_queues.sql
--
-- Topics v2: standing debatable QUESTIONS ("Is God real?"), each with
-- a matchmaking queue — no lobby browsing, no manual room creation.
-- Queue on a question; when a second person queues, the matcher
-- creates the room server-side, seats both as opposing speakers, and
-- each client navigates in.
--
--   debate_topics — the curated question bank (editorial content)
--   topic_queue   — one waiting row per user per question;
--                   matched_room_id set when paired
--
-- Flow:
--   queue_for_topic(q)  → {status:'queued'} or, if someone's waiting,
--                         creates the room, marks their row matched,
--                         and returns {status:'matched', room_id}
--   check_topic_match() → the waiting side polls; returns room_id
--                         once matched (and clears the row)
--   leave_topic_queue(q), get_debate_topics() for the UI.
--
-- All writes definer-RPC-only; queue rows visible only to their
-- owner. Stale entries (>30 min) are ignored by the matcher and
-- purged opportunistically.
-- ============================================================

create table if not exists public.debate_topics (
  id         uuid primary key default gen_random_uuid(),
  question   text not null unique check (char_length(question) between 5 and 200),
  topic_key  text not null default 'culture',
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.debate_topics enable row level security;
drop policy if exists "topics are readable by everyone" on public.debate_topics;
create policy "topics are readable by everyone"
  on public.debate_topics for select using (true);
-- Curation is an operator/moderator task — no client writes.

create table if not exists public.topic_queue (
  topic_id        uuid not null references public.debate_topics(id) on delete cascade,
  user_id         uuid not null references public.users(id) on delete cascade,
  matched_room_id uuid references public.debate_rooms(id) on delete set null,
  created_at      timestamptz not null default now(),
  primary key (topic_id, user_id)
);

alter table public.topic_queue enable row level security;
drop policy if exists "users see own queue entries" on public.topic_queue;
create policy "users see own queue entries"
  on public.topic_queue for select using (auth.uid() = user_id);
-- Writes via RPCs only.

-- ─── Seed the question bank ──────────────────────────────────
insert into public.debate_topics (question, topic_key) values
  ('Is God real?', 'philosophy'),
  ('Do you approve of the current administration?', 'politics-law'),
  ('Does free will exist?', 'philosophy'),
  ('Should the death penalty be abolished?', 'ethics'),
  ('Will AI do more good than harm?', 'science-tech'),
  ('Is capitalism the best system we have?', 'economics'),
  ('Should college be free?', 'economics'),
  ('Is social media bad for society?', 'culture'),
  ('Should voting be mandatory?', 'politics-law'),
  ('Is climate change humanity''s biggest threat?', 'science-tech'),
  ('Should borders be more open?', 'foreign-policy'),
  ('Are professional athletes overpaid?', 'sports')
on conflict (question) do nothing;

-- ─── Queue up (and match if possible) ────────────────────────
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

  -- Already waiting on this question → idempotent.
  if exists (select 1 from public.topic_queue
             where topic_id = p_topic and user_id = v_me and matched_room_id is null) then
    return jsonb_build_object('status', 'queued');
  end if;

  -- Drop stale entries so ghosts don't absorb matches.
  delete from public.topic_queue
  where topic_id = p_topic and matched_room_id is null
    and created_at < now() - interval '30 minutes';

  -- Oldest live waiter who isn't me and isn't suspended. Lock the row
  -- so two simultaneous joiners can't both match the same person.
  select q.user_id into v_partner
  from public.topic_queue q
  where q.topic_id = p_topic
    and q.user_id <> v_me
    and q.matched_room_id is null
    and not public.is_suspended(q.user_id)
  order by q.created_at asc
  limit 1
  for update skip locked;

  if v_partner is null then
    insert into public.topic_queue (topic_id, user_id) values (p_topic, v_me)
    on conflict (topic_id, user_id) do update set matched_room_id = null, created_at = now();
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

-- ─── Waiting side polls for its match ────────────────────────
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

-- ─── Leave a queue ───────────────────────────────────────────
create or replace function public.leave_topic_queue(p_topic uuid)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.topic_queue
  where topic_id = p_topic and user_id = auth.uid() and matched_room_id is null;
$$;

revoke all on function public.leave_topic_queue(uuid) from public, anon;
grant execute on function public.leave_topic_queue(uuid) to authenticated;

-- ─── The board ───────────────────────────────────────────────
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
        and q.created_at > now() - interval '30 minutes') as queue_count,
    exists (select 1 from public.topic_queue q
             where q.topic_id = t.id and q.user_id = auth.uid()
               and q.matched_room_id is null) as am_queued
  from public.debate_topics t
  where t.active
  order by queue_count desc, t.created_at asc;
$$;

revoke all on function public.get_debate_topics() from public;
grant execute on function public.get_debate_topics() to anon, authenticated;
