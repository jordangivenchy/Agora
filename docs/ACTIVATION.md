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

The site posts three kinds of card into the testers' Discord: a public
room going live (#live-now), a recording landing (#past-discussions), and
a post featured on the home page (#announcements). The database raises
each event (migration `20260905_discord_notify`, trigger → pg_net →
`/api/internal/discord`); the route re-reads the row and posts to the
channel's webhook. Nothing posts until a webhook is set.

1. In Discord, for each channel: Edit channel → Integrations → Webhooks →
   New webhook → name it `AgoraSphere` → Copy webhook URL.
2. Add to Vercel: `DISCORD_WEBHOOK_LIVE`, `DISCORD_WEBHOOK_RECORDINGS`,
   `DISCORD_WEBHOOK_ANNOUNCEMENTS`. One channel for everything: set only
   `DISCORD_WEBHOOK_URL` (it is the fallback for all three).
3. Redeploy, then `/api/health` → `discord: true`.
4. Prove a webhook from a terminal (the URL is the secret — keep it out of
   chats and commits):

   ```bash
   curl -sS -X POST "$DISCORD_WEBHOOK_LIVE" -H 'Content-Type: application/json' \
     -d '{"username":"AgoraSphere","content":"Webhook connected."}'
   ```

The bot's avatar is `public/mark-512.png`, fetched by Discord from the
production origin (PNGs bypass the beta gate).

## Also worth setting while you're in there

- `CRON_SECRET` — any long random string; Vercel then authenticates its
  own cron calls to `/api/cron/refresh-traits` and `/api/cron/maintenance`
  (both currently 503 without it).
