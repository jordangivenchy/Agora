-- The terms people agree to, when, and what they tell us as they do.
--
-- AgoraSphere's terms and privacy policy now exist (components/agora/
-- legal.ts, /terms, /privacy). A signed-in person is asked once to
-- agree to the version in force (/agree, and the app's own screen);
-- that is recorded here, and shown in their settings. When the terms
-- change in a way that matters the version changes and everyone is
-- asked again, so a row says exactly which words a person accepted.
--
-- The first time, they are also asked their date of birth, their
-- country and, in the United States, their state (components/agora/
-- aboutYou.ts, places.ts). The date is checked — 18 or older — and
-- dropped; the year is kept.
--
-- 1. user_agreements: the record.
-- 2. user_details: the year of birth, the country and the state; or the
--    hold on an account whose date of birth was under age.
-- 3. accept_terms(): agrees, and saves the details, in one go.
--    set_my_place(): a move, later, from Settings.
-- 4. user_data_consent.research: the switch the terms promise — leave
--    my words out of the anonymous totals about public rooms.
-- 5. Deleting an account removes the details; the download has them.

-- ── 1. the record ───────────────────────────────────────────────────
create table if not exists public.user_agreements (
  user_id     uuid not null references public.users(id) on delete cascade,
  -- The terms' version, a date: LEGAL.version in components/agora/legal.ts.
  version     text not null check (version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[a-z]?$'),
  accepted_at timestamptz not null default now(),
  -- Where the person agreed.
  platform    text check (platform in ('web', 'ios', 'android')),
  primary key (user_id, version)
);

alter table public.user_agreements enable row level security;

-- A person can see their own record. Nobody writes it directly: the
-- time of agreeing is the server's, through accept_terms().
drop policy if exists "own agreements readable" on public.user_agreements;
create policy "own agreements readable"
  on public.user_agreements for select
  using (auth.uid() = user_id);

revoke all on public.user_agreements from anon, authenticated;
grant select on public.user_agreements to authenticated;

-- ── 2. about the person ─────────────────────────────────────────────
-- Private: only its owner reads a row, and nothing here is shown on a
-- profile. Not columns on users, which everyone can read.
create table if not exists public.user_details (
  user_id        uuid primary key references public.users(id) on delete cascade,
  -- The year alone: enough for an age group, less to look after. The
  -- full date is checked by accept_terms() and never stored.
  birth_year     smallint check (birth_year between 1900 and 2100),
  -- When a date of birth that makes them old enough was given.
  age_checked_at timestamptz,
  -- When a date of birth that makes them too young was given. While
  -- this is set the account can't agree to the terms, so it can't get
  -- past the agreement step. Lifted by hand, when it was a mistake:
  --   update public.user_details set under_age_at = null where user_id = …;
  under_age_at   timestamptz,
  -- ISO 3166-1, two capitals: 'US', 'CA', 'GB'.
  country        text check (country ~ '^[A-Z]{2}$'),
  -- ISO 3166-2, for the United States only: 'US-CA'.
  region         text check (region ~ '^[A-Z]{2}-[A-Z0-9]{1,3}$'),
  updated_at     timestamptz not null default now()
);

alter table public.user_details enable row level security;

drop policy if exists "own details readable" on public.user_details;
create policy "own details readable"
  on public.user_details for select
  using (auth.uid() = user_id);

revoke all on public.user_details from anon, authenticated;
grant select on public.user_details to authenticated;

-- The fifty states and the District of Columbia (US_STATES in
-- components/agora/places.ts; places.test.ts holds the two lists equal).
create or replace function public.is_us_state(p_code text)
returns boolean
language sql
immutable
as $$
  select coalesce(p_code = any (array[
    'US-AL', 'US-AK', 'US-AZ', 'US-AR', 'US-CA', 'US-CO', 'US-CT', 'US-DE', 'US-DC', 'US-FL',
    'US-GA', 'US-HI', 'US-ID', 'US-IL', 'US-IN', 'US-IA', 'US-KS', 'US-KY', 'US-LA', 'US-ME',
    'US-MD', 'US-MA', 'US-MI', 'US-MN', 'US-MS', 'US-MO', 'US-MT', 'US-NE', 'US-NV', 'US-NH',
    'US-NJ', 'US-NM', 'US-NY', 'US-NC', 'US-ND', 'US-OH', 'US-OK', 'US-OR', 'US-PA', 'US-RI',
    'US-SC', 'US-SD', 'US-TN', 'US-TX', 'US-UT', 'US-VT', 'US-VA', 'US-WA', 'US-WV', 'US-WI',
    'US-WY'
  ]), false);
$$;

-- ── 3. agreeing ─────────────────────────────────────────────────────
-- Agree to a version of the terms, now. The first time, the date of
-- birth and the place come with it and are saved in the same step, so
-- nothing about a person is kept before they have agreed.
--
-- Returns {"result": "ok", "accepted_at": …}, or {"result": "under_age"}
-- when the date of birth makes them younger than 18: that is remembered
-- (user_details.under_age_at) and the same answer comes back from then
-- on, whatever date is sent next. Agreeing twice changes nothing: the
-- first time stands, and so does the year of birth once it is checked.
drop function if exists public.accept_terms(text, text);
create or replace function public.accept_terms(
  p_version  text,
  p_platform text default 'web',
  p_birth    date default null,
  p_country  text default null,
  p_region   text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user    uuid := auth.uid();
  -- LEGAL.minAge in components/agora/legal.ts (legal.test.ts holds the two equal).
  v_min_age constant int := 18;
  -- Today at its latest anywhere on Earth, so nobody is turned away on
  -- their birthday for living east of the server.
  v_today   date := ((now() at time zone 'UTC') + interval '14 hours')::date;
  v_d       public.user_details%rowtype;
  v_year    smallint;
  v_checked timestamptz;
  v_country text;
  v_region  text;
  v_at      timestamptz;
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  if p_version is null or p_version !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[a-z]?$' then
    raise exception 'unknown version of the terms' using errcode = '22023';
  end if;

  select * into v_d from public.user_details where user_id = v_user;
  if v_d.under_age_at is not null then
    return jsonb_build_object('result', 'under_age');
  end if;

  -- The age, once.
  v_year := v_d.birth_year;
  v_checked := v_d.age_checked_at;
  if v_checked is null then
    if p_birth is null then
      raise exception 'birth_date_required' using errcode = '22023';
    end if;
    if p_birth > v_today or p_birth < date '1900-01-01' then
      raise exception 'birth_date_invalid' using errcode = '22023';
    end if;
    if extract(year from age(v_today, p_birth)) < v_min_age then
      insert into public.user_details (user_id, under_age_at)
      values (v_user, now())
      on conflict (user_id) do update set under_age_at = now(), updated_at = now();
      return jsonb_build_object('result', 'under_age');
    end if;
    v_year := extract(year from p_birth)::smallint;
    v_checked := now();
  end if;

  -- The place: what was sent, or what is already on record.
  v_country := upper(btrim(coalesce(p_country, v_d.country, '')));
  if v_country !~ '^[A-Z]{2}$' then
    raise exception 'country_required' using errcode = '22023';
  end if;
  if v_country = 'US' then
    v_region := upper(btrim(coalesce(p_region, v_d.region, '')));
    if not public.is_us_state(v_region) then
      raise exception 'state_required' using errcode = '22023';
    end if;
  else
    v_region := null;
  end if;

  insert into public.user_details (user_id, birth_year, age_checked_at, country, region)
  values (v_user, v_year, v_checked, v_country, v_region)
  on conflict (user_id) do update
    set birth_year = excluded.birth_year,
        age_checked_at = excluded.age_checked_at,
        country = excluded.country,
        region = excluded.region,
        updated_at = now();

  insert into public.user_agreements (user_id, version, platform)
  values (v_user, p_version, case when p_platform in ('web', 'ios', 'android') then p_platform end)
  on conflict (user_id, version) do nothing;

  select accepted_at into v_at
  from public.user_agreements
  where user_id = v_user and version = p_version;
  return jsonb_build_object('result', 'ok', 'accepted_at', v_at);
end;
$$;

revoke execute on function public.accept_terms(text, text, date, text, text) from public, anon;
grant execute on function public.accept_terms(text, text, date, text, text) to authenticated;

-- A move, from Settings. Only for someone whose age has been checked:
-- until then the place is asked for with the date of birth, above.
create or replace function public.set_my_place(p_country text, p_region text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user    uuid := auth.uid();
  v_country text := upper(btrim(coalesce(p_country, '')));
  v_region  text;
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  if v_country !~ '^[A-Z]{2}$' then
    raise exception 'country_required' using errcode = '22023';
  end if;
  if v_country = 'US' then
    v_region := upper(btrim(coalesce(p_region, '')));
    if not public.is_us_state(v_region) then
      raise exception 'state_required' using errcode = '22023';
    end if;
  end if;

  update public.user_details
  set country = v_country, region = v_region, updated_at = now()
  where user_id = v_user and age_checked_at is not null and under_age_at is null;
  if not found then
    raise exception 'details_not_ready' using errcode = 'P0001';
  end if;
end;
$$;

revoke execute on function public.set_my_place(text, text) from public, anon;
grant execute on function public.set_my_place(text, text) to authenticated;

-- ── 4. leave my words out of the totals ─────────────────────────────
-- On unless switched off, like the other Data & Coach categories
-- (20260819). Nothing reads it yet: no totals are worked out today.
-- Whatever does work them out must check it first.
alter table public.user_data_consent
  add column if not exists research boolean not null default true;

create or replace function public.has_data_consent(p_user_id uuid, p_category text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  -- Outer coalesce guarantees FALSE when the user has no consent row at all
  -- (a bare scalar subquery would return NULL there). No row = no consent.
  select coalesce((
    select case p_category
      when 'analytics'       then c.analytics
      when 'debate_analysis' then c.debate_analysis
      when 'personalization' then c.personalization
      when 'coaching'        then c.coaching
      when 'research'        then c.research
      else false
    end
    from public.user_data_consent c
    where c.user_id = p_user_id
  ), false);
$$;

-- ── 5. deleting, and downloading ────────────────────────────────────
-- Deleting an account keeps its users row, renamed, for the discussions
-- other people were in; so nothing cascades, and what is private has to
-- be removed by name. The details go. The record of having agreed
-- stays: it no longer points at a person.
--
-- The body is the live one (pg_get_functiondef, 2026-10-07) with two
-- changes: the details are deleted, and the banner and the links — which
-- were added to profiles after this function was written, and were being
-- left on deleted accounts — are cleared with the rest of the profile.
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

-- "Download what we hold" (Settings, Data & Coach) now includes what a
-- person told us about themselves and what they agreed to. The body is
-- the live one with those two keys added.
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
                        from public.user_agreements g where g.user_id = uid)
  );
end;
$function$;
