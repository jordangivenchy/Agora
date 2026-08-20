# AgoraSphere — Context Handoff

_Last updated: 2026-08-20 (night). Covers the 08-20 marathon: Communities
v2→v3 (the full Reddit-shaped forum build-out), deployed to production the
same day. Everything below is LIVE in production unless marked otherwise._

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
| Voice/video | LiveKit Cloud `wss://agora-8q35ahbv.livekit.cloud` | Tokens at `/api/livekit` (identity server-verified); egress at `/api/egress` |
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
5. **GIPHY** (new 08-20) — `NEXT_PUBLIC_GIPHY_KEY` (free key, developers.giphy.com,
   JS/React SDK type; the key is public-by-design, browser calls GIPHY directly).
   Unlocks the GIF picker in the community post/comment composers
   (`src/components/community/GifPicker.tsx`); buttons don't render without it.
   Jordan was mid-signup on 08-20 — check whether the Vercel var landed.

## Critical operational facts

- **DB migration drift**: live DB is applied by hand/MCP; files through `20260841`
  ARE applied (communities v2/v3/hardening/branding/mentions+pins/moderation/
  pagination all landed 08-20 via MCP, matching the repo files exactly). When
  something 42703s, check the live DB first.
- **`public.app_config` table** (RLS on, no policies → service-role only) holds:
  `reminder_webhook_secret`, `vapid_public_key`, `vapid_private_key`,
  `vapid_subject`, `app_origin`. Web push works with NO Vercel env at all.
- **pg_cron jobs live in the DB**: `room-reminders` every 2 min (bell inserts +
  pg_net webhook to `/api/cron/reminders`). pg_net + pg_trgm extensions enabled.
- **Secrets hygiene ledger**: Twitch stream key (08-16, LyricalVAL) — still needs
  rotation. R2 token pair (08-19, chat) — rotate after HLS activation. A password
  "fener1907" was pasted in chat 08-19 — burned, change it wherever it's real.
- **Moderators**: `jordan`, `jordan1` (`users.is_moderator` — SITE mods).
  Communities have their own per-board roles in `community_members.role`
  (owner/moderator/member) — unrelated to site mods.
- Room cleanup habit: `update debate_rooms set status='ended', ended_at=now() where
  status='live' or (status in ('created','scheduled') and (scheduled_start is null
  or scheduled_start < now()));` spares future-scheduled rooms. (Ghost seats
  self-clean; egress on ended rooms auto-stops.)
- **Demo/seed data from 08-20** (deletable via UI, harmless): "Debate Club"
  community (owner jordan, custom banner/avatar, long description, rules), a
  repost of the Agora post into it, a pinned image comment + formatting-demo
  comment on the Agora post, and Agora's official description + 7 rules.

## What shipped 08-20 (Communities v2→v3 — all deployed + DB live)

**The forum.** `CommunitiesPage.tsx` (~2,900 lines) is now a full Reddit-shaped
board system, themed to the homepage's v5 charcoal glass:
- Public/**private** communities (join via `request_to_join` + mod approval);
  privacy enforced in RLS *and* inside every definer feed RPC (`community_visible`).
- **Wilson-score "Best" sort** (`wilson_lower_bound`, z=1.96) as default, plus
  New/Top; feed pagination via `p_offset` ("Load more").
- Posts: images (GIF files upload un-re-encoded so they **loop**), one mod-created
  **tag** per post (trigger-validated), **reposts** (`repost_post` RPC; private
  sources refused at RPC *and* trigger level; embeds privacy-gated at read time),
  share deep links (`/?post=<id>` — handled in page.tsx, no nav-click race),
  mod **post pins** (lead their board only, not the All feed).
- Comments: true threading, images/GIFs, votes, mod **comment pins**.
- **@mentions**: autocomplete popover (`search_mention_users`), blue links to
  `/users/<name>`, trigger-driven `mention` notifications (cap 5/item, deduped
  1h, `community_visible`-gated).
- **Markdown-lite**: `**bold**`, `*italic*`, `~~strike~~`, `` `code` ``,
  auto-linked URLs; B/I/S/<> toolbar wraps selection in the post composer.
- **Moderation**: member list with live presence pills (reads `user_presence`
  store), **bans** (`ban_community_member` — enforced across posts/comments/
  joins/votes via restrictive RLS + RPC guards), **mod log**
  (`community_mod_log`, written by every mod RPC via `log_mod_action`),
  per-community **mutes** (`community_mutes`, honored by both notify triggers),
  rules editor, banner/avatar branding via hover-pencils (uploads → post-images
  bucket, saved through `update_community_settings`).
- **Layout**: right rail = About card (name, stats, clamped description with
  Read-more, mute bell, MODERATORS · n ONLINE with presence dots) → community
  lists with search filter → LIVE/SCHEDULED DISCUSSIONS (only live rooms are
  links) → clamped RULES. Clicking the "Communities" title returns to All posts.
  Community names everywhere route to the board (`agora:open-community` event).
- **Community-hosted rooms**: `debate_rooms.community_id`; `create_room` requires
  **community moderator** for `p_community`; homepage cards + scheduled squares
  show "hosted by 〔A〕Community"; room topbar shows a 🏛 chip; members get
  `community_debate` bell notifications. Wording rule from Jordan: **avoid the
  word "debate" in community-facing UI — say "discussion"**.
- **Profiles**: Posts + **Reposts** tabs (TikTok-style) via
  `get_community_posts(p_author)`; rows deep-link into the board view.
- Notifications bell renders `community_post`, `community_debate`, `mention`
  (with post titles via the extended `get_notifications`).

**Process notes**: two adversarial review workflows ran over the diffs; all 12
unique confirmed findings fixed (repost privacy leaks, a stored-XSS via
`communities.color` — now DB-constrained to hex + client-validated, deep-link
race, comment/image state bleed, Enter double-submit, etc.). Post/comment images
live in the **public** post-images bucket (unguessable URLs — accepted risk,
same posture as avatars).

**2FA is NOT in production.** An email-2FA UI was built 08-19/20 but held back
(commit `7593b12`): the flow verified codes client-side and returned the code in
the RPC response — cosmetic, not protective — and its tables were never applied.
The WIP survives on `jordan/dev` (commit `c24d7f9`). Rebuild server-side
(Supabase native MFA or Resend-delivered codes verified in an API route).

## Test/verify conventions

`npm test` (vitest, **81** tests) and `npx tsc --noEmit` stay green (delete
`.next/dev` if tsc chokes on a half-written generated file). `npm run build`
before pushing. Health endpoint after deploys. Signed-in flows still need a real
login — Claude cannot enter passwords; have Jordan log into the Browser pane and
drive from there. rAF pauses in hidden tabs — front the tab when checking the
Three.js stage.

## Known gaps / next steps

1. Activation checklist above (HLS paste → verify end-to-end, Resend, PostHog,
   CRON_SECRET, GIPHY key).
2. Real 2FA (see above).
3. Communities scale items (deliberately deferred): comment pagination,
   per-community bans don't block *viewing* public boards (by design), mention
   notifications only fire on insert (no post editing yet), community discovery
   ranking once board count grows.
4. Homepage quality backlog (hero carousel ranks/hides dead rooms, drop repeated
   "quiet" pills, retire floating N logo) — pre-existing, untouched 08-20.
5. Icon sweep: ~45 emoji-as-UI sites remain; `controlIcons.tsx` unused.
6. Presence fan-out softening before open beta (N²-ish change events).
7. Per-viewer focus v2 on the stage (dynamic slots, active-speaker auto-focus,
   simulcast quality switching).
8. Big rocks: recordings/VOD (egress → R2 → replay → clips), AI judging on
   Alan's transcripts, ranked/ELO, CI, moderation automation, Stripe.

## Access notes (this machine)

Git + `gh` as `jordangivenchy`; Vercel via `npx vercel` (MCP connector 403s on
deployments — CLI works; `.vercel/project.json` has project/org ids). Supabase
MCP connected (how all migrations get applied). Cloudflare MCP connector
available (R2 bucket CRUD — cannot mint S3 keys or toggle public access).
Branches: `main` = production; `jordan/dev` = main + the 2FA WIP commit. Alan
(miroalan) and Josh (joshuaabdala) have push access; their pushes auto-deploy.
