-- 2FA enforcement via the Custom Access Token hook (Free-plan).
--
-- The Password Verification Attempt hook (public.hook_password_verification,
-- migration 20260842) turned out to be gated behind Supabase's Team plan, so
-- GoTrue never calls it. This hook closes the same hole from the token side:
-- it runs on EVERY token issuance, and refuses to mint a token for a
-- password-grant sign-in when the account is 2FA-enrolled — unless the
-- short-lived two_factor_gate is open (our own server-side password checks
-- in /api/auth/2fa/* and /api/auth/reauth open it around the check).
--
-- Every other authentication_method passes through untouched:
--   token_refresh          — session refreshes keep working
--   magiclink / otp        — the post-2FA-verify session mint
--   oauth                  — provider auth is its own factor
--   recovery / email/signup / etc.
--
-- Wire-up (dashboard): Authentication → Hooks → Customize Access Token (JWT)
-- Claims → Postgres function → public.hook_custom_access_token.

create or replace function public.hook_custom_access_token(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid        uuid;
  is_enabled boolean;
  gate_open  boolean;
begin
  -- Only password-grant issuance is guarded.
  if (event->>'authentication_method') is distinct from 'password' then
    return jsonb_build_object('claims', event->'claims');
  end if;

  uid := (event->>'user_id')::uuid;

  select u.enabled into is_enabled
  from public.user_2fa u
  where u.user_id = uid;

  if coalesce(is_enabled, false) = false then
    return jsonb_build_object('claims', event->'claims');
  end if;

  select exists (
    select 1 from public.two_factor_gate g
    where g.user_id = uid and g.expires_at > now()
  ) into gate_open;

  if gate_open then
    return jsonb_build_object('claims', event->'claims');
  end if;

  return jsonb_build_object(
    'error', jsonb_build_object(
      'http_code', 403,
      'message',   'This account requires two-factor authentication. Sign in at agorasphere.net/login.'
    )
  );
exception
  -- This hook sits in the critical path of every sign-in; an unexpected
  -- error must not lock the whole site out. Fail open with the original
  -- claims (a 2FA-enrolled attacker gains nothing from a healthy DB).
  when others then
    return jsonb_build_object('claims', event->'claims');
end;
$$;

grant execute on function public.hook_custom_access_token to supabase_auth_admin;
revoke execute on function public.hook_custom_access_token from authenticated, anon, public;
