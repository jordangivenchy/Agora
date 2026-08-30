-- AFK rooms: an idle host with the tab open heartbeats forever, so none
-- of the absence-based backstops fire and the recording rolls unbounded.
-- Two new rules, run by the same every-minute room-lifecycle cron
-- (ending a live room fires trg_notify_room_ended, which stops the
-- egress server-side):
--
-- 1. Silence: a live room whose transcript was flowing (≥1 utterance —
--    proof transcription works there, so silence is real) but has had
--    no utterance AND no chat message for 20 minutes ends as inactive.
--    Listening-heavy rooms are safe: someone must be speaking to be
--    listened to, and chat counts as activity too.
-- 2. Absolute cap: any recording running past 3 hours ends the room
--    regardless — catches the transcription-off AFK marathon. Bounds
--    worst-case waste to ~6 GB (vs unbounded).

create or replace function public.end_idle_rooms()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  n integer := 0;
  m integer := 0;
begin
  -- Rule 1: transcribed room gone silent (no speech, no chat) for 20 min.
  update public.debate_rooms r
  set status       = 'ended',
      ended_at     = now(),
      host_left_at = null,
      close_reason = coalesce(r.close_reason, 'inactive')
  where r.status = 'live'
    and exists (select 1 from public.debate_utterances u where u.room_id = r.id)
    and greatest(
          coalesce((select max(u.created_at) from public.debate_utterances u where u.room_id = r.id), 'epoch'::timestamptz),
          coalesce((select max(msg.created_at) from public.room_messages msg where msg.room_id = r.id), 'epoch'::timestamptz),
          coalesce(r.started_at, r.created_at)
        ) < now() - interval '20 minutes';
  get diagnostics n = row_count;

  -- Rule 2: recording has run past the 3-hour hard cap.
  update public.debate_rooms r
  set status       = 'ended',
      ended_at     = now(),
      host_left_at = null,
      close_reason = coalesce(r.close_reason, 'inactive')
  where r.status = 'live'
    and r.recording_started_at is not null
    and r.recording_ended_at is null
    and r.recording_started_at < now() - interval '3 hours';
  get diagnostics m = row_count;

  return n + m;
end;
$$;

revoke execute on function public.end_idle_rooms() from public, anon, authenticated;

-- Ride the existing every-minute lifecycle job.
select cron.alter_job(
  (select jobid from cron.job where jobname = 'room-lifecycle'),
  command := 'select public.end_hostless_rooms() + public.end_idle_rooms()'
);
