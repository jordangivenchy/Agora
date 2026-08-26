-- Critical hardening of public.users grants (security audit, 2026-08-26).
--
-- anon/authenticated held the wide-open Supabase default GRANT ALL on
-- public.users, which meant:
--   1. Any signed-in user could PATCH their own row to is_moderator=true
--      (and verified=true, suspended_until=null, recording_storage_limit_mb
--      = huge) — the RLS UPDATE policy only checks auth.uid()=id, never the
--      columns — a full privilege escalation defeating every mod check.
--   2. anon could SELECT the email column of every user (PII harvest).
--
-- Legitimate access does NOT need these grants: every client write to
-- users goes through the SECURITY DEFINER update_profile / update_profile_extras
-- RPCs (owner-run, unaffected by grants); the users row is created by the
-- handle_new_user() signup trigger; all email reads use the service-role
-- admin client (also unaffected). Clients only READ display columns.

-- ── 1. No direct client writes to users ────────────────────────────
revoke insert, update, delete, truncate, references, trigger
  on public.users from anon, authenticated;

-- ── 2. SELECT only the safe display columns (no email, no
--       suspended_until, no recording_storage_limit_mb, no search_tsv) ──
revoke select on public.users from anon, authenticated;
grant select (
  id, username, display_name, avatar_url, bio,
  banner_url, social_links, verified, is_moderator,
  created_at, username_changed_at
) on public.users to anon, authenticated;
