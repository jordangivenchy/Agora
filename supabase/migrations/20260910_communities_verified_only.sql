-- ─── Communities: verified accounts only, for now ────────────────────
-- During the beta a community may only be created by a verified account
-- (users.verified). Site moderators pass. Same guard as 20260889: the
-- status function tells the client before it shows the form, and the
-- insert trigger refuses with the same code:
--   not_verified
-- Order of checks: signed out, email unverified, not verified, account
-- too new, community limit.

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
  v_verified  boolean := false;
  v_reason    text := null;
begin
  if v_me is null then
    return jsonb_build_object('allowed', false, 'reason', 'signed_out', 'count', 0, 'cap', v_cap);
  end if;
  select email_confirmed_at, created_at into v_confirmed, v_created from auth.users where id = v_me;
  select coalesce(is_moderator, false), coalesce(verified, false) into v_mod, v_verified from public.users where id = v_me;
  select count(*) into v_count from public.communities where created_by = v_me;
  if v_confirmed is null then
    v_reason := 'email_unverified';
  elsif not v_mod and not v_verified then
    v_reason := 'not_verified';
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
