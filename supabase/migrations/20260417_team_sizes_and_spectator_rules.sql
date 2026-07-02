-- Adds team-size configuration and spectator-visibility rules for private rooms.
--
-- Run this in the Supabase SQL editor (or `supabase db push`) before deploying
-- the new CreateRoomModal / ExploreView code.

alter table public.debate_rooms
  add column if not exists pro_size int not null default 1,
  add column if not exists con_size int not null default 1,
  add column if not exists allow_spectators boolean not null default true;

-- Sanity bounds: each side 1..19, total party size ≤ 20.
alter table public.debate_rooms
  drop constraint if exists debate_rooms_team_sizes_chk;
alter table public.debate_rooms
  add constraint debate_rooms_team_sizes_chk
  check (pro_size >= 1 and pro_size <= 19 and con_size >= 1 and con_size <= 19 and pro_size + con_size <= 20);

-- Backfill: existing rooms stay as 1v1 with spectators allowed (defaults do this).
update public.debate_rooms set pro_size = 1 where pro_size is null;
update public.debate_rooms set con_size = 1 where con_size is null;
update public.debate_rooms set allow_spectators = true where allow_spectators is null;

-- Index to speed up public listings (skip invisible private rooms).
create index if not exists idx_debate_rooms_public_listing
  on public.debate_rooms (status, created_at desc)
  where is_private = false or allow_spectators = true;
