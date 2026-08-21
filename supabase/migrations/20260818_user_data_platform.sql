-- ============================================================
-- 20260818_user_data_platform.sql
--
-- The shared foundation for Agora's user data platform: the tables,
-- security model, and access/erasure controls that every workstream
-- (capture, profile synthesis, personalization, coaching) reads and
-- writes. Authored as ONE coherent contract so the workstreams interlock.
--
-- Design principles — non-negotiable across every table below:
--   1. CONSENT-GATED. Nothing is collected until the user opts in
--      (user_data_consent, default all-false). Capture code checks it.
--   2. FOR the user, not just ABOUT them. Every derived row is readable
--      by its owner (RLS select = auth.uid()). No hidden dossiers.
--   3. EXPRESSED, not inferred-in-secret. debate_positions records what a
--      user actually argued, with pointers back to their own utterances.
--   4. SERVICE-ROLE WRITES. Derived/analytic tables have NO user insert or
--      update policy — only the server (service role) writes them, so a
--      client can never forge its own profile or read someone else's.
--   5. ERASABLE. erase_user_data() gives the owner a real delete path;
--      export_user_data() gives them a real "download everything" path.
--
-- Run in the Supabase SQL editor. Idempotent.
-- ============================================================

-- ─── 1. Consent: the gate in front of everything ────────────
-- One row per user. All flags default FALSE — collection is strictly
-- opt-in, per category, and every change is timestamped for auditability.
create table if not exists public.user_data_consent (
  user_id uuid primary key references public.users(id) on delete cascade,
  -- Behavioral analytics: views, clicks, likes, watch time, dwell.
  analytics boolean not null default false,
  -- In-debate capture: transcript → argument style + expressed positions.
  debate_analysis boolean not null default false,
  -- Personalized recommendations derived from the profile.
  personalization boolean not null default false,
  -- Personalized coaching / persona notes.
  coaching boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.user_data_consent enable row level security;

drop policy if exists "users read own consent" on public.user_data_consent;
create policy "users read own consent"
  on public.user_data_consent for select using (auth.uid() = user_id);
drop policy if exists "users set own consent" on public.user_data_consent;
create policy "users set own consent"
  on public.user_data_consent for insert with check (auth.uid() = user_id);
drop policy if exists "users update own consent" on public.user_data_consent;
create policy "users update own consent"
  on public.user_data_consent for update using (auth.uid() = user_id);

-- Server-side gate the capture routes call before writing anything.
create or replace function public.has_data_consent(p_user_id uuid, p_category text)
returns boolean
language sql stable security definer as $$
  select coalesce(
    case p_category
      when 'analytics'       then c.analytics
      when 'debate_analysis' then c.debate_analysis
      when 'personalization' then c.personalization
      when 'coaching'        then c.coaching
      else false
    end, false)
  from public.user_data_consent c
  where c.user_id = p_user_id;
$$;

-- ─── 2. user_signals: behavioral event log (Workstream 1) ───
-- Append-only. One row per meaningful interaction. `kind` is an open
-- vocabulary the capture lib owns; `subject_*` point at what was acted on;
-- `value`/`meta` carry weight (watch seconds, scroll depth) and detail.
create table if not exists public.user_signals (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  kind text not null,                       -- view | click | like | watch | dwell | follow | search | ...
  subject_type text,                        -- room | clip | user | topic | news | ...
  subject_id text,                          -- uuid or slug of the subject
  topic_key text,                           -- denormalized for cheap topic rollups
  value real,                               -- watch seconds, dwell ms, scroll %, etc.
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_signals_user_time on public.user_signals(user_id, created_at desc);
create index if not exists idx_signals_user_topic on public.user_signals(user_id, topic_key);
create index if not exists idx_signals_unrolled on public.user_signals(user_id, created_at) where topic_key is not null;

alter table public.user_signals enable row level security;
-- Users can see their own raw event log (transparency); only the server writes.
drop policy if exists "users read own signals" on public.user_signals;
create policy "users read own signals"
  on public.user_signals for select using (auth.uid() = user_id);

-- ─── 3. debate_positions: expressed stances (Workstream 2) ──
-- What a user ACTUALLY argued on a topic, distilled from their own
-- utterances, with evidence pointers back to them. User-visible by design:
-- "here is where you've argued, and what you said." Never a hidden inference.
create table if not exists public.debate_positions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  topic_key text not null,
  motion text,                              -- the specific motion, when applicable
  stance text,                              -- PRO | CON | mixed | nuanced — as argued
  summary text not null,                    -- model's neutral paraphrase of their expressed view
  -- Utterance rows this was distilled from, so any position is traceable to
  -- the user's own words (and disappears if they delete those utterances).
  evidence_utterance_ids uuid[] not null default '{}',
  confidence real not null default 0,       -- how clearly the stance was expressed
  room_id uuid references public.debate_rooms(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (user_id, topic_key, motion)
);

create index if not exists idx_positions_user on public.debate_positions(user_id, updated_at desc);
create index if not exists idx_positions_topic on public.debate_positions(user_id, topic_key);

alter table public.debate_positions enable row level security;
drop policy if exists "users read own positions" on public.debate_positions;
create policy "users read own positions"
  on public.debate_positions for select using (auth.uid() = user_id);
-- Server-only writes.

-- ─── 4. user_data_profiles: the synthesized profile (WS 3) ──
-- One accessible document per user, folding together the behavioral
-- summary, argument style (from debate_personas), expressed-position
-- summary, and learning/thinking style (Workstream 4). This is the "clean
-- and efficient data profile" — and it is readable by its owner.
create table if not exists public.user_data_profiles (
  user_id uuid primary key references public.users(id) on delete cascade,
  -- Behavioral rollup: top topics, engagement rhythm, content preferences.
  behavior jsonb not null default '{}'::jsonb,
  -- Argument style, copied/derived from debate_personas for one-stop reads.
  argument_style jsonb not null default '{}'::jsonb,
  -- Learning & reasoning style (Workstream 4): how this person best takes in
  -- and works through information — for coaching, shown to them.
  learning_style jsonb not null default '{}'::jsonb,
  -- Compact index of expressed positions (topic → stance + summary ref).
  positions_summary jsonb not null default '{}'::jsonb,
  -- Model-written, user-facing headline notes about their growth.
  highlights text[] not null default '{}',
  signals_count integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.user_data_profiles enable row level security;
drop policy if exists "users read own profile" on public.user_data_profiles;
create policy "users read own profile"
  on public.user_data_profiles for select using (auth.uid() = user_id);
-- Server-only writes.

-- ─── 5. user_recommendations: personalized algorithm (WS 5) ─
create table if not exists public.user_recommendations (
  user_id uuid primary key references public.users(id) on delete cascade,
  -- Ranked lists the feed/discovery surfaces read: rooms, topics, people.
  ranked jsonb not null default '{}'::jsonb,
  -- Why (transparency): short reasons per recommendation.
  rationale jsonb not null default '{}'::jsonb,
  computed_at timestamptz not null default now()
);

alter table public.user_recommendations enable row level security;
drop policy if exists "users read own recommendations" on public.user_recommendations;
create policy "users read own recommendations"
  on public.user_recommendations for select using (auth.uid() = user_id);

-- ─── 6. user_coach_notes: personalized feedback (WS 6) ──────
-- The persona-notes-and-coach output: specific, constructive, user-facing.
create table if not exists public.user_coach_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  scope text not null default 'general' check (scope in ('general', 'debate', 'topic', 'skill')),
  scope_ref text,                           -- room id / topic key / skill name
  note text not null,
  -- Concrete, actionable next step tied to the note.
  suggestion text,
  created_at timestamptz not null default now()
);

create index if not exists idx_coach_notes_user on public.user_coach_notes(user_id, created_at desc);

alter table public.user_coach_notes enable row level security;
drop policy if exists "users read own coach notes" on public.user_coach_notes;
create policy "users read own coach notes"
  on public.user_coach_notes for select using (auth.uid() = user_id);

-- ─── 7. Access & erasure: the user's rights, as SQL ─────────
-- "What Agora knows about me": one call returns the caller's full footprint.
-- security definer so it can read service-role tables, but it hard-scopes to
-- auth.uid() — a user can only ever export THEIR OWN data.
create or replace function public.export_user_data()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  return jsonb_build_object(
    'consent',         (select to_jsonb(c) from public.user_data_consent c where c.user_id = uid),
    'profile',         (select to_jsonb(p) from public.user_data_profiles p where p.user_id = uid),
    'positions',       (select coalesce(jsonb_agg(to_jsonb(d)), '[]'::jsonb) from public.debate_positions d where d.user_id = uid),
    'recommendations', (select to_jsonb(r) from public.user_recommendations r where r.user_id = uid),
    'coach_notes',     (select coalesce(jsonb_agg(to_jsonb(n)), '[]'::jsonb) from public.user_coach_notes n where n.user_id = uid),
    'argument_style',  (select to_jsonb(pe) from public.debate_personas pe where pe.user_id = uid),
    'signals_count',   (select count(*) from public.user_signals s where s.user_id = uid)
  );
end;
$$;

-- "Delete everything Agora derived about me." Scoped to the caller. Leaves
-- their account and their utterances (their own words) intact unless they
-- also delete those; wipes all derived/analytic data and revokes consent.
create or replace function public.erase_user_data()
returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  delete from public.user_signals          where user_id = uid;
  delete from public.debate_positions      where user_id = uid;
  delete from public.user_data_profiles    where user_id = uid;
  delete from public.user_recommendations  where user_id = uid;
  delete from public.user_coach_notes      where user_id = uid;
  delete from public.debate_personas       where user_id = uid;
  update public.user_data_consent
     set analytics = false, debate_analysis = false,
         personalization = false, coaching = false, updated_at = now()
   where user_id = uid;
end;
$$;
