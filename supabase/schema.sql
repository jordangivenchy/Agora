-- AgoraSphere MVP Database Schema
-- Run this in Supabase SQL Editor

-- Enable UUID generation
create extension if not exists "uuid-ossp";

-- ─── USERS (extends Supabase auth.users) ───
create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  email text unique not null,
  avatar_url text,
  bio text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ─── DEBATE ROOMS ───
create table public.debate_rooms (
  id uuid primary key default uuid_generate_v4(),
  motion text not null,
  host_id uuid references public.users(id) not null,
  topic_key text not null,
  secondary_topics text[] default '{}',
  format text not null default 'open',
  language text not null default 'en',
  status text not null default 'created',
  is_private boolean default false,
  invite_code text unique,
  fact_check_intensity text default 'standard',
  time_limit_seconds integer,
  allow_audience_questions boolean default true,
  recording_consent boolean default true,
  max_audience_size integer,
  scheduled_start timestamptz,
  started_at timestamptz,
  ended_at timestamptz,
  viewer_count integer default 0,
  created_at timestamptz default now()
);

-- ─── DEBATE PARTICIPANTS ───
create table public.debate_participants (
  id uuid primary key default uuid_generate_v4(),
  room_id uuid references public.debate_rooms(id) on delete cascade not null,
  user_id uuid references public.users(id) not null,
  role text not null default 'spectator',
  stance text,
  joined_at timestamptz default now(),
  left_at timestamptz,
  unique(room_id, user_id)
);

-- ─── DEBATE VOTES ───
create table public.debate_votes (
  id uuid primary key default uuid_generate_v4(),
  room_id uuid references public.debate_rooms(id) on delete cascade not null,
  voter_id uuid references public.users(id) not null,
  stance text not null,
  created_at timestamptz default now(),
  unique(room_id, voter_id)
);

-- ─── DEBATE QUEUE ───
create table public.debate_queue (
  id uuid primary key default uuid_generate_v4(),
  room_id uuid references public.debate_rooms(id) on delete cascade not null,
  user_id uuid references public.users(id) not null,
  stance text not null,
  status text not null default 'waiting',
  entered_at timestamptz default now()
);

-- ─── INDEXES ───
create index idx_debate_rooms_status on public.debate_rooms(status);
create index idx_debate_rooms_topic_status on public.debate_rooms(topic_key, status);
create index idx_debate_rooms_host on public.debate_rooms(host_id);
create index idx_participants_room on public.debate_participants(room_id);
create index idx_participants_user on public.debate_participants(user_id);
create index idx_votes_room on public.debate_votes(room_id);
create index idx_queue_room_status on public.debate_queue(room_id, status);
create index idx_queue_user on public.debate_queue(user_id, status);

-- ─── ROW LEVEL SECURITY ───
alter table public.users enable row level security;
alter table public.debate_rooms enable row level security;
alter table public.debate_participants enable row level security;
alter table public.debate_votes enable row level security;
alter table public.debate_queue enable row level security;

-- Users: anyone can read profiles, users can update their own
create policy "Public profiles are viewable by everyone"
  on public.users for select using (true);

create policy "Users can update their own profile"
  on public.users for update using (auth.uid() = id);

create policy "Users can insert their own profile"
  on public.users for insert with check (auth.uid() = id);

-- Debate rooms: anyone can read, authenticated users can create
create policy "Rooms are viewable by everyone"
  on public.debate_rooms for select using (true);

create policy "Authenticated users can create rooms"
  on public.debate_rooms for insert with check (auth.uid() = host_id);

create policy "Hosts can update their rooms"
  on public.debate_rooms for update using (auth.uid() = host_id);

-- Participants: anyone can read, authenticated users can join/leave
create policy "Participants are viewable by everyone"
  on public.debate_participants for select using (true);

create policy "Authenticated users can join rooms"
  on public.debate_participants for insert with check (auth.uid() = user_id);

create policy "Users can update their own participation"
  on public.debate_participants for update using (auth.uid() = user_id);

create policy "Users can leave rooms"
  on public.debate_participants for delete using (auth.uid() = user_id);

-- Votes: anyone can read counts, authenticated users can vote
create policy "Votes are viewable by everyone"
  on public.debate_votes for select using (true);

create policy "Authenticated users can vote"
  on public.debate_votes for insert with check (auth.uid() = voter_id);

-- Queue: users can see queue, authenticated users can join
create policy "Queue is viewable by everyone"
  on public.debate_queue for select using (true);

create policy "Authenticated users can join queue"
  on public.debate_queue for insert with check (auth.uid() = user_id);

create policy "Users can update their own queue entry"
  on public.debate_queue for update using (auth.uid() = user_id);

create policy "Users can leave queue"
  on public.debate_queue for delete using (auth.uid() = user_id);

-- ─── REALTIME ───
-- Enable realtime for tables that need live updates
alter publication supabase_realtime add table public.debate_rooms;
alter publication supabase_realtime add table public.debate_participants;
alter publication supabase_realtime add table public.debate_votes;
alter publication supabase_realtime add table public.debate_queue;

-- ─── FUNCTION: Auto-create user profile on signup ───
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.users (id, username, email, avatar_url)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data->>'preferred_username',
      new.raw_user_meta_data->>'name',
      split_part(new.email, '@', 1)
    ),
    new.email,
    coalesce(new.raw_user_meta_data->>'avatar_url', new.raw_user_meta_data->>'picture')
  );
  return new;
end;
$$ language plpgsql security definer;

-- Trigger: run after new auth user is created
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
