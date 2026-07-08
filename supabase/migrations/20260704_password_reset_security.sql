-- ============================================================
-- 20260704_password_reset_security.sql
--
-- Supporting tables for the Forgot Password flow. The reset tokens
-- themselves are NOT stored here — Supabase Auth already generates,
-- hashes, expires (1h default), and single-use-enforces recovery
-- tokens internally (auth.one_time_tokens / auth.flow_state), and it
-- owns the password hash (auth.users). Duplicating that in `public`
-- would mean maintaining parallel crypto without ever touching the
-- real password, which is a strictly worse security posture.
--
-- What THIS migration adds is what Supabase doesn't give us out of
-- the box for an app-level audit trail and per-email rate limiting:
--   1. password_reset_attempts — one row per reset *request*, used to
--      enforce "N requests per email / per IP per 15 minutes" from
--      the API route (src/app/api/auth/forgot-password/route.ts).
--   2. security_audit_log — append-only log of reset requests and
--      successful password changes. Insert-only from the API/app;
--      no SELECT grant to anon/authenticated, so a client can log
--      events but never read the log (that's a dashboard/service-role
--      job).
-- ============================================================

create table if not exists public.password_reset_attempts (
  id uuid primary key default uuid_generate_v4(),
  email text not null,
  ip text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_password_reset_attempts_email
  on public.password_reset_attempts (email, created_at);
create index if not exists idx_password_reset_attempts_ip
  on public.password_reset_attempts (ip, created_at);

-- Auto-prune: nothing needs these rows once they're outside the
-- longest rate-limit window, so a periodic cleanup keeps this table
-- from growing forever. Run manually or on a schedule; safe to skip.
create or replace function public.prune_password_reset_attempts()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.password_reset_attempts
  where created_at < now() - interval '1 day';
$$;

alter table public.password_reset_attempts enable row level security;
-- No SELECT policy for anon/authenticated: only the security-definer
-- RPC below (and the dashboard, via the service role) can read this.

-- Returns recent attempt timestamps rather than pre-computed counts so the
-- actual window/threshold decision stays in one place: the pure
-- isPasswordResetRateLimited() function in src/lib/passwordResetRateLimit.ts
-- (which is unit-tested). SQL here is just storage + a coarse 1-hour
-- prefilter — comfortably wider than either rate-limit window so the
-- app-level logic always sees the full picture.
create or replace function public.record_password_reset_attempt(
  p_email text,
  p_ip    text
)
returns table (email_attempts timestamptz[], ip_attempts timestamptz[])
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(p_email));
begin
  insert into public.password_reset_attempts (email, ip)
  values (v_email, p_ip);

  return query
    select
      (select coalesce(array_agg(created_at), '{}') from public.password_reset_attempts
        where email = v_email and created_at > now() - interval '1 hour'),
      (select coalesce(array_agg(created_at), '{}') from public.password_reset_attempts
        where ip = p_ip and created_at > now() - interval '1 hour');
end;
$$;

revoke all on function public.record_password_reset_attempt(text, text) from public;
grant execute on function public.record_password_reset_attempt(text, text) to anon, authenticated;

-- ─── Security audit log ─────────────────────────────────────────────
create table if not exists public.security_audit_log (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  metadata jsonb not null default '{}',
  ip text,
  created_at timestamptz not null default now()
);

create index if not exists idx_security_audit_log_user
  on public.security_audit_log (user_id, created_at);

alter table public.security_audit_log enable row level security;
-- Insert-only from the app; no SELECT grant — this is a write-only
-- audit trail from the client's perspective, readable via dashboard/
-- service role only.

create or replace function public.log_security_event(
  p_event_type text,
  p_metadata   jsonb default '{}',
  p_ip         text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.security_audit_log (user_id, event_type, metadata, ip)
  values (auth.uid(), p_event_type, p_metadata, p_ip);
end;
$$;

revoke all on function public.log_security_event(text, jsonb, text) from public;
grant execute on function public.log_security_event(text, jsonb, text) to anon, authenticated;
