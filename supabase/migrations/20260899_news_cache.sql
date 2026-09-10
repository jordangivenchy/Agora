-- The news feed's shared copy: one row every server instance reads, so a
-- refresh runs once per interval across all of them (app/api/news/route.ts).
-- Written by the server alone, through the service role; row security is
-- on with no policies, so no client can read or write it.
create table if not exists public.news_cache (
  key text primary key,
  body jsonb not null,
  fetched_at timestamptz not null default now(),
  refreshing_at timestamptz
);
alter table public.news_cache enable row level security;
