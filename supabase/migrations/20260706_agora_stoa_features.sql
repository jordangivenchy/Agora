-- Agora Stoa feature tables: communities, clips, news topics, room metadata.
-- Run this in the Supabase SQL editor (Dashboard → SQL → New query → paste → Run).
-- Everything is additive; no existing tables are modified except a new
-- side-table keyed to debate_rooms.

-- ── Communities ────────────────────────────────────────────────────────────
create table if not exists public.communities (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null default 'topic-circle', -- university | hs-team | mun | topic-circle | pre-law
  description text,
  color text default '#4a9eff',
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.community_members (
  community_id uuid not null references public.communities(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  role text not null default 'member', -- owner | moderator | member
  joined_at timestamptz not null default now(),
  primary key (community_id, user_id)
);

alter table public.communities enable row level security;
alter table public.community_members enable row level security;

create policy "communities are readable by everyone"
  on public.communities for select using (true);
create policy "authenticated users can create communities"
  on public.communities for insert with check (auth.uid() = created_by);
create policy "members are readable by everyone"
  on public.community_members for select using (true);
create policy "users join communities as themselves"
  on public.community_members for insert with check (auth.uid() = user_id);
create policy "users can leave communities"
  on public.community_members for delete using (auth.uid() = user_id);

-- ── Clips (short-form) ─────────────────────────────────────────────────────
create table if not exists public.clips (
  id uuid primary key default gen_random_uuid(),
  room_id uuid references public.debate_rooms(id) on delete set null,
  uploader_id uuid references public.users(id) on delete set null,
  title text not null,
  duration_seconds int,
  video_url text,          -- storage path once real recordings exist
  thumb_gradient text,     -- CSS gradient placeholder until thumbnails exist
  view_count int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.clip_likes (
  clip_id uuid not null references public.clips(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (clip_id, user_id)
);

create table if not exists public.clip_comments (
  id uuid primary key default gen_random_uuid(),
  clip_id uuid not null references public.clips(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

alter table public.clips enable row level security;
alter table public.clip_likes enable row level security;
alter table public.clip_comments enable row level security;

create policy "clips are readable by everyone"
  on public.clips for select using (true);
create policy "authenticated users can upload clips"
  on public.clips for insert with check (auth.uid() = uploader_id);
create policy "likes are readable by everyone"
  on public.clip_likes for select using (true);
create policy "users like as themselves"
  on public.clip_likes for insert with check (auth.uid() = user_id);
create policy "users can unlike"
  on public.clip_likes for delete using (auth.uid() = user_id);
create policy "comments are readable by everyone"
  on public.clip_comments for select using (true);
create policy "users comment as themselves"
  on public.clip_comments for insert with check (auth.uid() = user_id);

-- ── News topics / daily motion ─────────────────────────────────────────────
create table if not exists public.news_topics (
  id uuid primary key default gen_random_uuid(),
  headline text not null,
  source text,
  topic_key text not null default 'culture',
  suggested_motion text not null,
  is_daily_motion boolean not null default false,
  motion_date date default current_date,
  pro_votes int not null default 0,
  con_votes int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.news_topics enable row level security;
create policy "news topics are readable by everyone"
  on public.news_topics for select using (true);

-- ── Room metadata (format variant + scoring curriculum) ────────────────────
-- Side-table so the create_room RPC and debate_rooms schema stay untouched.
create table if not exists public.room_meta (
  room_id uuid primary key references public.debate_rooms(id) on delete cascade,
  format_variant text,   -- steelman | blitz | town-hall | fishbowl | devils-advocate | 1v20
  curriculum text,       -- agora-general | nsda-ld | nsda-pf | bp | oxford | mun | moot-court
  created_at timestamptz not null default now()
);

alter table public.room_meta enable row level security;
create policy "room meta is readable by everyone"
  on public.room_meta for select using (true);
create policy "room hosts write their room meta"
  on public.room_meta for insert with check (
    exists (
      select 1 from public.debate_rooms r
      where r.id = room_id and r.host_id = auth.uid()
    )
  );
