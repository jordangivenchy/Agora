-- Hostless rooms end faster: the host-gone grace drops 90s → 45s (still
-- comfortably longer than a host page-refresh/rejoin). The 2-minute
-- heartbeat backstop is unchanged — the presence poll is a jittered 45s,
-- so a tighter silence threshold would false-positive on one missed
-- poll. With the 1-minute room-lifecycle cron, a clean host leave now
-- ends the room in ~45–105s (was ~90–150s).

create or replace function public.end_hostless_rooms()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n integer := 0;
  m integer := 0;
begin
  -- Backstop: live room, no host-left stamp, host's presence heartbeat
  -- silent for 2+ minutes (or no presence row at all), room old enough
  -- that a slow first connect can't false-positive. Duels are excluded:
  -- their participant-leave trigger and ghost sweep already end them.
  update public.debate_rooms r
  set host_left_at = now()
  where r.status = 'live'
    and r.host_left_at is null
    and coalesce(r.started_at, r.created_at) < now() - interval '3 minutes'
    and not (coalesce(r.pro_size, 10) = 1 and coalesce(r.con_size, 10) = 1)
    and not exists (
      select 1 from public.user_presence up
      where up.user_id = r.host_id
        and up.last_seen_at > now() - interval '2 minutes');

  -- Host gone past the 45-second grace → the stage dies with its host.
  -- (Except duels: no host, no stage to die with.)
  update public.debate_rooms r
  set status       = 'ended',
      ended_at     = now(),
      host_left_at = null,
      close_reason = coalesce(r.close_reason, 'inactive')
  where r.status = 'live'
    and r.host_left_at is not null
    and r.host_left_at < now() - interval '45 seconds'
    and not (coalesce(r.pro_size, 10) = 1 and coalesce(r.con_size, 10) = 1);
  get diagnostics n = row_count;

  update public.debate_rooms r
  set status       = 'ended',
      ended_at     = now(),
      host_left_at = null,
      close_reason = coalesce(r.close_reason, 'inactive')
  where r.status = 'live'
    and not exists (
      select 1 from public.debate_participants dp
      where dp.room_id = r.id and dp.left_at is null)
    and (
      select max(dp.left_at) from public.debate_participants dp
      where dp.room_id = r.id
    ) < now() - interval '2 minutes';
  get diagnostics m = row_count;

  return n + m;
end;
$function$;
