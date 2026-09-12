-- ─── One-time beta keys ───────────────────────────────────────────────
-- The shared invite code let anyone forward it. Now the "Get my beta
-- key" button in Discord mints a key per Discord account (lib/betaKeys);
-- a key is spent the moment it is redeemed at /beta, dies after 48
-- hours unused, and a person gets a few in all (one per device). Keys
-- are stored hashed. The master code keeps working for the team.
--
-- Revoke a person:  update public.beta_keys set revoked_at = now()
--                   where discord_user_id = '<discord id>';

create table if not exists public.beta_keys (
  id uuid primary key default gen_random_uuid(),
  key_hash text not null unique,
  discord_user_id text not null,
  discord_username text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  redeemed_at timestamptz,
  revoked_at timestamptz
);

create index if not exists beta_keys_discord_user_idx on public.beta_keys (discord_user_id);

-- Server-only: RLS on with no policies, so only the service role reads or writes.
alter table public.beta_keys enable row level security;
revoke all on table public.beta_keys from public, anon, authenticated;
