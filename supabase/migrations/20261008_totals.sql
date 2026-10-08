-- Anonymous totals: reading what was argued in public rooms, counting it,
-- and the desk a few named people download the counts from.
--
-- The terms (components/agora/legal.ts, section 6) let us publish, share
-- or sell totals about what is said in public rooms: no names, no quotes,
-- nothing drawn from fewer than 25 people, and a person can leave their
-- words out. This is the machinery, with those limits built into it.
--
-- 1. totals_staff: who may open the desk (/totals).
-- 2. room_readings: per public room and speaker, the side they argued
--    and the kinds of argument they used. Categories only, never words.
--    Its owner can read their own rows; nobody else can.
--    room_reading_runs: which rooms have been read.
-- 3. totals_countable(): who may be counted, as things stand today.
--    totals_rooms_to_read(), totals_room_speakers(), totals_tidy(): what
--    the reader (lib/totals/readRun.ts) asks and keeps in order.
-- 4. totals_cells(): the counts for a stretch of months. It returns
--    small groups too, so only the server may call it; the server blanks
--    them (lib/totals/table.ts) before anything is shown or downloaded.
--    totals_overview(): the desk's summary.
-- 5. totals_exports: every download, who made it and who it was for.
-- 6. A person's own download, "delete my derived data" and deleting an
--    account now cover the readings.
--
-- Nobody is on the desk's list after this runs: a person is added by
-- hand,
--   insert into public.totals_staff (user_id) select id from public.users where username = '…';

-- ── 1. who may open the desk ────────────────────────────────────────
create table if not exists public.totals_staff (
  user_id  uuid primary key references public.users(id) on delete cascade,
  added_at timestamptz not null default now()
);

alter table public.totals_staff enable row level security;
revoke all on public.totals_staff from anon, authenticated;

create or replace function public.is_totals_staff()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (select 1 from public.totals_staff s where s.user_id = auth.uid());
$$;

revoke execute on function public.is_totals_staff() from public, anon;
grant execute on function public.is_totals_staff() to authenticated;

-- ── 2. what was argued ──────────────────────────────────────────────
-- One row for a speaker in a public room: which side of the motion they
-- argued and which kinds of argument they leaned on. No words are kept
-- here, so none can leave by this road. Like everything worked out
-- about a person, they can see it (it is in their download).
create table if not exists public.room_readings (
  room_id        uuid not null references public.debate_rooms(id) on delete cascade,
  user_id        uuid not null references public.users(id) on delete cascade,
  stance         text not null check (stance in ('for', 'against', 'mixed', 'unclear')),
  -- KINDS in lib/totals/kinds.ts (kinds.test.ts holds the two lists equal).
  kinds          text[] not null default '{}'
                 check (kinds <@ array['money', 'fairness', 'freedom', 'safety', 'evidence', 'experience',
                                       'values', 'practical', 'trust', 'law', 'future']::text[]),
  confidence     real not null check (confidence >= 0 and confidence <= 1),
  lines          integer not null check (lines >= 0),
  seconds_spoken integer not null check (seconds_spoken >= 0),
  -- The version of the list of kinds this was read with.
  taxonomy       smallint not null,
  model          text,
  read_at        timestamptz not null default now(),
  primary key (room_id, user_id)
);

create index if not exists room_readings_user_idx on public.room_readings (user_id);

alter table public.room_readings enable row level security;

drop policy if exists "own readings readable" on public.room_readings;
create policy "own readings readable"
  on public.room_readings for select
  using (auth.uid() = user_id);

revoke all on public.room_readings from anon, authenticated;
grant select on public.room_readings to authenticated;

create table if not exists public.room_reading_runs (
  room_id       uuid primary key references public.debate_rooms(id) on delete cascade,
  -- The transcript it was read from: a later one is read again.
  transcript_at timestamptz not null,
  taxonomy      smallint not null,
  -- Speakers who could be counted when it was read, and how many of
  -- them had said enough to be read.
  speakers      integer not null default 0,
  read          integer not null default 0,
  ran_at        timestamptz not null default now()
);

alter table public.room_reading_runs enable row level security;
revoke all on public.room_reading_runs from anon, authenticated;

-- ── 3. who is counted ───────────────────────────────────────────────
-- People in the European Economic Area, the United Kingdom and
-- Switzerland are left out: the law there treats a political opinion as
-- specially protected, and counting it needs a yes we do not ask for.
-- LEFT_OUT in lib/totals/kinds.ts (kinds.test.ts holds the lists equal).
create or replace function public.totals_left_out(p_country text)
returns boolean
language sql
immutable
set search_path to ''
as $$
  select coalesce(p_country = any (array[
    'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU',
    'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
    'IS', 'LI', 'NO',
    'GB', 'CH'
  ]), false);
$$;

-- Someone is counted only if they have agreed to the terms, have left
-- the Data & Coach switch on, have given a date of birth that makes
-- them old enough, and live somewhere that is not left out. agreed_at
-- is when they first agreed: nothing from before it is counted.
create or replace function public.totals_countable()
returns table (user_id uuid, agreed_at timestamptz, birth_year smallint, country text, region text)
language sql
stable
security definer
set search_path to 'public'
as $$
  select d.user_id, a.agreed_at, d.birth_year, d.country, d.region
  from public.user_details d
  join (
    select g.user_id, min(g.accepted_at) as agreed_at
    from public.user_agreements g
    group by g.user_id
  ) a on a.user_id = d.user_id
  join public.user_data_consent c on c.user_id = d.user_id and c.research
  where d.age_checked_at is not null
    and d.under_age_at is null
    and d.birth_year is not null
    and d.country is not null
    and not public.totals_left_out(d.country);
$$;

revoke execute on function public.totals_countable() from public, anon, authenticated;
grant execute on function public.totals_countable() to service_role;

-- The speakers of one public, ended room who may be counted for it:
-- people with a line in its transcript who had agreed before it began.
create or replace function public.totals_room_speakers(p_room uuid)
returns table (user_id uuid)
language sql
stable
security definer
set search_path to 'public'
as $$
  select distinct e.user_id
  from public.debate_rooms r
  left join public.communities c on c.id = r.community_id
  join public.replay_transcripts t on t.room_id = r.id and t.status = 'done' and jsonb_typeof(t.lines) = 'array'
  cross join lateral jsonb_array_elements(t.lines) as l(line)
  join public.totals_countable() e on e.user_id::text = l.line ->> 'user_id'
  where r.id = p_room
    and r.status = 'ended'
    and r.is_private = false
    and coalesce(c.is_private, false) = false
    and r.started_at is not null
    and e.agreed_at <= r.started_at;
$$;

revoke execute on function public.totals_room_speakers(uuid) from public, anon, authenticated;
grant execute on function public.totals_room_speakers(uuid) to service_role;

-- Rooms the reader has work in: public, ended, with a finished
-- transcript and at least one speaker who may be counted, and either
-- never read, or read from an older transcript, with an older list of
-- kinds, or when a different number of its speakers could be counted.
-- Rooms from before anyone had agreed are never looked at.
create or replace function public.totals_rooms_to_read(p_taxonomy smallint, p_limit integer default 5)
returns table (room_id uuid, motion text, transcript_at timestamptz, speakers integer)
language sql
stable
security definer
set search_path to 'public'
as $$
  select r.id, r.motion, t.updated_at, s.n
  from public.debate_rooms r
  left join public.communities c on c.id = r.community_id
  join public.replay_transcripts t on t.room_id = r.id and t.status = 'done' and jsonb_typeof(t.lines) = 'array'
  left join public.room_reading_runs u on u.room_id = r.id
  cross join lateral (select count(*)::int as n from public.totals_room_speakers(r.id)) s
  where r.status = 'ended'
    and r.is_private = false
    and coalesce(c.is_private, false) = false
    and r.started_at >= (select min(g.accepted_at) from public.user_agreements g)
    and s.n > 0
    and (u.room_id is null or u.transcript_at < t.updated_at or u.taxonomy < p_taxonomy or u.speakers <> s.n)
  order by r.started_at desc
  limit greatest(1, least(coalesce(p_limit, 5), 50));
$$;

revoke execute on function public.totals_rooms_to_read(smallint, integer) from public, anon, authenticated;
grant execute on function public.totals_rooms_to_read(smallint, integer) to service_role;

-- Readings that may no longer be counted are removed, not just skipped:
-- the room stopped being public, or the person is no longer countable
-- for it. Returns how many went.
create or replace function public.totals_tidy()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_gone integer;
begin
  delete from public.room_readings x
  using public.debate_rooms r
  left join public.communities c on c.id = r.community_id
  where r.id = x.room_id
    and (
      r.status <> 'ended'
      or r.is_private is distinct from false
      or coalesce(c.is_private, false)
      or not exists (
        select 1 from public.totals_countable() e
        where e.user_id = x.user_id and e.agreed_at <= r.started_at
      )
    );
  get diagnostics v_gone = row_count;
  return v_gone;
end;
$$;

revoke execute on function public.totals_tidy() from public, anon, authenticated;
grant execute on function public.totals_tidy() to service_role;

-- Switching "leave my words out" on removes what was read, at once.
create or replace function public.totals_forget_on_switch_off()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if old.research and not new.research then
    delete from public.room_readings where user_id = new.user_id;
  end if;
  return new;
end;
$$;

revoke execute on function public.totals_forget_on_switch_off() from public, anon, authenticated;

drop trigger if exists totals_forget_on_switch_off on public.user_data_consent;
create trigger totals_forget_on_switch_off
  after update of research on public.user_data_consent
  for each row execute function public.totals_forget_on_switch_off();

-- ── 4. the counts ───────────────────────────────────────────────────
-- Counts of people for public rooms that began in the months p_from to
-- p_to (whole calendar months, UTC). One row is one group of people:
--
--   measure    what was counted
--     took_part  per topic: spoke (on the stage) or listened
--     argued     per motion: the side a speaker argued
--     kinds      per topic: the kinds of argument speakers used
--     voted      per motion: votes in the room
--   category   the part of it ('any' is everyone the measure covers)
--   dimension  how it is split: all, age, country, state (US only)
--   people     how many different people
--   rooms, minutes  on the took_part / any / all row: the rooms counted
--                   for the topic and how long they ran
--
-- A motion is its text with capitals and spacing evened out, so the same
-- motion in two rooms is one subject; label is how it reads.
--
-- THIS RETURNS SMALL GROUPS. Only the server calls it, and it blanks
-- them before anything is shown: lib/totals/table.ts.
create or replace function public.totals_cells(p_from date, p_to date)
returns table (
  measure text, subject_kind text, subject text, label text,
  category text, dimension text, value text,
  people integer, rooms integer, minutes integer
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with bounds as (
    select (date_trunc('month', p_from::timestamp) at time zone 'UTC') as t0,
           ((date_trunc('month', p_to::timestamp) + interval '1 month') at time zone 'UTC') as t1,
           extract(year from p_to)::int as y
  ),
  rooms as (
    select r.id, r.started_at, r.topic_key,
           lower(regexp_replace(btrim(r.motion), '\s+', ' ', 'g')) as motion_key,
           regexp_replace(btrim(r.motion), '\s+', ' ', 'g') as motion,
           -- a room left open is not a room that ran for days
           least(480, greatest(0, extract(epoch from (coalesce(r.ended_at, r.started_at) - r.started_at)) / 60))::int as minutes
    from public.debate_rooms r
    left join public.communities c on c.id = r.community_id
    cross join bounds b
    where r.status = 'ended'
      and r.is_private = false
      and coalesce(c.is_private, false) = false
      and r.started_at >= b.t0
      and r.started_at < b.t1
  ),
  people as (
    -- Only the year of birth is kept, so an age is right to within a year.
    select e.user_id, e.agreed_at, e.country, e.region,
           case when b.y - e.birth_year < 25 then '18-24'
                when b.y - e.birth_year < 35 then '25-34'
                when b.y - e.birth_year < 45 then '35-44'
                when b.y - e.birth_year < 55 then '45-54'
                when b.y - e.birth_year < 65 then '55-64'
                else '65+' end as age
    from public.totals_countable() e
    cross join bounds b
  ),
  facts as (
    select 'took_part'::text as measure, 'topic'::text as subject_kind, r.topic_key as subject, r.topic_key as label,
           case when p.stage_role in ('host', 'speaker') then 'spoke' else 'listened' end as category,
           p.user_id, r.id as room_id, r.minutes
    from public.debate_participants p
    join rooms r on r.id = p.room_id
    join people e on e.user_id = p.user_id and e.agreed_at <= r.started_at
    union all
    select 'argued', 'motion', r.motion_key, r.motion, x.stance, x.user_id, r.id, r.minutes
    from public.room_readings x
    join rooms r on r.id = x.room_id
    join people e on e.user_id = x.user_id and e.agreed_at <= r.started_at
    where x.stance in ('for', 'against', 'mixed')
    union all
    select 'kinds', 'topic', r.topic_key, r.topic_key, k.kind, x.user_id, r.id, r.minutes
    from public.room_readings x
    join rooms r on r.id = x.room_id
    join people e on e.user_id = x.user_id and e.agreed_at <= r.started_at
    cross join lateral unnest(x.kinds) as k(kind)
    union all
    select 'voted', 'motion', r.motion_key, r.motion,
           case v.stance when 'PRO' then 'for' else 'against' end, v.voter_id, r.id, r.minutes
    from public.debate_votes v
    join rooms r on r.id = v.room_id
    join people e on e.user_id = v.voter_id and e.agreed_at <= r.started_at
    where v.stance in ('PRO', 'CON')
  ),
  with_any as (
    select f.measure, f.subject_kind, f.subject, f.category, f.user_id from facts f
    union all
    select f.measure, f.subject_kind, f.subject, 'any', f.user_id from facts f
  ),
  spread as (
    select f.measure, f.subject_kind, f.subject, f.category, d.dimension, d.value, f.user_id
    from with_any f
    join people e on e.user_id = f.user_id
    cross join lateral (
      values ('all', 'all'), ('age', e.age), ('country', e.country), ('state', e.region)
    ) as d(dimension, value)
    where d.value is not null
  ),
  counted as (
    select s.measure, s.subject_kind, s.subject, s.category, s.dimension, s.value,
           count(distinct s.user_id)::int as people
    from spread s
    group by s.measure, s.subject_kind, s.subject, s.category, s.dimension, s.value
  ),
  -- one way of writing each subject, the same on every one of its rows
  names as (
    select f.subject_kind, f.subject, min(f.label) as label
    from facts f
    group by f.subject_kind, f.subject
  ),
  held as (
    select t.subject, count(*)::int as rooms, coalesce(sum(t.minutes), 0)::int as minutes
    from (select distinct f.subject, f.room_id, f.minutes from facts f where f.measure = 'took_part') t
    group by t.subject
  )
  select c.measure, c.subject_kind, c.subject, n.label, c.category, c.dimension, c.value, c.people,
         case when c.measure = 'took_part' and c.category = 'any' and c.dimension = 'all' then h.rooms end,
         case when c.measure = 'took_part' and c.category = 'any' and c.dimension = 'all' then h.minutes end
  from counted c
  join names n on n.subject_kind = c.subject_kind and n.subject = c.subject
  left join held h on c.measure = 'took_part' and h.subject = c.subject;
$$;

revoke execute on function public.totals_cells(date, date) from public, anon, authenticated;
grant execute on function public.totals_cells(date, date) to service_role;

-- The desk's summary: how many accounts could be counted and why the
-- rest are not, and how far the reading has got. For the desk only.
create or replace function public.totals_overview(p_taxonomy smallint)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  with who as (
    select u.id,
           exists (select 1 from public.user_agreements g where g.user_id = u.id) as agreed,
           coalesce((select c.research from public.user_data_consent c where c.user_id = u.id), false) as switch_on,
           d.age_checked_at is not null and d.under_age_at is null and d.birth_year is not null and d.country is not null as told,
           public.totals_left_out(d.country) as left_out
    from public.users u
    left join public.user_details d on d.user_id = u.id
    where u.username not like 'deleted-%'
  ),
  open_rooms as (
    select r.id
    from public.debate_rooms r
    left join public.communities c on c.id = r.community_id
    where r.status = 'ended' and r.is_private = false and coalesce(c.is_private, false) = false and r.started_at is not null
  )
  select jsonb_build_object(
    'accounts',      (select count(*) from who),
    'countable',     (select count(*) from who where agreed and switch_on and coalesce(told, false) and not left_out),
    'not_agreed',    (select count(*) from who where not agreed),
    'switched_off',  (select count(*) from who where agreed and not switch_on),
    'not_told',      (select count(*) from who where agreed and switch_on and not coalesce(told, false)),
    'left_out',      (select count(*) from who where agreed and switch_on and coalesce(told, false) and left_out),
    'rooms',         (select count(*) from open_rooms),
    'transcribed',   (select count(*) from open_rooms o join public.replay_transcripts t on t.room_id = o.id and t.status = 'done'),
    'read',          (select count(*) from public.room_reading_runs),
    'waiting',       (select count(*) from public.totals_rooms_to_read(p_taxonomy, 50)),
    'readings',      (select count(*) from public.room_readings),
    'first_agreed',  (select min(g.accepted_at) from public.user_agreements g)
  );
$$;

revoke execute on function public.totals_overview(smallint) from public, anon, authenticated;
grant execute on function public.totals_overview(smallint) to service_role;

-- ── 5. every download ───────────────────────────────────────────────
-- Written by the server before the file is handed over, so there is no
-- download without a line here.
create table if not exists public.totals_exports (
  id          uuid primary key default gen_random_uuid(),
  made_by     uuid references public.users(id) on delete set null,
  made_at     timestamptz not null default now(),
  period_from date not null,
  period_to   date not null,
  -- Who the file is for: a buyer's name, or "ourselves".
  made_for    text not null check (char_length(btrim(made_for)) between 2 and 120),
  note        text check (note is null or char_length(note) <= 500),
  -- Lines in the file, and groups left out of it for being too small.
  lines       integer not null check (lines >= 0),
  blanked     integer not null check (blanked >= 0),
  floor       integer not null,
  file_sha256 text not null
);

create index if not exists totals_exports_made_at_idx on public.totals_exports (made_at desc);

alter table public.totals_exports enable row level security;
revoke all on public.totals_exports from anon, authenticated;

-- ── 6. a person's own download, delete, and leaving ─────────────────
-- "Download what we hold" gains what was read from their rooms. The
-- body is the live one (20261007_terms_agreement) with that key added.
create or replace function public.export_user_data()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
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
    'signals_count',   (select count(*) from public.user_signals s where s.user_id = uid),
    'about_you',       (select jsonb_build_object('birth_year', a.birth_year, 'country', a.country, 'state', a.region, 'age_checked_at', a.age_checked_at)
                        from public.user_details a where a.user_id = uid),
    'agreements',      (select coalesce(jsonb_agg(jsonb_build_object('version', g.version, 'accepted_at', g.accepted_at, 'platform', g.platform) order by g.accepted_at), '[]'::jsonb)
                        from public.user_agreements g where g.user_id = uid),
    'room_readings',   (select coalesce(jsonb_agg(jsonb_build_object('room_id', x.room_id, 'motion', r.motion, 'side', x.stance, 'kinds', x.kinds, 'read_at', x.read_at) order by x.read_at), '[]'::jsonb)
                        from public.room_readings x join public.debate_rooms r on r.id = x.room_id where x.user_id = uid)
  );
end;
$function$;

-- "Delete my derived data" removes the readings too and, like the other
-- kinds of working-out, leaves it switched off, so nothing is read again
-- until the person turns it back on. The body is the live one
-- (pg_get_functiondef, 2026-10-08) with the readings and the switch
-- added.
create or replace function public.erase_user_data()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
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
  delete from public.room_readings         where user_id = uid;
  update public.user_data_consent
     set analytics = false, debate_analysis = false,
         personalization = false, coaching = false, research = false, updated_at = now()
   where user_id = uid;
end;
$function$;

-- Deleting an account: the readings go with the details, and so does a
-- place on the desk's list. The body is the live one
-- (20261007_terms_agreement) with those two lines added.
create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  delete from public.user_follows   where follower_id = v_me or following_id = v_me;
  delete from public.user_blocks    where blocker_id = v_me or blocked_id = v_me;
  delete from public.community_members where user_id = v_me;
  delete from public.debate_queue   where user_id = v_me;
  delete from public.user_settings  where user_id = v_me;
  delete from public.clip_likes     where user_id = v_me;
  delete from public.user_details   where user_id = v_me;
  delete from public.room_readings  where user_id = v_me;
  delete from public.totals_staff   where user_id = v_me;

  update public.users
  set username           = 'deleted-' || substr(v_me::text, 1, 8),
      display_name       = null,
      bio                = null,
      avatar_url         = null,
      banner_url         = null,
      social_links       = '[]'::jsonb,
      email              = 'deleted-' || substr(v_me::text, 1, 8) || '@deleted.invalid',
      is_moderator       = false,
      suspended_until    = null,
      username_changed_at = now()
  where id = v_me;

  delete from auth.refresh_tokens where user_id = v_me::text;
  delete from auth.sessions       where user_id = v_me;
  delete from auth.identities     where user_id = v_me;
  delete from auth.mfa_factors    where user_id = v_me;
  update auth.users
  set email              = 'deleted-' || substr(v_me::text, 1, 8) || '@deleted.invalid',
      encrypted_password = null,
      raw_user_meta_data = '{}'::jsonb,
      phone              = null
  where id = v_me;
end;
$function$;
