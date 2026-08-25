-- ─── VOD recording: host control + storage allowance ─────────────────
-- Recording every debate is now a per-user choice (user_settings.
-- record_debates, default on), and each host has a storage allowance
-- (users.recording_storage_limit_mb, default 5 GB) their recordings
-- count against. The allowance is the future paid-plan lever: a
-- subscription simply raises the number.
--
-- Sizes are estimated, not measured: the egress encodes 1080p30 at
-- 4.5 Mbps video + 128 kbps audio ≈ 578 KB/s of segments, so bytes =
-- seconds × 578000. A trigger stamps the estimate the moment a
-- recording ends, whatever path ended it (host stop, close-stage,
-- cron, webhook).

alter table public.user_settings
  add column if not exists record_debates boolean not null default true;

alter table public.users
  add column if not exists recording_storage_limit_mb integer not null default 5120;

alter table public.debate_rooms
  add column if not exists recording_bytes bigint;

create or replace function public.stamp_recording_bytes()
returns trigger
language plpgsql
as $$
begin
  if new.recording_ended_at is not null and old.recording_ended_at is null
     and new.recording_started_at is not null then
    new.recording_bytes :=
      greatest(0, extract(epoch from (new.recording_ended_at - new.recording_started_at)))::bigint * 578000;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_stamp_recording_bytes on public.debate_rooms;
create trigger trg_stamp_recording_bytes
before update on public.debate_rooms
for each row execute function public.stamp_recording_bytes();

-- Recordings whose egress died without a clean stop never got
-- recording_ended_at — close them at the room's own end time so they
-- don't count as still-growing forever.
update public.debate_rooms
set recording_ended_at = coalesce(ended_at, recording_started_at)
where recording_url is not null
  and recording_ended_at is null
  and status = 'ended';

-- Backfill the estimate for recordings that already ended. (The
-- trigger above only fires on future transitions.)
update public.debate_rooms
set recording_bytes =
  greatest(0, extract(epoch from (recording_ended_at - recording_started_at)))::bigint * 578000
where recording_url is not null
  and recording_started_at is not null
  and recording_ended_at is not null
  and recording_bytes is null;

-- One call answers the settings page and the egress gate: how much of
-- my allowance is used, what is my limit, is recording on. An
-- in-progress recording counts at its current elapsed length.
create or replace function public.get_recording_usage()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'used_bytes', coalesce((
      select sum(coalesce(
        r.recording_bytes,
        case when r.recording_started_at is not null
          -- live rooms count at current elapsed length; an ended room
          -- whose recording never closed cleanly is capped at the
          -- room's own end time, never treated as still growing
          then greatest(0, extract(epoch from (
            coalesce(r.recording_ended_at,
                     case when r.status = 'ended' then coalesce(r.ended_at, r.recording_started_at) end,
                     now()) - r.recording_started_at)))::bigint * 578000
          else 0 end
      ))
      from public.debate_rooms r
      where r.host_id = auth.uid() and r.recording_url is not null
    ), 0),
    'limit_mb', coalesce(
      (select u.recording_storage_limit_mb from public.users u where u.id = auth.uid()), 5120),
    'record_debates', coalesce(
      (select s.record_debates from public.user_settings s where s.user_id = auth.uid()), true)
  );
$$;
revoke all on function public.get_recording_usage() from public, anon;
grant execute on function public.get_recording_usage() to authenticated;
