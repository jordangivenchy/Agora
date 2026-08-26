-- ─── A duel ends the moment either debater leaves ────────────────────
-- Queue-matched 1v1s (pro_size/con_size 1/1) are a conversation between
-- exactly two people: when one walks out there is nothing left to hold
-- open, no matter which seat they held. A trigger on the participant
-- row covers every leave path at once — the Leave button, the pagehide
-- beacon (/api/rooms/leave), the LiveKit webhook, and the ghost-seat
-- sweep — with no cron delay. (20260862's grace-exemption stays: it
-- governs the reaper; this ends the room affirmatively.)

create or replace function public.end_duel_on_leave()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.left_at is not null and old.left_at is null
     and new.role = 'debater' then
    update public.debate_rooms r
    set status       = 'ended',
        ended_at     = now(),
        host_left_at = null,
        close_reason = coalesce(r.close_reason, 'inactive')
    where r.id = new.room_id
      and r.status = 'live'
      and coalesce(r.pro_size, 10) = 1
      and coalesce(r.con_size, 10) = 1;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_end_duel_on_leave on public.debate_participants;
create trigger trg_end_duel_on_leave
after update of left_at on public.debate_participants
for each row execute function public.end_duel_on_leave();
