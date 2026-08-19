# AgoraSphere — Context Handoff

_Last updated: 2026-08-19 (evening). Covers the marathon sessions of 08-17 → 08-19:
backend hardening, reminder delivery, display names, thumbnails, search, the
Marble Agora merge, and the stage-behavior polish. Everything below is LIVE in
production unless marked otherwise._

## What this is

AgoraSphere: a live debate/discussion platform — Next.js 16 (App Router) + Supabase
(Postgres/auth/realtime) + LiveKit (voice/video/egress) + a Three.js amphitheater
with a DOM video stage. **Live at https://agorasphere.net — closed beta.**

## Production infrastructure

| Piece | Where | Notes |
|---|---|---|
| Hosting | Vercel `agorasphere` (account `jordangivenchy`) | **Auto-deploys on every push to `main`** |
| Domain | agorasphere.net (Squarespace DNS) | Apex A → 216.198.79.1, www CNAME → Vercel |
| Database | Supabase ref `unedjtgfayhdisopwywz` | Postgres 17, us-east-1 |
| Voice/video | LiveKit Cloud `wss://agora-8q35ahbv.livekit.cloud` | Tokens at `/api/livekit` (identity is server-verified now); egress at `/api/egress` |
| HLS storage | Cloudflare R2 bucket `agora-hls` (account Orbitfrench117@gmail.com, id 5d7e142e56f40f38afe5c0e064bd95e8) | Bucket exists; **env vars not yet in Vercel** — see Activation |
| Beta gate | `BETA_INVITE_CODE` env (Vercel), currently `agora-beta-2026` | Pass = 30-day cookie keyed to code hash. `/api/health`, `/api/cron/*`, `/api/webhook`, `/api/beta`, `/auth`, and `/agora/*?token&url` (egress compositor) are exempt |
| Emails | Supabase built-in mailer (unbranded) | Resend path fully coded, awaiting `RESEND_API_KEY` |

**Health check:** `GET https://agorasphere.net/api/health` (no auth) returns booleans:
`supabaseAdmin, livekit, email, posthog, hlsStorage, webPush, cron`. As of writing:
first two + webPush true, rest false. This is the activation scoreboard.

## Activation checklist (the only blocked work)

All code paths are deployed and dormant behind env vars (Vercel → agorasphere →
Settings → Environment Variables → Production, then Redeploy):

1. **HLS** — bucket `agora-hls` exists on R2. Jordan created an API token (Object
   R/W, bucket-scoped). Needs pasted: `HLS_S3_BUCKET=agora-hls`, `HLS_S3_REGION=auto`,
   `HLS_S3_ENDPOINT=https://5d7e142e56f40f38afe5c0e064bd95e8.r2.cloudflarestorage.com`,
   `HLS_S3_ACCESS_KEY`, `HLS_S3_SECRET`, `HLS_PUBLIC_BASE_URL` (enable r2.dev public
   URL on the bucket). ⚠️ An R2 key pair was pasted into a Claude chat on 08-19 —
   **rotate that token after activation**. Also add an R2 lifecycle rule (delete
   segments >24h) before regular streaming.
2. **Email** — Resend account + domain DNS (Squarespace) + `RESEND_API_KEY`,
   `EMAIL_FROM`. Unlocks debate-reminder + password-changed emails (`src/lib/email.ts`).
3. **PostHog** — from Alan: `POSTHOG_PERSONAL_API_KEY`, `POSTHOG_PROJECT_ID`,
   `NEXT_PUBLIC_POSTHOG_KEY`. Unlocks trait cron + personalization.
4. **`CRON_SECRET`** — any random string; without it the two daily Vercel crons
   (refresh-traits 6:00, maintenance 6:30) return 503.

## Critical operational facts

- **DB migration drift**: live DB is applied by hand/MCP; files through `20260834`
  ARE applied (incl. display-name RPCs, trgm indexes, DM rate limit, ghost-seat
  sweep, trusted presence, reminder delivery, grant audit). When something 42703s,
  check the live DB first.
- **`public.app_config` table** (RLS on, no policies → service-role only) holds:
  `reminder_webhook_secret`, `vapid_public_key`, `vapid_private_key`,
  `vapid_subject`, `app_origin`. Web push works with NO Vercel env at all.
- **pg_cron jobs live in the DB**: `room-reminders` every 2 min (bell inserts +
  pg_net webhook to `/api/cron/reminders`). pg_net + pg_trgm extensions enabled.
- **Secrets hygiene ledger**: Twitch stream key (08-16, LyricalVAL) — still needs
  rotation. R2 token pair (08-19, chat) — rotate after HLS activation. A password
  "fener1907" was pasted in chat 08-19 — burned, change it wherever it's real.
- **Moderators**: `jordan`, `jordan1` (`users.is_moderator`). Verified badges via
  profile-page toggle (`set_user_verified`, now revoked from anon).
- Room cleanup habit: `update debate_rooms set status='ended', ended_at=now() where
  status='live' or (status in ('created','scheduled') and (scheduled_start is null
  or scheduled_start < now()));` spares future-scheduled rooms. (Ghost seats now
  self-clean; egress on ended rooms auto-stops.)

## What shipped 08-17 → 08-19 (all deployed)

**Backend hardening**
- `/api/livekit`: identity from the Supabase cookie session (spoof-proof), display
  name from DB, guests subscribe-only, **scheduled rooms 403 until start−30min**
  (host exempt), opportunistic `sweep_ghost_seats()` on every mint.
- Trusted presence: `user_presence` table written only via `touch_presence()`
  (auth.uid), 45s heartbeat / 90s staleness in `src/lib/presence.ts`. ⚠️ Change
  events fan out N²-ish; soften (longer beat / Pro tier) before opening the gate.
- Ghost seats: `debate_participants.last_seen_at` + `touch_seat` (both room pages,
  60s) + sweep (token mints, daily cron). DM rate limit trigger (20/min).
- Grant audit done: anon revoked from `raise_hand`, `advance_speaker_queue`,
  `step_down_from_mic`, `set_user_verified`, maintenance fns.
- Display names in all social RPCs (+ `get_community_post` for search deep-links);
  clients consume them; `displayName()` helper in `src/lib/names.ts` is the
  convention — display name renders, @handle plumbs (menus, URLs).
- Reminder delivery: bell (pure-DB, live), email + web push via
  `/api/cron/reminders` (Bearer secret from app_config). Push is end-to-end live:
  VAPID in app_config, `push_subscriptions`, `public/push-sw.js`, toggle at the
  bottom of the notifications bell.
- `/api/cron/maintenance` (daily): ghost sweep, Google-avatar self-hosting into
  the avatars bucket, kills egress on ended rooms, clears stale `hls_url`.
- Host leaving **always** closes the stage (back arrow routes through the same
  confirm; classic page already did this). Close also fires egress `stop_all`.

**Features**
- Room thumbnails: `debate_rooms.thumbnail_url` + `thumbnails` bucket (per-user
  folders); picker in CreateRoomModal (`src/lib/thumbs.ts` square-crops to webp),
  changer in Host Controls; cards fall back to host avatar.
- Search: nav bar now actually opens the discovery overlay (it was never wired!);
  React sections (ROOMS/PEOPLE/COMMUNITY POSTS) via `DiscoverySearch.tsx` portaled
  into `#discoverySocial`, event-bridged from `mvp-home.js`; trgm indexes back the
  ilike queries; post rows deep-link into the Communities detail view.
- Homepage: charcoal theme (navy purged), compact 178px sidebar, Browse row is a
  50/50 split — popular rooms left, scheduled squares right (empty topics show a
  dashed "Schedule a debate" invitation that opens the create modal with
  `initialSchedule`), queue topics in a two-column grid below.
- HLS viewer/host UI (dormant until env): Host Controls toggle appears when
  configured; audience gets a "watch the stream" button + `HlsPlayer`.

**Merges (all in main)**
- Josh's **Marble Agora** (`agora-stage-redesign`): liquid-glass UI, filmic
  rendering, lantern ring, **DOM video stage** (`AgoraStage.tsx` — video left
  WebGL entirely), **screen sharing**, click-to-pin focus, new control bar
  (supersedes the icon set from 08-17). Display-name/handle split threaded through
  his pane types; `performanceMode` (egress floor) re-threaded.
- Alan's **live listening** (`alan/dev`): transcripts (`/api/agora/transcript`),
  claim detection, personas, ambient assistant orb + TTS (kokoro-js). His
  `20260816_live_listening.sql` was already applied live.

**Stage behavior rules (tuned with Jordan 08-19)**
- Panes are **speaker-view only**; audience vantage never shows them — all live
  pictures (cameras AND shares) ride the small dock tiles there.
- In speaker view the stage waits for the camera glide to land among the stars:
  scene fires `onViewSettled` (arrival = within 0.5 units; latch clears on every
  view CHANGE — keyed-on-arrival latching broke quick round-trips); entrance is a
  pure 0.7s opacity fade, deliberately screen-locked (no translate/scale).
- Scene perf: verdict = fine (instanced crowd, one shadow light, adaptive
  step-down, DOM video). Revisit only on real low-end reports.
- ⚠️ rAF pauses in hidden tabs — automated checks of scene behavior from a hidden
  Browser pane silently freeze the camera; front the tab or test by hand.

## Test/verify conventions

`npm test` (vitest, **81** tests) and `npx tsc --noEmit` stay green (delete
`.next/dev` if tsc chokes on a half-written generated file). `npm run build`
before pushing. Health endpoint after deploys. Signed-in flows still need a real
login — Claude cannot enter passwords; have Jordan log into the Browser pane and
drive from there.

## Known gaps / next steps

1. Activation checklist above (HLS paste → verify end-to-end, Resend, PostHog, CRON_SECRET).
2. Quality backlog from the homepage critique: hero carousel ranks/hides dead
   rooms; drop the repeated "quiet" pills; move Create out of the search bar;
   tighten queue cards; retire the floating N logo.
3. Icon sweep: ~45 emoji-as-UI sites remain (UserContextMenu is the big cluster);
   `controlIcons.tsx` unused since the Marble bar — reuse or fold in.
4. Per-viewer focus v2 on Josh's click-to-pin: dynamic slot layouts (>4 speakers →
   second row → grid), active-speaker auto-focus, per-track simulcast quality
   switching (HIGH for pinned, LOW thumbnails).
5. Presence fan-out softening before open beta (see hardening note).
6. Big rocks discussed: recordings/VOD pipeline (egress → R2 → replay page →
   clips), AI judging (transcripts exist now via Alan's work — scoring/fact-check
   jobs + queue), ranked/ELO, CI (GitHub Actions build+test; fix Preview env vars),
   moderation automation, Stripe.

## Access notes (this machine)

Git + `gh` as `jordangivenchy`; Vercel via `npx vercel` (MCP connector 403s on
deployments — CLI works); Supabase MCP connected; Cloudflare MCP connector
available (R2 bucket CRUD — cannot mint S3 keys or toggle public access).
Branches: `jordan/dev` mirrors main; `agora-stage-redesign` + `alan/dev` merged;
stale `Jordan` branch deleted (was fully merged). Alan (miroalan) and Josh
(joshuaabdala) have push access; their pushes auto-deploy.
