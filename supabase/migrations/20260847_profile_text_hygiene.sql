-- ============================================================
-- 20260847_profile_text_hygiene.sql
--
-- Profile text normalization + blocklist, enforced server-side.
-- Mirrors src/lib/profileText.ts — keep the two in sync.
--
--   1. public.blocked_terms — moderator-extendable list of slurs /
--      hard profanity. RLS on, no policies: only definer functions
--      (and service_role) can read it.
--   2. normalize_profile_text(text, multiline) — NFC, strip
--      control / zero-width / bidi characters, collapse whitespace
--      (single-line: all runs → one space; multiline: spaces within
--      lines, trailing spaces, 3+ newlines → 2), trim.
--   3. text_has_blocked_term(text) — folds leetspeak / diacritics /
--      spaced-out letters, then matches every blocked term on word
--      boundaries (\m … \M) so "assistant" / "class" never trip it.
--   4. update_profile / update_profile_extras — same signatures and
--      behavior as before, plus normalization, display_name ≤ 40,
--      bio ≤ 300, and `blocked_term` (errcode 22023) on a hit.
--      Username cooldown / uniqueness / format logic is unchanged.
--   5. One-time backfill: normalize existing display_name / bio
--      (no blocklist enforcement on historical rows).
--
-- Idempotent: safe to re-run.
-- ============================================================

-- ─── 1. blocked_terms ────────────────────────────────────────
create table if not exists public.blocked_terms (
  term       text primary key,
  created_at timestamptz not null default now()
);

alter table public.blocked_terms enable row level security;
-- No policies on purpose: nobody reads this via PostgREST. The definer
-- functions below bypass RLS; service_role bypasses it too.
revoke all on table public.blocked_terms from public, anon, authenticated;

insert into public.blocked_terms (term) values
  -- racial / ethnic
  ('nigger'), ('nigga'), ('niggers'), ('niggas'),
  ('chink'), ('chinks'), ('gook'), ('gooks'), ('spic'), ('spics'),
  ('wetback'), ('wetbacks'), ('kike'), ('kikes'),
  ('raghead'), ('ragheads'), ('towelhead'), ('towelheads'),
  ('beaner'), ('beaners'), ('darkie'), ('darkies'),
  ('paki'), ('pakis'), ('zipperhead'), ('porchmonkey'), ('jigaboo'), ('sandnigger'),
  -- homophobic / transphobic
  ('faggot'), ('faggots'), ('dyke'), ('dykes'),
  ('tranny'), ('trannies'), ('shemale'), ('shemales'),
  -- ableist
  ('retard'), ('retards'), ('retarded'), ('spaz'), ('mongoloid'),
  -- hard profanity
  ('fuck'), ('fucks'), ('fucker'), ('fuckers'), ('fucking'),
  ('motherfucker'), ('motherfuckers'),
  ('cunt'), ('cunts'), ('cocksucker'), ('cocksuckers')
on conflict (term) do nothing;

-- ─── 2. normalize_profile_text ───────────────────────────────
create or replace function public.normalize_profile_text(p_text text, p_multiline boolean default false)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v text := p_text;
begin
  if v is null then
    return null;
  end if;
  v := normalize(v, NFC);
  -- C0 (minus \t \n \r) + DEL/C1 + zero-width + line/para sep + bidi/format + BOM
  v := regexp_replace(
    v,
    '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF]',
    '', 'g'
  );
  if p_multiline then
    v := regexp_replace(v, E'\r\n?', E'\n', 'g');
    v := regexp_replace(v, '[ \t]+', ' ', 'g');             -- spaces/tabs within lines
    v := regexp_replace(v, E' +\n', E'\n', 'g');           -- trailing spaces on lines
    v := regexp_replace(v, E'\n{3,}', E'\n\n', 'g');       -- max one blank line
  else
    v := regexp_replace(v, '\s+', ' ', 'g');
  end if;
  return btrim(v, E' \t\n\r');
end;
$$;

-- ─── 3. text_has_blocked_term ────────────────────────────────
create or replace function public.text_has_blocked_term(p_text text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v text;
  r record;
begin
  if p_text is null or p_text = '' then
    return false;
  end if;
  -- fold: NFKD + strip combining marks, lowercase, leetspeak → letters
  v := lower(regexp_replace(normalize(p_text, NFKD), '[\u0300-\u036F]', '', 'g'));
  v := translate(v, '0134578@$!|+', 'oieastbasilt');
  -- collapse runs of single letters split by separators ("f u c k",
  -- "f.u.c.k") but leave real words alone ("class hole" stays).
  for r in
    select distinct m[1] as run
      from regexp_matches(v, '(?<![a-z])([a-z](?:[\s._*-]+[a-z](?![a-z]))+)', 'g') as m
  loop
    v := replace(v, r.run, regexp_replace(r.run, '[\s._*-]+', '', 'g'));
  end loop;

  return exists (
    select 1 from public.blocked_terms b
    where v ~ ('(^|[^a-z])' || b.term || '([^a-z]|$)')
  );
end;
$$;

revoke all on function public.normalize_profile_text(text, boolean) from public, anon;
revoke all on function public.text_has_blocked_term(text) from public, anon;
grant execute on function public.normalize_profile_text(text, boolean) to authenticated;
grant execute on function public.text_has_blocked_term(text) to authenticated;

-- ─── 4a. update_profile (same signature as 20260701) ─────────
create or replace function public.update_profile(
  p_username     text,
  p_avatar_url   text,
  p_bio          text,
  p_display_name text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me         uuid := auth.uid();
  v_clean      text;
  v_current    text;
  v_changed_at timestamptz;
  v_created    timestamptz;
  v_display    text;
  v_bio        text;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select username, username_changed_at, created_at
    into v_current, v_changed_at, v_created
  from public.users
  where id = v_me;

  -- Username: weekly cooldown, uniqueness, format.
  if p_username is not null then
    v_clean := lower(trim(p_username));
    if v_clean !~ '^[a-z0-9_]{3,20}$' then
      raise exception 'invalid_username'
        using errcode = '22023',
              message = 'Username must be 3-20 chars: lowercase letters, numbers, or underscores.';
    end if;

    if v_clean <> lower(coalesce(v_current, '')) then
      if public.text_has_blocked_term(v_clean) then
        raise exception 'blocked_term'
          using errcode = '22023',
                message = 'blocked_term: username contains a blocked term.';
      end if;

      if v_created < now() - interval '1 hour'
         and v_changed_at is not null
         and v_changed_at > now() - interval '7 days' then
        raise exception 'username_cooldown'
          using errcode = 'P0001',
                message = 'You can only change your username once every 7 days.';
      end if;

      if exists (
        select 1 from public.users
        where lower(username) = v_clean and id <> v_me
      ) then
        raise exception 'username_taken'
          using errcode = 'P0001',
                message = 'That username is already taken.';
      end if;

      update public.users
         set username = v_clean,
             username_changed_at = now()
       where id = v_me;
    end if;
  end if;

  -- Display name: changeable anytime; empty string clears it.
  if p_display_name is not null then
    v_display := public.normalize_profile_text(p_display_name, false);
    if length(v_display) > 40 then
      raise exception 'display_name_too_long'
        using errcode = '22023',
              message = 'display_name_too_long: Display name must be 40 characters or fewer.';
    end if;
    if public.text_has_blocked_term(v_display) then
      raise exception 'blocked_term'
        using errcode = '22023',
              message = 'blocked_term: display name contains a blocked term.';
    end if;
    update public.users
       set display_name = nullif(v_display, '')
     where id = v_me;
  end if;

  -- Bio: null = leave unchanged, empty string = clear.
  if p_bio is not null then
    v_bio := public.normalize_profile_text(p_bio, true);
    if length(v_bio) > 300 then
      raise exception 'bio_too_long'
        using errcode = '22023',
              message = 'bio_too_long: Bio must be 300 characters or fewer.';
    end if;
    if public.text_has_blocked_term(v_bio) then
      raise exception 'blocked_term'
        using errcode = '22023',
              message = 'blocked_term: bio contains a blocked term.';
    end if;
  end if;

  -- Avatar / bio: null = leave unchanged, empty string = clear.
  update public.users
     set avatar_url = case when p_avatar_url is null then avatar_url
                           else nullif(p_avatar_url, '') end,
         bio        = case when p_bio is null then bio
                           else nullif(v_bio, '') end,
         updated_at = now()
   where id = v_me;
end;
$$;

revoke all on function public.update_profile(text, text, text, text) from public, anon;
grant execute on function public.update_profile(text, text, text, text) to authenticated;

-- ─── 4b. update_profile_extras (same signature as 20260843) ──
-- Only banner_url + social_links are text here; links are URLs, so
-- they get the control/zero-width strip (single-line normalize) but
-- no blocklist — a URL path is not prose.
create or replace function public.update_profile_extras(
  p_banner_url   text,
  p_social_links jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me    uuid := auth.uid();
  v_clean jsonb;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if p_banner_url is not null then
    if char_length(p_banner_url) > 500 then
      raise exception 'banner_url_too_long' using errcode = '22023';
    end if;
    update public.users
       set banner_url = nullif(public.normalize_profile_text(p_banner_url, false), '')
     where id = v_me;
  end if;

  if p_social_links is not null then
    if jsonb_typeof(p_social_links) <> 'array' then
      raise exception 'social_links_not_array' using errcode = '22023';
    end if;
    if jsonb_array_length(p_social_links) > 5 then
      raise exception 'too_many_links' using errcode = '22023';
    end if;
    if exists (
      select 1 from jsonb_array_elements(p_social_links) e
      where jsonb_typeof(e.value) <> 'string'
         or char_length(public.normalize_profile_text(e.value #>> '{}', false)) not between 1 and 200
         or public.normalize_profile_text(e.value #>> '{}', false) !~ '^https?://'
    ) then
      raise exception 'invalid_link' using errcode = '22023';
    end if;

    -- store the normalized form so the client renders exactly what passed
    select coalesce(jsonb_agg(to_jsonb(public.normalize_profile_text(e.value #>> '{}', false))), '[]'::jsonb)
      into v_clean
      from jsonb_array_elements(p_social_links) e;

    update public.users set social_links = v_clean where id = v_me;
  end if;
end;
$$;

revoke all on function public.update_profile_extras(text, jsonb) from public, anon;
grant execute on function public.update_profile_extras(text, jsonb) to authenticated;

-- ─── 5. backfill (normalize only; no blocklist on history) ───
update public.users
   set display_name = nullif(left(public.normalize_profile_text(display_name, false), 40), '')
 where display_name is not null
   and display_name is distinct from nullif(left(public.normalize_profile_text(display_name, false), 40), '');

update public.users
   set bio = nullif(left(public.normalize_profile_text(bio, true), 300), '')
 where bio is not null
   and bio is distinct from nullif(left(public.normalize_profile_text(bio, true), 300), '');
