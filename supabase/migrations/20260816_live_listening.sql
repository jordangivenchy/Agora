-- ============================================================
-- 20260816_live_listening.sql
--
-- Agora live listening: per-speaker debate transcripts, argumentation
-- persona profiles, and Agora's own interjections (fact-check corrections
-- it "jumps in" with). Run in the Supabase SQL editor. Idempotent.
--
-- Privacy model:
--   * Utterances are captured ONLY from stage speakers (people addressing
--     the room), by their own browser, with a visible listening indicator.
--   * Personas are derived data; each user can read their own profile.
--     Writes happen exclusively through the service role.
--   * Interjections are room-public by design — both sides see them.
-- ============================================================

-- ─── 1. debate_utterances — the transcript stream ───────────
create table if not exists public.debate_utterances (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.debate_rooms(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  content text not null check (char_length(content) between 1 and 2000),
  -- Set true once the persona analyzer has consumed this row.
  analyzed boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_utterances_room_time
  on public.debate_utterances(room_id, created_at);
create index if not exists idx_utterances_unanalyzed
  on public.debate_utterances(user_id, created_at) where not analyzed;

alter table public.debate_utterances enable row level security;

-- Speakers write their own transcript; it is their public stage speech.
drop policy if exists "speakers insert their own utterances" on public.debate_utterances;
create policy "speakers insert their own utterances"
  on public.debate_utterances for insert with check (auth.uid() = user_id);

-- Readable like room chat: debates are public performances.
drop policy if exists "utterances are viewable by everyone" on public.debate_utterances;
create policy "utterances are viewable by everyone"
  on public.debate_utterances for select using (true);

-- Speakers can retract their own words.
drop policy if exists "speakers delete their own utterances" on public.debate_utterances;
create policy "speakers delete their own utterances"
  on public.debate_utterances for delete using (auth.uid() = user_id);

-- ─── 2. debate_personas — argumentation profiles ────────────
-- One row per user; `profile` is the living analysis document merged
-- batch-by-batch (see src/lib/personas/merge.ts for the shape).
create table if not exists public.debate_personas (
  user_id uuid primary key references public.users(id) on delete cascade,
  profile jsonb not null default '{}'::jsonb,
  utterances_analyzed integer not null default 0,
  rooms_seen integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.debate_personas enable row level security;

-- Transparency: users can always see what Agora thinks of their style.
drop policy if exists "users read their own persona" on public.debate_personas;
create policy "users read their own persona"
  on public.debate_personas for select using (auth.uid() = user_id);
-- No insert/update policies: only the service role writes personas.

-- ─── 3. agora_interjections — Agora speaking up ─────────────
create table if not exists public.agora_interjections (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.debate_rooms(id) on delete cascade,
  -- Whose statement triggered it (nullable: general insights have no target).
  speaker_id uuid references public.users(id) on delete set null,
  kind text not null default 'correction' check (kind in ('correction', 'context', 'insight')),
  claim text not null,
  verdict text not null check (verdict in ('false', 'misleading', 'unverifiable', 'context')),
  explanation text not null,
  sources jsonb not null default '[]'::jsonb,
  confidence real not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_interjections_room
  on public.agora_interjections(room_id, created_at);

alter table public.agora_interjections enable row level security;

drop policy if exists "interjections are viewable by everyone" on public.agora_interjections;
create policy "interjections are viewable by everyone"
  on public.agora_interjections for select using (true);
-- Writes are service-role only: Agora speaks through the server.

-- Realtime: the room UI reacts the moment Agora interjects.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'agora_interjections'
  ) then
    alter publication supabase_realtime add table public.agora_interjections;
  end if;
end $$;

-- ─── 4. Interjection pacing ─────────────────────────────────
-- One correction per room per cooldown window, enforced at the DB so
-- parallel transcript batches can't double-fire. Returns true if the
-- caller may interject now.
create or replace function public.claim_interjection_slot(p_room_id uuid, p_cooldown_seconds integer default 90)
returns boolean
language plpgsql security definer as $$
declare
  last_at timestamptz;
begin
  -- Serialize per room: concurrent checkers block here, not double-post.
  perform pg_advisory_xact_lock(hashtext(p_room_id::text));
  select max(created_at) into last_at
    from public.agora_interjections where room_id = p_room_id;
  return last_at is null or last_at < now() - make_interval(secs => p_cooldown_seconds);
end;
$$;
