-- Hosts on phones: the page freezes the moment the screen locks (no
-- presence heartbeat, no seat heartbeat, and iOS cuts the call's sockets
-- so the LiveKit webhook stamps host_left_at within seconds). With a
-- 45-second grace and a 2-minute presence backstop, a host who glanced
-- at another app for a minute came back to an ended room. The room page
-- now re-seats, clears the grace and reconnects the instant it is back on
-- screen; this widens the windows so a normal phone absence fits inside
-- them: grace 45s → 2 minutes, presence backstop 2 → 4 minutes. Duels are
-- still excluded (their own lifecycle ends them); the empty-room sweep is
-- unchanged.
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
  update public.debate_rooms r
  set host_left_at = now()
  where r.status = 'live'
    and r.host_left_at is null
    and coalesce(r.started_at, r.created_at) < now() - interval '3 minutes'
    and not (coalesce(r.pro_size, 10) = 1 and coalesce(r.con_size, 10) = 1)
    and not exists (
      select 1 from public.user_presence up
      where up.user_id = r.host_id
        and up.last_seen_at > now() - interval '4 minutes');

  update public.debate_rooms r
  set status       = 'ended',
      ended_at     = now(),
      host_left_at = null,
      close_reason = coalesce(r.close_reason, 'inactive')
  where r.status = 'live'
    and r.host_left_at is not null
    and r.host_left_at < now() - interval '2 minutes'
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
