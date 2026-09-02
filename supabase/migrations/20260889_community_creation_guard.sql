-- Community creation guard: a small per-account cap plus two account
-- checks, enforced in the database so they hold for every client.
--   - a verified email        (auth.users.email_confirmed_at)
--   - an account a day old    (auth.users.created_at)
--   - at most 3 communities created per account
-- Site moderators (users.is_moderator) skip the age check and the cap;
-- nobody skips the email check. community_creation_status() tells the
-- client which rule applies before it shows the form; the trigger
-- refuses inserts with the same codes:
--   email_unverified | account_too_new | community_limit

create or replace function public.community_creation_status()
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_me        uuid := auth.uid();
  v_cap       int  := 3;
  v_count     int  := 0;
  v_confirmed timestamptz;
  v_created   timestamptz;
  v_mod       boolean := false;
  v_reason    text := null;
begin
  if v_me is null then
    return jsonb_build_object('allowed', false, 'reason', 'signed_out', 'count', 0, 'cap', v_cap);
  end if;
  select email_confirmed_at, created_at into v_confirmed, v_created from auth.users where id = v_me;
  select coalesce(is_moderator, false) into v_mod from public.users where id = v_me;
  select count(*) into v_count from public.communities where created_by = v_me;
  if v_confirmed is null then
    v_reason := 'email_unverified';
  elsif not v_mod and v_created > now() - interval '1 day' then
    v_reason := 'account_too_new';
  elsif not v_mod and v_count >= v_cap then
    v_reason := 'community_limit';
  end if;
  return jsonb_build_object(
    'allowed', v_reason is null,
    'reason', v_reason,
    'count', v_count,
    'cap', case when v_mod then null else v_cap end,
    'account_age_hours', floor(extract(epoch from (now() - v_created)) / 3600)
  );
end;
$$;
revoke all on function public.community_creation_status() from public, anon;
grant execute on function public.community_creation_status() to authenticated;

create or replace function public.community_creation_guard()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_status jsonb;
begin
  -- Owner / service-role inserts (seeds, admin tooling) are not gated.
  if auth.uid() is null then return new; end if;
  if new.created_by is distinct from auth.uid() then
    raise exception 'created_by_mismatch' using errcode = '42501';
  end if;
  v_status := public.community_creation_status();
  if not (v_status->>'allowed')::boolean then
    raise exception '%', v_status->>'reason' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists community_creation_guard on public.communities;
create trigger community_creation_guard
  before insert on public.communities
  for each row execute function public.community_creation_guard();
