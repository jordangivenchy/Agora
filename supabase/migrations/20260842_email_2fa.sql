-- Email-based two-factor authentication (server-side rebuild).
--
-- Every table here is written ONLY by the service role from the
-- /api/auth/2fa/* routes; the sole client-visible surface is a SELECT
-- policy on user_2fa so Settings can show enrollment status. Codes are
-- stored as HMAC-SHA256 hashes — the plaintext code exists only in the
-- email Resend delivers.
--
-- The feature is dormant until RESEND_API_KEY is set (enrollment and
-- 2FA logins fail closed with a clear message while email is off).

-- ── enrollment status ────────────────────────────────────────────────
create table if not exists public.user_2fa (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  enabled     boolean not null default false,
  enrolled_at timestamptz
);

alter table public.user_2fa enable row level security;

drop policy if exists "read own 2fa status" on public.user_2fa;
create policy "read own 2fa status" on public.user_2fa
  for select using (auth.uid() = user_id);
-- no insert/update/delete policies: enrollment changes go through the
-- API routes (code-verified enable, password-verified disable)

-- ── pending challenges (login + enroll) ──────────────────────────────
create table if not exists public.two_factor_pending (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  purpose      text not null check (purpose in ('login', 'enroll')),
  code_hash    text not null,
  attempts     int  not null default 0,
  sends        int  not null default 1,
  last_sent_at timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  consumed_at  timestamptz
);

create index if not exists two_factor_pending_user_idx
  on public.two_factor_pending (user_id);
create index if not exists two_factor_pending_expires_idx
  on public.two_factor_pending (expires_at);

alter table public.two_factor_pending enable row level security;
-- no policies: service-role only

-- ── login-attempt audit for rate limiting ────────────────────────────
create table if not exists public.two_factor_attempts (
  id         bigint generated always as identity primary key,
  email      text not null,
  ip         text not null,
  created_at timestamptz not null default now()
);

create index if not exists two_factor_attempts_email_idx
  on public.two_factor_attempts (email, created_at);
create index if not exists two_factor_attempts_ip_idx
  on public.two_factor_attempts (ip, created_at);

alter table public.two_factor_attempts enable row level security;
-- no policies: service-role only

-- ── password-grant gate + auth hook (dormant until enabled) ──────────
-- Without this hook, a 2FA-enabled user's password alone still mints a
-- session at the GoTrue endpoint directly (bypassing our routes). The
-- login route opens a short-lived gate row before its own server-side
-- password check; once the hook is enabled in Dashboard → Auth → Hooks
-- (Password verification attempt → public.hook_password_verification),
-- password sign-ins for 2FA users are rejected unless that gate is open
-- — closing the bypass. Until then the hook simply never runs.
create table if not exists public.two_factor_gate (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  expires_at timestamptz not null
);

alter table public.two_factor_gate enable row level security;
-- no policies: service-role writes; supabase_auth_admin reads via the hook

create or replace function public.hook_password_verification(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid        uuid := (event->>'user_id')::uuid;
  is_enabled boolean;
  gate_open  boolean;
begin
  select u.enabled into is_enabled
  from public.user_2fa u
  where u.user_id = uid;

  if coalesce(is_enabled, false) = false then
    return jsonb_build_object('decision', 'continue');
  end if;

  select exists (
    select 1 from public.two_factor_gate g
    where g.user_id = uid and g.expires_at > now()
  ) into gate_open;

  if gate_open then
    return jsonb_build_object('decision', 'continue');
  end if;

  return jsonb_build_object(
    'decision', 'reject',
    'message',  'This account requires two-factor authentication. Sign in at agorasphere.net/login.'
  );
end;
$$;

revoke all on function public.hook_password_verification(jsonb) from public, anon, authenticated;
grant execute on function public.hook_password_verification(jsonb) to supabase_auth_admin;
grant select on table public.user_2fa, public.two_factor_gate to supabase_auth_admin;
