-- ─── Duels outlive their "host" ──────────────────────────────────────
-- A queue-matched 1v1 (pro_size/con_size 1/1) has no real host — the
-- host seat is just whoever waited longer, and the client hides host
-- controls for it. The 90-second hostless grace therefore must not
-- reap a duel when the nominal host walks out: the opponent may still
-- be mid-conversation (or waiting for a rematch partner). Duels end
-- via the everyone-abandoned branch instead — no seated participants
-- for 2 minutes. Identical to 20260855's function except the duel
-- guard on the host-grace branch.

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
  -- (Except duels: no host, no stage to die with.)
  update public.debate_rooms r
  set status       = 'ended',
      ended_at     = now(),
      host_left_at = null,
      close_reason = coalesce(r.close_reason, 'inactive')
  where r.status = 'live'
    and r.host_left_at is not null
    and r.host_left_at < now() - interval '90 seconds'
    and not (coalesce(r.pro_size, 10) = 1 and coalesce(r.con_size, 10) = 1);
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
revoke execute on function public.end_hostless_rooms() from public, anon, authenticated;
