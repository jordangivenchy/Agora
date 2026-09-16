-- The questions drafted from a news story (app/api/news/motions/route.ts).
--
-- A headline reports something; a motion is a claim someone can refuse.
-- Queuing wrote the headline straight into debate_topics.question, which
-- left people waiting to be matched on sentences that have no other side.
-- The four questions drafted from a story live here.
--
-- Keyed by the story rather than the article, and cached, because the
-- queue matches on the exact text of the question: two people reading the
-- same story must be offered the same sentence, or they wait in two
-- queues of one. Written by the server alone, through the service role;
-- row security is on with no policies, so no client reads or writes it.
create table if not exists public.news_motions (
  story_key text primary key,
  headline text not null,
  topic_key text not null,
  source_url text,
  -- [{ "shape": "policy" | "judgment" | "prediction" | "priority", "text": "…" }]
  -- An empty array is an answer too: some stories carry no argument.
  motions jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.news_motions enable row level security;

-- Yesterday's news is drafted for nobody; headline topics themselves
-- retire after a day (retire_stale_headline_topics).
create index if not exists news_motions_created_idx on public.news_motions (created_at);
