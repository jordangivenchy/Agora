# Activation runbook — the three keys that finish the backend

Every code path below is already written, committed, and deployed with the
next push. Each feature activates the moment its environment variable
exists in Vercel (Project → Settings → Environment Variables → add to
Production → redeploy). Confirm activation at **`/api/health`** — the
matching flag flips to `true`.

## 1. Branded emails (Resend) — `email: true`

1. Sign up at resend.com (free tier is plenty for beta).
2. Domains → Add `agorasphere.net` → copy the DNS records it shows.
3. Add those records in Squarespace DNS (same place as the Vercel records).
4. API Keys → Create → add to Vercel as `RESEND_API_KEY`.
5. Optional: `EMAIL_FROM` (defaults to `AgoraSphere <no-reply@agorasphere.net>`).

Activates: password-changed security email, scheduled-debate reminder
email (the reminder pipeline already calls it — bell + push work today).

## 2. Personalization (PostHog) — `posthog: true`

Get from Alan: `POSTHOG_PERSONAL_API_KEY` and `POSTHOG_PROJECT_ID` → add
both to Vercel. Activates the trait-refresh cron and retrieval
personalization (code has been inert-but-ready since the AI session).

## 3. HLS egress storage (S3) — `hlsStorage: true`

LiveKit's HLS egress writes stream segments to any S3-compatible bucket.

Supabase path (no new vendor): Dashboard → Project Settings → Storage →
**S3 access keys** → generate. Add to Vercel:

- `S3_ACCESS_KEY`, `S3_SECRET_KEY`
- `S3_ENDPOINT` (shown on the same Supabase page)
- `S3_REGION` (`us-east-1` for Supabase)
- `S3_BUCKET` (create a public `hls` bucket in Storage first)

Cloudflare R2 works identically (and has free egress) if preferred.

## 4. Discord, the beta server — `discord: true`

The site posts cards into the testers' Discord: one card per public room in
#live-now, rewritten as the room goes scheduled → live → ended → recorded;
a recording landing (#past-discussions); a post featured on the home page and
every production deploy (#announcements); and a morning digest of new bugs and
feedback for the team (#team). It also answers the "Get my beta key" button
and the `/beta` command with the invite code, for that person's eyes only.

**The key.** Testers never see the master code. The button (or `/beta`) mints
a one-time key for their Discord account (`beta_keys`, migration
`20260907_beta_keys`): it works once, on one device, dies after 48 hours
unused, and a person gets `BETA_KEYS_PER_TESTER` (default 3) in all. To cut
someone off: `update beta_keys set revoked_at = now() where discord_user_id = '…'`
(their passes run out within 30 days; suspending the account is immediate).
Rotating `BETA_INVITE_CODE` still ends every pass at once.

The database raises the room and post events (migrations `20260905_discord_notify`
and `20260906_discord_cards`, trigger → pg_net → `/api/internal/discord`).
Vercel raises deploys (`/api/webhook/vercel`). A cron writes the digest
(`/api/cron/discord-digest`, 14:00 UTC). Discord posts button presses and
commands to `/api/webhook/discord`. Nothing posts until the variables exist.

The quick way to build the server: make the empty server, invite a bot with
Administrator (scopes `bot` and `applications.commands`), and run
`node scripts/discord-setup.mjs` (the notes at the top of the file walk through
the bot token and server id). It builds the channels, roles, permissions,
Community mode, rules screening, welcome screen, onboarding, AutoMod, the
pinned cards, the command and the webhooks, and writes the values for step 1
to `.env.discord.local`. Safe to run again.

1. Add to Vercel (Production):
   - `DISCORD_WEBHOOK_LIVE`, `DISCORD_WEBHOOK_RECORDINGS`,
     `DISCORD_WEBHOOK_ANNOUNCEMENTS` — the webhook URLs (by hand: channel →
     Edit channel → Integrations → Webhooks → New webhook → Copy webhook URL).
     One channel for everything: set only `DISCORD_WEBHOOK_URL`.
   - `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID` — for the digest (`discordBot`).
   - `DISCORD_PUBLIC_KEY` — Developer Portal → General Information → Public Key,
     for the key button and `/beta` (`discordInteractions`).
   - `VERCEL_WEBHOOK_SECRET` — Team Settings → Webhooks → Create → event
     "Deployment Succeeded" → URL `https://agorasphere.net/api/webhook/vercel`
     → the secret it shows (`vercelWebhook`).
2. Redeploy, then `/api/health` → `discord: true` and the three flags above.
3. Developer Portal → General Information → **Interactions Endpoint URL** →
   `https://agorasphere.net/api/webhook/discord` → Save. Discord pings the
   route to check it; it only passes once step 2 is live.
4. Prove a webhook from a terminal (the URL is the secret — keep it out of
   chats and commits):

   ```bash
   curl -sS -X POST "$DISCORD_WEBHOOK_LIVE" -H 'Content-Type: application/json' \
     -d '{"username":"AgoraSphere","content":"Webhook connected."}'
   ```

The bot's avatar and the tile on every card is `public/mark-512.png`,
fetched by Discord from the production origin (PNGs bypass the beta gate).

## Also worth setting while you're in there

- `CRON_SECRET` — any long random string; Vercel then authenticates its
  own cron calls to `/api/cron/refresh-traits` and `/api/cron/maintenance`
  (both currently 503 without it).
