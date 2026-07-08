-- ============================================================
-- 20260703_room_chat.sql
--
-- Restores in-room chat. Supersedes the stray migration_002_room_chat.sql
-- that lived outside supabase/migrations/ and was skipped when the
-- database was rebuilt. Fully idempotent — safe to run repeatedly.
--
-- Creates:
--   1. room_messages table (Twitch-style room chat) + index + RLS
--   2. realtime publication entry (guarded — ALTER PUBLICATION has
--      no IF NOT EXISTS)
--   3. debate_votes UPDATE/DELETE policies — required by the side
--      picker's vote-switching (these lived in the same lost file)
--
-- Deliberately NOT recreated from the old file:
--   "Anyone can update viewer count" ON debate_rooms FOR UPDATE
--   USING (true) — RLS policies are not column-scoped, so this
--   would let ANY user update ANY room row (end debates, edit
--   motions). Nothing in the app writes viewer_count, so the
--   policy is pure attack surface.
-- ============================================================

-- ─── 1. room_messages ───────────────────────────────────────
create table if not exists public.room_messages (
  id uuid primary key default uuid_generate_v4(),
  room_id uuid references public.debate_rooms(id) on delete cascade not null,
  user_id uuid references public.users(id) not null,
  content text not null check (char_length(content) between 1 and 500),
  created_at timestamptz default now()
);

create index if not exists idx_room_messages_room
  on public.room_messages(room_id, created_at);

alter table public.room_messages enable row level security;

drop policy if exists "Room messages are viewable by everyone" on public.room_messages;
create policy "Room messages are viewable by everyone"
  on public.room_messages for select using (true);

drop policy if exists "Authenticated users can send messages" on public.room_messages;
create policy "Authenticated users can send messages"
  on public.room_messages for insert with check (auth.uid() = user_id);

-- ─── 2. Realtime (chat INSERT events over WebSocket) ────────
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'room_messages'
  ) then
    alter publication supabase_realtime add table public.room_messages;
  end if;
end $$;

-- ─── 3. Vote switching policies (side picker) ───────────────
drop policy if exists "Users can update their own vote" on public.debate_votes;
create policy "Users can update their own vote"
  on public.debate_votes for update using (auth.uid() = voter_id);

drop policy if exists "Users can delete their own vote" on public.debate_votes;
create policy "Users can delete their own vote"
  on public.debate_votes for delete using (auth.uid() = voter_id);
