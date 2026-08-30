-- Post-run replay transcription (v1). The live transcript is per-speaker
-- browser Web Speech — Chrome-only, opt-in, gappy. After a recorded room
-- ends, a cron enqueues it to /api/internal/transcribe-replay, which
-- extracts the recording's AAC audio and produces a polished transcript
-- with Gemini (speaker attribution aligned from the live utterances).
-- The replay page prefers this transcript when present.

create table if not exists public.replay_transcripts (
  room_id    uuid primary key references public.debate_rooms(id) on delete cascade,
  status     text not null default 'queued'
             check (status in ('queued', 'processing', 'done', 'failed', 'skipped')),
  attempts   integer not null default 0,
  model      text,
  error      text,
  -- [{offset_seconds, text, user_id, username, display_name, avatar_url}]
  -- offsets in the recording_started_at frame, same as live utterances.
  lines      jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.replay_transcripts enable row level security;

-- Same gate as the transcript's other sources: readable iff the room is.
create policy "replay transcripts readable when room enterable"
  on public.replay_transcripts for select
  using (public.can_enter_room(room_id, auth.uid()));

revoke all on public.replay_transcripts from anon, authenticated;
grant select on public.replay_transcripts to anon, authenticated;

-- Enqueue: recorded ended rooms with a finalized recording and no
-- finished transcript. Retries queued/failed after 10 min and stuck
-- processing after 20 min, three attempts max, 3 rooms per tick.
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

  for r in
    select dr.id
    from public.debate_rooms dr
    left join public.replay_transcripts t on t.room_id = dr.id
    where dr.status = 'ended'
      and dr.recording_url is not null
      and dr.recording_ended_at is not null
      and dr.recording_ended_at < now() - interval '2 minutes'
      and dr.recording_ended_at > now() - interval '30 days'
      and (
        t.room_id is null
        or (t.status in ('queued', 'failed') and t.attempts < 3 and t.updated_at < now() - interval '10 minutes')
        or (t.status = 'processing' and t.attempts < 3 and t.updated_at < now() - interval '20 minutes')
      )
    order by dr.recording_ended_at desc
    limit 3
  loop
    insert into public.replay_transcripts (room_id)
    values (r.id)
    on conflict (room_id) do update set updated_at = now();

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

select cron.schedule(
  'replay-transcripts',
  '*/2 * * * *',
  'select public.enqueue_replay_transcriptions()'
);
