-- ============================================================
-- 20260702_raise_hand.sql
--
-- Audience raise-hand queue. A single timestamp column is the
-- whole source of truth:
--   hand_raised_at = null  → hand lowered
--   hand_raised_at = ts    → hand raised at ts (queue orders asc,
--                            so the longest-waiting hand is first;
--                            re-raising gets a fresh timestamp and
--                            moves you to the back).
--
-- No new RLS needed: the existing "Users can update their own
-- participation" policy covers toggling your own hand, and the
-- room page already has a realtime subscription on
-- debate_participants, so every client sees queue changes live.
-- ============================================================

alter table public.debate_participants
  add column if not exists hand_raised_at timestamptz;

-- Fast ordered lookups of the raised-hand queue per room.
create index if not exists idx_participants_hand_queue
  on public.debate_participants (room_id, hand_raised_at)
  where hand_raised_at is not null and left_at is null;
