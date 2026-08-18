-- HLS egress for audience at scale: the playlist URL lands on the room row
-- while an HLS broadcast is running (see /api/egress start_hls).
-- Applied to the live DB on 2026-08-17.

alter table public.debate_rooms add column if not exists hls_url text;
