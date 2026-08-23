-- ============================================================
-- 20260853_global_search.sql
--
-- Global search: posts, comments, communities, people and debates
-- (live / scheduled / ended) behind two security-definer RPCs.
--
--   search_all(p_q, p_kind, p_limit, p_offset)
--     → (kind, id, rank, created_at, payload)
--     kind ∈ post | comment | community | person | debate.
--     p_kind='all' returns a mixed page: the best 3 people, 3
--     communities, 5 debates and 10 posts+comments, then ordered by
--     rank (p_offset is ignored for 'all' — paging is per kind).
--     Any other p_kind pages that one kind with limit/offset.
--
--     Matching: a generated tsvector per table ('simple' config over
--     unaccented text) queried with websearch_to_tsquery, OR'd with a
--     prefix query built from the words (so "agor" finds "agora"), OR'd
--     with trigram similarity / prefix on names for people and
--     communities. Rank = ts_rank_cd (full + ½ prefix) + trigram
--     similarity, × kind boosts (live debate ×2, scheduled ×1.3), with
--     a small recency tie-break.
--
--     Visibility lives here, not in RLS: community_visible() for
--     posts / comments / communities (private boards only to members;
--     private communities are hidden entirely from non-members),
--     debates only when not is_private, people only when not
--     suspended, and blocks in both directions are excluded.
--     Anon callers see the public subset.
--
--   search_suggest(p_q, p_limit)
--     → (kind, id, label, sublabel, avatar_url, href_hint)
--     Cheap prefix matches for the navbar dropdown: people, communities,
--     live/scheduled debates. href_hint is a minimal path the app's
--     routers already accept (/@user, /communities/<uuid>, /agora/<id8>).
--
--   search_history  — the caller's recent queries (self-only RLS; the
--     client inserts and deletes, the RPCs never write).
--
-- Idempotent: safe to re-run.
-- ============================================================

create extension if not exists pg_trgm;
create extension if not exists unaccent;

-- unaccent() is STABLE (its dictionary could change), which blocks it
-- from generated columns. This wrapper pins the bundled dictionary and
-- declares immutability; search_path covers both places Supabase may
-- have installed the extension.
create or replace function public.immutable_unaccent(p text)
returns text
language sql immutable parallel safe strict
set search_path = public, extensions
as $$
  select unaccent('unaccent', p);
$$;
grant execute on function public.immutable_unaccent(text) to anon, authenticated;

-- ─── Generated tsvector columns + GIN indexes ────────────────
alter table public.community_posts
  add column if not exists search_tsv tsvector
  generated always as (
    setweight(to_tsvector('simple', public.immutable_unaccent(coalesce(title, ''))), 'A') ||
    setweight(to_tsvector('simple', public.immutable_unaccent(coalesce(body, ''))), 'B')
  ) stored;
create index if not exists community_posts_search_tsv_idx
  on public.community_posts using gin (search_tsv);

alter table public.community_comments
  add column if not exists search_tsv tsvector
  generated always as (
    to_tsvector('simple', public.immutable_unaccent(coalesce(body, '')))
  ) stored;
create index if not exists community_comments_search_tsv_idx
  on public.community_comments using gin (search_tsv);

alter table public.communities
  add column if not exists search_tsv tsvector
  generated always as (
    setweight(to_tsvector('simple', public.immutable_unaccent(coalesce(name, ''))), 'A') ||
    setweight(to_tsvector('simple', public.immutable_unaccent(coalesce(description, ''))), 'B')
  ) stored;
create index if not exists communities_search_tsv_idx
  on public.communities using gin (search_tsv);

alter table public.users
  add column if not exists search_tsv tsvector
  generated always as (
    setweight(to_tsvector('simple', public.immutable_unaccent(coalesce(username, ''))), 'A') ||
    setweight(to_tsvector('simple', public.immutable_unaccent(coalesce(display_name, ''))), 'A') ||
    setweight(to_tsvector('simple', public.immutable_unaccent(coalesce(bio, ''))), 'C')
  ) stored;
create index if not exists users_search_tsv_idx
  on public.users using gin (search_tsv);

alter table public.debate_rooms
  add column if not exists search_tsv tsvector
  generated always as (
    setweight(to_tsvector('simple', public.immutable_unaccent(coalesce(motion, ''))), 'A')
  ) stored;
create index if not exists debate_rooms_search_tsv_idx
  on public.debate_rooms using gin (search_tsv);

-- Trigram indexes for prefix / fuzzy name matching (the 20260830 sweep
-- already created lower(username) / lower(display_name) ones; these
-- cover the raw columns the RPCs query and add communities.name).
create index if not exists users_username_trgm2_idx
  on public.users using gin (username gin_trgm_ops);
create index if not exists users_display_name_trgm2_idx
  on public.users using gin (display_name gin_trgm_ops);
create index if not exists communities_name_trgm_idx
  on public.communities using gin (name gin_trgm_ops);

-- ─── Search history (client-written) ────────────────────────
create table if not exists public.search_history (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users(id) on delete cascade,
  query      text not null check (char_length(query) between 1 and 200),
  created_at timestamptz not null default now()
);
create index if not exists search_history_user_idx
  on public.search_history (user_id, created_at desc);

alter table public.search_history enable row level security;
drop policy if exists "search_history_self_select" on public.search_history;
drop policy if exists "search_history_self_insert" on public.search_history;
drop policy if exists "search_history_self_delete" on public.search_history;
create policy "search_history_self_select"
  on public.search_history for select using (auth.uid() = user_id);
create policy "search_history_self_insert"
  on public.search_history for insert with check (auth.uid() = user_id);
create policy "search_history_self_delete"
  on public.search_history for delete using (auth.uid() = user_id);
grant select, insert, delete on public.search_history to authenticated;

-- ─── Query helpers (internal) ───────────────────────────────
-- Prefix tsquery from the words of q: "agor sphe" → 'agor':* & 'sphe':*
create or replace function public.search_prefix_query(p_q text)
returns tsquery
language sql immutable parallel safe
set search_path = public, extensions
as $$
  select case when coalesce(w.q, '') = '' then null::tsquery else to_tsquery('simple', w.q) end
  from (
    select string_agg(word || ':*', ' & ') as q
    from (
      select regexp_replace(x, '[^[:alnum:]]', '', 'g') as word
      from regexp_split_to_table(lower(public.immutable_unaccent(coalesce(p_q, ''))), '\s+') as x
    ) t
    where word <> ''
  ) w;
$$;

-- ─── search_all ─────────────────────────────────────────────
drop function if exists public.search_all(text, text, integer, integer);
create function public.search_all(
  p_q text,
  p_kind text default 'all',
  p_limit integer default 20,
  p_offset integer default 0
)
returns table(kind text, id uuid, rank real, created_at timestamptz, payload jsonb)
language plpgsql stable security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_me     uuid := auth.uid();
  v_q      text := left(trim(coalesce(p_q, '')), 200);
  v_ts     tsquery;
  v_prefix tsquery;
  v_limit  integer := greatest(1, least(coalesce(p_limit, 20), 50));
  v_offset integer := greatest(0, coalesce(p_offset, 0));
  v_kind   text := coalesce(p_kind, 'all');
begin
  if v_q = '' then return; end if;
  v_ts := websearch_to_tsquery('simple', public.immutable_unaccent(v_q));
  v_prefix := public.search_prefix_query(v_q);
  if v_ts is null and v_prefix is null then return; end if;
  -- websearch_to_tsquery can yield an empty query ("" or only stop chars).
  if numnode(v_ts) = 0 then v_ts := null; end if;

  return query
  with
  blocked as (
    select b.blocked_id as uid from public.user_blocks b where b.blocker_id = v_me
    union
    select b.blocker_id from public.user_blocks b where b.blocked_id = v_me
  ),
  people as (
    select 'person'::text as kind, u.id, u.created_at,
      (
        coalesce(ts_rank_cd(u.search_tsv, v_ts), 0)
        + 0.5 * coalesce(ts_rank_cd(u.search_tsv, v_prefix), 0)
        + greatest(similarity(u.username, v_q), similarity(coalesce(u.display_name, ''), v_q))
        + case when u.username ilike v_q || '%' then 0.6 else 0 end
        + case when lower(u.username) = lower(v_q) then 1.0 else 0 end
      )::real as rank
    from public.users u
    where (v_kind in ('all', 'person'))
      and u.username is not null
      and (u.suspended_until is null or u.suspended_until < now())
      and u.id not in (select uid from blocked)
      and (
        (v_ts is not null and u.search_tsv @@ v_ts)
        or (v_prefix is not null and u.search_tsv @@ v_prefix)
        or u.username ilike v_q || '%'
        or (length(v_q) >= 3 and (u.username % v_q or coalesce(u.display_name, '') % v_q))
      )
  ),
  comms as (
    select 'community'::text as kind, c.id, c.created_at,
      (
        coalesce(ts_rank_cd(c.search_tsv, v_ts), 0)
        + 0.5 * coalesce(ts_rank_cd(c.search_tsv, v_prefix), 0)
        + similarity(c.name, v_q)
        + case when c.name ilike v_q || '%' then 0.6 else 0 end
      )::real as rank
    from public.communities c
    where (v_kind in ('all', 'community'))
      and public.community_visible(c.id, v_me)
      and (
        (v_ts is not null and c.search_tsv @@ v_ts)
        or (v_prefix is not null and c.search_tsv @@ v_prefix)
        or c.name ilike v_q || '%'
        or (length(v_q) >= 3 and c.name % v_q)
      )
  ),
  rooms as (
    select 'debate'::text as kind, r.id, r.created_at,
      (
        (coalesce(ts_rank_cd(r.search_tsv, v_ts), 0)
         + 0.5 * coalesce(ts_rank_cd(r.search_tsv, v_prefix), 0))
        * case r.status when 'live' then 2.0 when 'scheduled' then 1.3 else 1.0 end
        + 0.05 / (1 + extract(epoch from now() - r.created_at) / 86400.0 / 30.0)
      )::real as rank
    from public.debate_rooms r
    where (v_kind in ('all', 'debate'))
      and r.status in ('live', 'scheduled', 'created', 'ended')
      and not coalesce(r.is_private, false)
      and (r.host_id is null or r.host_id not in (select uid from blocked))
      and (
        (v_ts is not null and r.search_tsv @@ v_ts)
        or (v_prefix is not null and r.search_tsv @@ v_prefix)
      )
  ),
  posts as (
    select 'post'::text as kind, p.id, p.created_at,
      (
        coalesce(ts_rank_cd(p.search_tsv, v_ts), 0)
        + 0.5 * coalesce(ts_rank_cd(p.search_tsv, v_prefix), 0)
        + 0.05 / (1 + extract(epoch from now() - p.created_at) / 86400.0 / 30.0)
      )::real as rank
    from public.community_posts p
    where (v_kind in ('all', 'post'))
      and public.community_visible(p.community_id, v_me)
      and (p.author_id is null or p.author_id not in (select uid from blocked))
      and (
        (v_ts is not null and p.search_tsv @@ v_ts)
        or (v_prefix is not null and p.search_tsv @@ v_prefix)
      )
  ),
  comments as (
    select 'comment'::text as kind, cm.id, cm.created_at,
      (
        coalesce(ts_rank_cd(cm.search_tsv, v_ts), 0)
        + 0.5 * coalesce(ts_rank_cd(cm.search_tsv, v_prefix), 0)
        + 0.05 / (1 + extract(epoch from now() - cm.created_at) / 86400.0 / 30.0)
      )::real as rank
    from public.community_comments cm
    join public.community_posts p on p.id = cm.post_id
    where (v_kind in ('all', 'comment'))
      and public.community_visible(p.community_id, v_me)
      and (cm.author_id is null or cm.author_id not in (select uid from blocked))
      and (
        (v_ts is not null and cm.search_tsv @@ v_ts)
        or (v_prefix is not null and cm.search_tsv @@ v_prefix)
      )
  ),
  picked as (
    -- 'all': a fixed quota per kind, then ranked together.
    -- single kind: one paged list.
    select * from (
      (select * from people   order by rank desc, created_at desc
        limit case when v_kind = 'all' then 3 else v_limit end
        offset case when v_kind = 'all' then 0 else v_offset end)
      union all
      (select * from comms    order by rank desc, created_at desc
        limit case when v_kind = 'all' then 3 else v_limit end
        offset case when v_kind = 'all' then 0 else v_offset end)
      union all
      (select * from rooms    order by rank desc, created_at desc
        limit case when v_kind = 'all' then 5 else v_limit end
        offset case when v_kind = 'all' then 0 else v_offset end)
      union all
      (select * from (select * from posts union all select * from comments) pc
        order by rank desc, created_at desc
        limit case when v_kind = 'all' then 10
                   when v_kind in ('post', 'comment') then v_limit else 0 end
        offset case when v_kind = 'all' then 0 else v_offset end)
    ) u
  )
  select
    x.kind, x.id, x.rank, x.created_at,
    case x.kind
      when 'post' then public.feed_post_payload(x.id)
      when 'debate' then (
        select public.feed_room_payload(r.id)
          || jsonb_build_object(
               'ended_at', r.ended_at,
               'recording_url', r.recording_url,
               'is_private', r.is_private)
        from public.debate_rooms r where r.id = x.id)
      when 'comment' then (
        select jsonb_build_object(
          'id', cm.id,
          'post_id', cm.post_id,
          'post_title', p.title,
          'community_id', p.community_id,
          'community_name', c.name,
          'body', cm.body,
          'excerpt', ts_headline('simple', cm.body,
              coalesce(v_ts, v_prefix),
              'MaxFragments=1, MaxWords=28, MinWords=12, StartSel=, StopSel=, FragmentDelimiter=…'),
          'created_at', cm.created_at,
          'author', case when u.id is null then null else jsonb_build_object(
            'id', u.id, 'username', u.username, 'display_name', u.display_name, 'avatar_url', u.avatar_url) end)
        from public.community_comments cm
        join public.community_posts p on p.id = cm.post_id
        join public.communities c on c.id = p.community_id
        left join public.users u on u.id = cm.author_id
        where cm.id = x.id)
      when 'community' then (
        select jsonb_build_object(
          'id', c.id,
          'name', c.name,
          'description', c.description,
          'avatar_url', c.avatar_url,
          'color', c.color,
          'is_private', c.is_private,
          'members', (select count(*) from public.community_members m where m.community_id = c.id),
          'joined', exists (select 1 from public.community_members m
                             where m.community_id = c.id and m.user_id = v_me))
        from public.communities c where c.id = x.id)
      when 'person' then (
        select jsonb_build_object(
          'id', u.id,
          'username', u.username,
          'display_name', u.display_name,
          'avatar_url', u.avatar_url,
          'verified', coalesce(u.verified, false),
          'bio', u.bio,
          'is_following', exists (select 1 from public.user_follows f
                                   where f.follower_id = v_me and f.following_id = u.id),
          'followers', (select count(*) from public.user_follows f where f.following_id = u.id))
        from public.users u where u.id = x.id)
    end as payload
  from picked x
  order by x.rank desc, x.created_at desc;
end;
$$;

revoke all on function public.search_all(text, text, integer, integer) from public;
grant execute on function public.search_all(text, text, integer, integer) to anon, authenticated;

-- ─── search_suggest ─────────────────────────────────────────
drop function if exists public.search_suggest(text, integer);
create function public.search_suggest(p_q text, p_limit integer default 8)
returns table(kind text, id uuid, label text, sublabel text, avatar_url text, href_hint text)
language sql stable security definer
set search_path = public, extensions
as $$
  with q as (
    select left(trim(coalesce(p_q, '')), 100) as q,
           greatest(1, least(coalesce(p_limit, 8), 20)) as lim,
           auth.uid() as me
  ),
  blocked as (
    select b.blocked_id as uid from public.user_blocks b, q where b.blocker_id = q.me
    union
    select b.blocker_id from public.user_blocks b, q where b.blocked_id = q.me
  ),
  people as (
    select 'person'::text as kind, u.id,
      coalesce(nullif(trim(u.display_name), ''), '@' || u.username) as label,
      '@' || u.username as sublabel,
      u.avatar_url,
      '/@' || u.username as href_hint,
      (case when lower(u.username) = lower(q.q) then 3
            when u.username ilike q.q || '%' then 2 else 1 end
       + similarity(u.username, q.q))::real as score
    from public.users u, q
    where q.q <> ''
      and u.username is not null
      and (u.suspended_until is null or u.suspended_until < now())
      and u.id not in (select uid from blocked)
      and (u.username ilike q.q || '%' or u.display_name ilike q.q || '%'
           or u.display_name ilike '% ' || q.q || '%')
    order by score desc, u.username
    limit 4
  ),
  comms as (
    select 'community'::text as kind, c.id,
      c.name as label,
      (select count(*) from public.community_members m where m.community_id = c.id)::text || ' members' as sublabel,
      c.avatar_url,
      '/communities/' || c.id::text as href_hint,
      (case when c.name ilike q.q || '%' then 2 else 1 end + similarity(c.name, q.q))::real as score
    from public.communities c, q
    where q.q <> ''
      and public.community_visible(c.id, q.me)
      and (c.name ilike q.q || '%' or c.name ilike '% ' || q.q || '%')
    order by score desc, c.name
    limit 3
  ),
  rooms as (
    select 'debate'::text as kind, r.id,
      r.motion as label,
      case r.status when 'live' then 'Live now'
                    when 'scheduled' then 'Scheduled' else 'Open' end as sublabel,
      coalesce(r.thumbnail_url, h.avatar_url) as avatar_url,
      '/agora/' || left(replace(r.id::text, '-', ''), 8) as href_hint,
      (case r.status when 'live' then 2 else 1 end
       + case when r.motion ilike q.q || '%' then 1 else 0 end)::real as score
    from public.debate_rooms r
    left join public.users h on h.id = r.host_id, q
    where q.q <> ''
      and not coalesce(r.is_private, false)
      and r.status in ('live', 'scheduled', 'created')
      and (r.host_id is null or r.host_id not in (select uid from blocked))
      and (r.motion ilike '%' || q.q || '%'
           or (public.search_prefix_query(q.q) is not null
               and r.search_tsv @@ public.search_prefix_query(q.q)))
    order by score desc, r.created_at desc
    limit 4
  )
  select kind, id, label, sublabel, avatar_url, href_hint
  from (
    select *, 1 as ord from people
    union all select *, 2 from comms
    union all select *, 3 from rooms
  ) all_rows, q
  order by ord, score desc
  limit (select lim from q);
$$;

revoke all on function public.search_suggest(text, integer) from public;
grant execute on function public.search_suggest(text, integer) to anon, authenticated;
