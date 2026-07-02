-- Migration 002: Room chat messages + vote updates for side picker

-- Room chat messages (Twitch-style)
create table public.room_messages (
  id uuid primary key default uuid_generate_v4(),
  room_id uuid references public.debate_rooms(id) on delete cascade not null,
  user_id uuid references public.users(id) not null,
  content text not null,
  created_at timestamptz default now()
);

create index idx_room_messages_room on public.room_messages(room_id, created_at);

alter table public.room_messages enable row level security;

create policy "Room messages are viewable by everyone"
  on public.room_messages for select using (true);

create policy "Authenticated users can send messages"
  on public.room_messages for insert with check (auth.uid() = user_id);

alter publication supabase_realtime add table public.room_messages;

-- Allow users to update their own votes (for side switching)
create policy "Users can update their own vote"
  on public.debate_votes for update using (auth.uid() = voter_id);

-- Allow users to delete their own votes (to re-vote)
create policy "Users can delete their own vote"
  on public.debate_votes for delete using (auth.uid() = voter_id);

-- Allow anyone to update room viewer_count (not just host)
create policy "Anyone can update viewer count"
  on public.debate_rooms for update using (true);
