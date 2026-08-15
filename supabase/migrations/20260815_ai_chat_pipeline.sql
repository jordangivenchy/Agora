-- Agora AI chat pipeline: scraped data corpus, chat persistence, PostHog trait
-- cache, and a response cache.
-- Run this in the Supabase SQL editor (Dashboard → SQL → New query → paste → Run).
-- Everything is additive; no existing tables are modified.
--
-- Write access to scraped_data is intentionally service-role only (the Apify
-- webhook). No insert/update policy exists, so the anon key cannot write to it
-- even though everyone can read it.

-- ── Scraped corpus ─────────────────────────────────────────────────────────
-- One table, three shapes, discriminated by `kind`:
--   news    → headlines, articles, statistics keyed to a debate topic
--   web     → general topic-tagged page content from any actor
--   profile → debaters, tournaments, speaker records
-- Shared columns are the ones retrieval actually searches on; anything
-- kind-specific lives in `payload` so a new actor never needs a migration.
create table if not exists public.scraped_data (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'web' check (kind in ('news', 'web', 'profile')),

  -- Dedupe key. `source` is the Apify actor or publisher; `source_uid` is that
  -- source's own stable id for the item (article guid, URL, tournament slug).
  -- Re-running an actor upserts instead of duplicating.
  source text not null,
  source_uid text not null,

  url text,
  title text not null,
  body text,
  topic_key text,                       -- matches debate_rooms.topic_key
  tags text[] not null default '{}',
  payload jsonb not null default '{}'::jsonb,

  published_at timestamptz,
  scraped_at timestamptz not null default now(),

  -- Title weighted above body so a headline match outranks a passing mention.
  search_vector tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(body, '')), 'B')
  ) stored,

  unique (source, source_uid)
);

create index if not exists idx_scraped_search on public.scraped_data using gin(search_vector);
create index if not exists idx_scraped_tags on public.scraped_data using gin(tags);
create index if not exists idx_scraped_topic on public.scraped_data(topic_key, kind, published_at desc nulls last);
create index if not exists idx_scraped_scraped_at on public.scraped_data(scraped_at desc);

alter table public.scraped_data enable row level security;

create policy "scraped data is readable by everyone"
  on public.scraped_data for select using (true);

-- ── Chat sessions ──────────────────────────────────────────────────────────
-- One session per user per room (or a roomless session for the standalone
-- assistant). Signed-out guests are not persisted — the chat route still
-- answers them, it just skips history.
create table if not exists public.chat_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  room_id uuid references public.debate_rooms(id) on delete set null,
  motion text,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);

-- One live session per (user, room). The partial unique index handles roomless
-- sessions, where NULL room_id would otherwise never collide.
create unique index if not exists idx_chat_sessions_user_room
  on public.chat_sessions(user_id, room_id) where room_id is not null;
create unique index if not exists idx_chat_sessions_user_solo
  on public.chat_sessions(user_id) where room_id is null;
create index if not exists idx_chat_sessions_recent on public.chat_sessions(user_id, last_message_at desc);

alter table public.chat_sessions enable row level security;

create policy "users read their own chat sessions"
  on public.chat_sessions for select using (auth.uid() = user_id);
create policy "users create their own chat sessions"
  on public.chat_sessions for insert with check (auth.uid() = user_id);
create policy "users update their own chat sessions"
  on public.chat_sessions for update using (auth.uid() = user_id);
create policy "users delete their own chat sessions"
  on public.chat_sessions for delete using (auth.uid() = user_id);

-- ── Chat messages ──────────────────────────────────────────────────────────
-- user_id is denormalized from the session so the per-user rate-limit query is
-- a single index scan instead of a join on the hot path.
create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.chat_sessions(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,

  -- Observability: which provider actually served this, and what it cost.
  provider text,
  model text,
  latency_ms integer,
  input_tokens integer,
  output_tokens integer,
  -- scraped_data rows fed into the prompt, so an answer can be traced to sources.
  context_ids uuid[] not null default '{}',

  created_at timestamptz not null default now()
);

create index if not exists idx_chat_messages_session on public.chat_messages(session_id, created_at);
create index if not exists idx_chat_messages_ratelimit on public.chat_messages(user_id, created_at desc);

alter table public.chat_messages enable row level security;

create policy "users read their own chat messages"
  on public.chat_messages for select using (auth.uid() = user_id);
create policy "users create their own chat messages"
  on public.chat_messages for insert with check (auth.uid() = user_id);
create policy "users delete their own chat messages"
  on public.chat_messages for delete using (auth.uid() = user_id);

-- ── User preferences (PostHog trait cache) ─────────────────────────────────
-- The PostHog Query API is rate-limited far below our request volume, so it is
-- never called from the chat hot path. The cron job refreshes this table and
-- /api/agora reads only from here. A miss degrades to no personalization
-- rather than an error.
create table if not exists public.user_preferences (
  user_id uuid primary key references public.users(id) on delete cascade,
  traits jsonb not null default '{}'::jsonb,
  -- Preferences the user set explicitly always win over inferred PostHog traits.
  overrides jsonb not null default '{}'::jsonb,
  refreshed_at timestamptz not null default now(),
  -- Set when a PostHog refresh fails, so the cron can back off noisy accounts.
  last_error text
);

create index if not exists idx_user_preferences_stale on public.user_preferences(refreshed_at);

alter table public.user_preferences enable row level security;

create policy "users read their own preferences"
  on public.user_preferences for select using (auth.uid() = user_id);
create policy "users update their own preferences"
  on public.user_preferences for update using (auth.uid() = user_id);
create policy "users insert their own preferences"
  on public.user_preferences for insert with check (auth.uid() = user_id);

-- ── Response cache ─────────────────────────────────────────────────────────
-- Debate audiences ask the same question many times ("is that actually true?").
-- Keyed by a hash of the normalized question + motion + retrieved context, so
-- an entry is only reused when the model would have seen identical input.
-- Deliberately NOT keyed by user: the answers are neutral, public fact-checks
-- shown to the whole room, so there is nothing user-specific to leak.
create table if not exists public.ai_response_cache (
  cache_key text primary key,
  question text not null,
  answer text not null,
  provider text,
  model text,
  hit_count integer not null default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists idx_ai_cache_expiry on public.ai_response_cache(expires_at);

alter table public.ai_response_cache enable row level security;
-- No policies: the cache is read and written only by the service-role client on
-- the server. Clients never touch it directly.

-- Atomic read-and-count. Returns the cached answer and bumps hit_count in one
-- round trip; expired rows return nothing and are cleaned up by the cron.
create or replace function public.claim_cached_response(p_cache_key text)
returns table (answer text, provider text, model text)
language sql security definer as $$
  update public.ai_response_cache
  set hit_count = hit_count + 1
  where cache_key = p_cache_key and expires_at > now()
  returning ai_response_cache.answer, ai_response_cache.provider, ai_response_cache.model;
$$;

-- ── Retrieval ──────────────────────────────────────────────────────────────
-- Ranked full-text search over the corpus, optionally biased to a topic.
-- Kept as an RPC so the ranking rule lives next to the index that serves it.
create or replace function public.search_scraped_data(
  p_query text,
  p_topic_key text default null,
  p_limit integer default 6
)
returns table (
  id uuid,
  kind text,
  source text,
  url text,
  title text,
  body text,
  topic_key text,
  published_at timestamptz,
  rank real
)
language sql stable as $$
  select
    s.id, s.kind, s.source, s.url, s.title, s.body, s.topic_key, s.published_at,
    ts_rank(s.search_vector, websearch_to_tsquery('english', p_query))
      -- Nudge same-topic rows up, and decay anything older than a few months
      -- so a live debate cites current evidence.
      * (case when p_topic_key is not null and s.topic_key = p_topic_key then 1.5 else 1.0 end)
      * (1.0 / (1.0 + extract(epoch from (now() - coalesce(s.published_at, s.scraped_at))) / 7776000.0))
      as rank
  from public.scraped_data s
  where s.search_vector @@ websearch_to_tsquery('english', p_query)
  order by rank desc
  limit greatest(1, least(p_limit, 20));
$$;

-- ── Housekeeping ───────────────────────────────────────────────────────────
-- Called by /api/cron/refresh-traits. Keeps the cache and corpus bounded.
create or replace function public.prune_ai_pipeline()
returns void language sql security definer as $$
  delete from public.ai_response_cache where expires_at < now();
  delete from public.scraped_data where scraped_at < now() - interval '180 days';
$$;
