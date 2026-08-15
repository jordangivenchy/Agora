-- Retrieval fix: the v1 function used websearch_to_tsquery, which ANDs every
-- term — a chat question like "what does the report say about jobs?" only
-- matched rows containing ALL of those words, so evidence almost never
-- surfaced. v2 ORs the terms instead: any word may match, and ts_rank orders
-- rows by how many do (title matches weighted highest, same as before).
-- Run this in the Supabase SQL editor. Safe to re-run.

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
  with q as (
    -- plainto_tsquery joins lexemes with &; rewriting to | gives OR semantics.
    -- nullif guards the empty/stopword-only query, which yields no rows.
    select nullif(
      replace(plainto_tsquery('english', p_query)::text, ' & ', ' | '),
      ''
    )::tsquery as tsq
  )
  select
    s.id, s.kind, s.source, s.url, s.title, s.body, s.topic_key, s.published_at,
    ts_rank(s.search_vector, q.tsq)
      * (case when p_topic_key is not null and s.topic_key = p_topic_key then 1.5 else 1.0 end)
      * (1.0 / (1.0 + extract(epoch from (now() - coalesce(s.published_at, s.scraped_at))) / 7776000.0))
      as rank
  from public.scraped_data s, q
  where q.tsq is not null
    and s.search_vector @@ q.tsq
  order by rank desc
  limit greatest(1, least(p_limit, 20));
$$;
