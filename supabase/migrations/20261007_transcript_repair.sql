-- Replay transcripts: names on the lines again, and long recordings that
-- finish.
--
-- What was wrong (2026-10-06): of 81 transcript lines across 24
-- recordings, none had a speaker. Names came from the browser's live
-- captions (debate_utterances), which stopped with Agora's listening on
-- 09-12. And the two recordings that failed were the long ones (24 and
-- 42 minutes): the whole recording had to be fetched and transcribed
-- inside one request, a busy model or a rate-limited bucket ended it,
-- and after three tries the job gave up for good.
--
-- 1. recording_speech_spans: who was speaking when, noted by the page
--    LiveKit films for the recording (it sees the call's "speaking"
--    state for everyone, on the clock that stamps the recording) and
--    posted to /api/internal/recording-speech.
-- 2. replay_transcripts.progress / next_attempt_at: the transcript job
--    saves each few minutes it finishes and carries on in the next run;
--    a run that gets nowhere waits longer each time (the route decides).
-- 3. Transcripts already made for rooms with one person on the stage
--    get that person's name on their lines.

-- ── 1. who was speaking ─────────────────────────────────────────────
create table if not exists public.recording_speech_spans (
  id         bigint generated always as identity primary key,
  room_id    uuid not null references public.debate_rooms(id) on delete cascade,
  -- The speaker's identity in the call: their account id.
  user_id    uuid not null,
  -- On the recorder's clock, the one the playlist's
  -- EXT-X-PROGRAM-DATE-TIME tags are written from.
  started_at timestamptz not null,
  ended_at   timestamptz not null,
  check (ended_at > started_at)
);

create index if not exists recording_speech_spans_room_idx
  on public.recording_speech_spans (room_id, started_at);

-- Written by the recorder's endpoint and read by the transcript job,
-- both with the service role. Nobody else: no policies.
alter table public.recording_speech_spans enable row level security;
revoke all on public.recording_speech_spans from anon, authenticated;

-- A room's spans in one answer ([[user_id, from_ms, to_ms], …]) — a long
-- room has more rows than one page of the API returns.
create or replace function public.recording_speech_for(p_room uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_array(
        user_id,
        (extract(epoch from started_at) * 1000)::bigint,
        (extract(epoch from ended_at) * 1000)::bigint
      )
      order by started_at
    ),
    '[]'::jsonb
  )
  from public.recording_speech_spans
  where room_id = p_room;
$$;

revoke execute on function public.recording_speech_for(uuid) from public, anon, authenticated;

-- ── 2. a job that carries on ────────────────────────────────────────
alter table public.replay_transcripts
  -- {v, sig, next, clips: [{from, to, lines: [{t, e, text}]}], model}:
  -- the clips finished so far (lib/replayTranscribe TranscriptProgress).
  -- Cleared when the transcript is done.
  add column if not exists progress jsonb,
  -- When a queued job may run again. Null: ten minutes after its last change.
  add column if not exists next_attempt_at timestamptz;

-- Enqueue: recorded ended rooms with a finalized recording and no
-- finished transcript, three a tick, a recording already under way
-- first. The route owns the counting now: it leaves a job "queued" with
-- the time to come back (at once after a run that got somewhere, later
-- and later after one that didn't) and marks it "failed" only when it
-- has given up. "failed" with fewer than three tries is the earlier
-- route's, retried as before. A job still "processing" after eight
-- minutes belongs to a run that was stopped (a request lasts five).
create or replace function public.enqueue_replay_transcriptions()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r record;
  v_secret text;
  v_origin text;
  n integer := 0;
begin
  select value into v_secret from public.app_config where key = 'reminder_webhook_secret';
  select value into v_origin from public.app_config where key = 'app_origin';
  if v_secret is null or v_origin is null then return 0; end if;

  -- Once a day: speaking notes older than the window transcripts are made in.
  if extract(hour from now()) = 9 and extract(minute from now()) < 2 then
    delete from public.recording_speech_spans where started_at < now() - interval '35 days';
  end if;

  for r in
    select dr.id
    from public.debate_rooms dr
    left join public.replay_transcripts t on t.room_id = dr.id
    where dr.status = 'ended'
      and dr.recording_url is not null
      -- recording_ended_at is missing on rooms whose egress leaked
      -- (pre-20260879); the room's own end time is a safe stand-in.
      and coalesce(dr.recording_ended_at, dr.ended_at) < now() - interval '2 minutes'
      and coalesce(dr.recording_ended_at, dr.ended_at) > now() - interval '30 days'
      and (
        t.room_id is null
        or (t.status = 'queued' and coalesce(t.next_attempt_at, t.updated_at + interval '10 minutes') <= now())
        or (t.status = 'failed' and t.attempts < 3 and t.updated_at < now() - interval '10 minutes')
        or (t.status = 'processing' and t.updated_at < now() - interval '8 minutes')
      )
    order by (t.progress is not null) desc, coalesce(dr.recording_ended_at, dr.ended_at) desc
    limit 3
  loop
    -- The row is left as it is when it exists: the route reads how
    -- long a "processing" job has been quiet from updated_at.
    insert into public.replay_transcripts (room_id)
    values (r.id)
    on conflict (room_id) do nothing;

    perform net.http_post(
      url := v_origin || '/api/internal/transcribe-replay',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_secret
      ),
      body := jsonb_build_object('roomId', r.id)
    );
    n := n + 1;
  end loop;

  return n;
end;
$$;

revoke execute on function public.enqueue_replay_transcriptions() from public, anon, authenticated;

-- ── 3. names on the transcripts already made ────────────────────────
-- A room with one person on its stage: every line is theirs. (All 24
-- recordings so far are such rooms.) Lines that already name someone
-- are left alone, so this is safe to run again.
with solo as (
  select p.room_id, (array_agg(distinct p.user_id))[1] as user_id
  from public.debate_participants p
  where p.user_id is not null
    and (p.role = 'debater' or (p.stage_role is not null and p.stage_role <> 'audience'))
  group by p.room_id
  having count(distinct p.user_id) = 1
)
update public.replay_transcripts t
set lines = (
  select jsonb_agg(
           x.l || jsonb_build_object(
             'user_id', u.id,
             'username', u.username,
             'display_name', u.display_name,
             'avatar_url', u.avatar_url
           )
           order by x.ord
         )
  from jsonb_array_elements(t.lines) with ordinality as x(l, ord)
)
from solo
join public.users u on u.id = solo.user_id
where t.room_id = solo.room_id
  and t.status = 'done'
  and jsonb_typeof(t.lines) = 'array'
  and jsonb_array_length(t.lines) > 0
  and not exists (
    select 1 from jsonb_array_elements(t.lines) l where coalesce(l->>'user_id', '') <> ''
  );
