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

## Also worth setting while you're in there

- `CRON_SECRET` — any long random string; Vercel then authenticates its
  own cron calls to `/api/cron/refresh-traits` and `/api/cron/maintenance`
  (both currently 503 without it).
