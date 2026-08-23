-- ============================================================
-- 20260855_room_lifecycle.sql
--
-- Room lifecycle on disconnect: closing the tab should vacate the
-- seat, and a host who vanishes should end the room — but with a
-- ~90-second grace so a page refresh doesn't kill the stage.
--
--   debate_rooms.host_left_at   stamped by the LiveKit webhook /
--                               pagehide beacon when a live host drops;
--                               cleared when the host comes back.
--   end_hostless_rooms()        minute cron: ends live rooms whose host
--                               has been gone > 90s, and live rooms
--                               where EVERYONE has been gone > 2 min.
--   clear_host_left(room)       host-only belt-and-braces: the room
--                               page calls it on mount when the host
--                               reloads and sees their own grace timer.
--
-- Cron: 'room-lifecycle' every minute.
-- Idempotent; run in the Supabase SQL editor.
-- ============================================================

-- ─── 1. Column ───────────────────────────────────────────────
alter table public.debate_rooms
  add column if not exists host_left_at timestamptz;

-- ─── 2. The sweep ────────────────────────────────────────────
create or replace function public.end_hostless_rooms()
returns integer
language plpgsql security definer
set search_path to 'public'
as $$
declare
  n integer := 0;
  m integer := 0;
begin
  -- Host gone past the 90-second grace → the stage dies with its host.
  update public.debate_rooms r
  set status       = 'ended',
      ended_at     = now(),
      host_left_at = null,
      close_reason = coalesce(r.close_reason, 'inactive')
  where r.status = 'live'
    and r.host_left_at is not null
    and r.host_left_at < now() - interval '90 seconds';
  get diagnostics n = row_count;

  -- Live rooms everyone abandoned: no seated participant, and the last
  -- person walked out more than 2 minutes ago. (A room that never had a
  -- participant row is left alone — max(left_at) is null.)
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
$$;
-- Server-side only (cron / API routes with the service role).
revoke execute on function public.end_hostless_rooms() from public, anon, authenticated;

-- ─── 3. Host rejoin clears the grace timer (belt-and-braces) ─
-- The LiveKit participant_joined webhook normally clears host_left_at;
-- this RPC lets the room page clear it client-side on mount in case the
-- webhook was missed or raced.
create or replace function public.clear_host_left(p_room uuid)
returns void
language plpgsql security definer
set search_path to 'public'
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  update public.debate_rooms
  set host_left_at = null
  where id = p_room
    and host_id = auth.uid()
    and host_left_at is not null;
end;
$$;
revoke all on function public.clear_host_left(uuid) from public, anon;
grant execute on function public.clear_host_left(uuid) to authenticated;

-- ─── 4. Minute cron ──────────────────────────────────────────
do $$
begin
  perform cron.unschedule('room-lifecycle');
exception when others then null;
end $$;
select cron.schedule('room-lifecycle', '* * * * *', 'select public.end_hostless_rooms()');
