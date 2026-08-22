# AgoraSphere — Context Handoff

_Last updated: 2026-08-22. Covers the 08-21→08-22 marathon: email 2FA
shipped, Resend/HLS/GIPHY/NewsData activated, profile v2, the React
sidebar (strangler step 1), scale fixes (presence, comment pagination),
the news section, Community Bookmarks, the hero carousel redesign, Alan's
live-AI + data-platform merges. Everything below is LIVE in production
unless marked otherwise._

## What this is

AgoraSphere: a live debate/discussion platform — Next.js 16 (App Router) +
Supabase (Postgres/auth/realtime) + LiveKit (voice/video/egress) + a
Three.js amphitheater with a DOM video stage. **Live at
https://agorasphere.net — closed beta.**

## Production infrastructure

| Piece | Where | Notes |
|---|---|---|
| Hosting | Vercel `agorasphere` (account `jordangivenchy`) | **Auto-deploys on every push to `main`** (~80s) |
| Domain | agorasphere.net (Squarespace DNS) | Apex A → 216.198.79.1, www CNAME → Vercel; Resend DNS (DKIM/SPF/MX on `send.`) added 08-21 |
| Database | Supabase ref `unedjtgfayhdisopwywz` | Postgres 17, us-east-1 |
| Voice/video | LiveKit Cloud `wss://agora-8q35ahbv.livekit.cloud` | Tokens `/api/livekit`; egress `/api/egress` |
| HLS storage | Cloudflare R2 `agora-hls` | **ACTIVE** (`hlsStorage: true`) — health probe was checking the wrong env names until 08-21 |
| Email | Resend, domain verified | **ACTIVE** — 2FA codes, password-changed, debate reminders |
| News | NewsData.io (free tier) | **ACTIVE** — `NEWSDATA_API_KEY`; GNews + Particle adapters env-gated as alternates |
| Beta gate | `BETA_INVITE_CODE` (Vercel, Sensitive) | **Current value unknown to Claude** — `agora-beta-2026` no longer works; Alan likely changed it. Cannot be read back from Vercel. |

**Health check:** `GET https://agorasphere.net/api/health` → as of 08-22:
`supabaseAdmin ✓ livekit ✓ email ✓ news ✓ hlsStorage ✓ webPush ✓ |
posthog ✗ cron ✗`. Only PostHog keys and `CRON_SECRET` remain.

## Activation checklist (what's left)

1. **`CRON_SECRET`** — any random string in Vercel; unlocks the daily
   maintenance + refresh-traits crons (they 503 without it).
2. **PostHog** — `POSTHOG_PERSONAL_API_KEY`, `POSTHOG_PROJECT_ID`,
   `NEXT_PUBLIC_POSTHOG_KEY` (from Alan).
3. **GoTrue password-verification hook** (2FA hardening, optional but
   recommended): Supabase Dashboard → Auth → Hooks → "Password
   verification attempt" → `public.hook_password_verification`. Until
   enabled, a 2FA user's password alone can still mint a session by
   calling the Supabase auth endpoint directly (normal login is gated).
4. **GitHub CI** — not set up. Recommended: one Actions workflow
   (`npm ci` → `tsc --noEmit` → `vitest` → `next build`, with
   `NEXT_PUBLIC_SUPABASE_URL/ANON_KEY` as repo vars), protect `main` on
   that check, and add the Supabase vars to Vercel **Preview** so branch
   deploys stop failing (they've failed for days — that's the "staging"
   you're missing).

## Secrets hygiene ledger (rotate)

- R2 token pair (pasted in chat 08-19) — **rotate** now that HLS is confirmed.
- Twitch stream key (08-16) — still needs rotation.
- Password "fener1907" (08-19 chat) — burned.
- **NewsData key `pub_2d3e…` pasted in chat 08-21** — free-tier, low stakes;
  rotate when convenient. Also in local `.env.local` (gitignored).
- `SUPABASE_SERVICE_ROLE_KEY` is NOT in `.env.local` (Vercel redacts
  sensitive values on `vercel env pull` → literal `"[SENSITIVE]"`). Routes
  needing admin (2FA, cron) 503 locally until Jordan pastes it in.

## Critical operational facts

- **DB migration drift**: live DB is applied by hand/MCP. Files through
  **`20260846`** are applied (this session: `20260842_email_2fa`,
  `20260843_profile_v2`, `20260844_comment_pagination`,
  `20260845_community_favorites`, `20260846_community_bookmarks`). Alan's
  files use **out-of-order names** (`20260817_agora_moderator`,
  `20260818_user_data_platform`) and were applied by him via the SQL
  editor — verified present. When something 42703s, check the live DB.
- `public.app_config` (service-role only) holds VAPID keys, reminder
  webhook secret, `app_origin`. pg_cron `room-reminders` every 2 min.
- Moderators: `jordan`, `jordan1` (`users.is_moderator`). Communities have
  their own per-board roles.
- **mvp-home.css has a universal reset** (`*{margin:0;padding:0}`) that
  out-cascades Tailwind utilities on any route that loads it. Routes that
  borrow homepage pieces import it through `home-sidebar.css`, which
  wraps it in `@layer mvp-home` (declared first in `globals.css`). Never
  import `mvp-home.css` directly outside `page.tsx`.
- Tailwind arbitrary utilities like `lg:ml-[260px]` silently failed on the
  profile route (same reset); plain CSS classes in `globals.css` were used
  instead (`.profile-beside-sidebar`).
- `dangerouslySetInnerHTML` + React re-render = the injected tree gets
  recreated and any post-mount DOM mutations revert. Transform the string
  before injection, wrap it in a `memo` child, use document-delegated
  listeners (see `HomeSidebar.tsx`).
- Wording rule: community-facing UI says **"discussion"**, not "debate".
- Room cleanup habit: `update debate_rooms set status='ended', ended_at=now()
  where status='live' or (status in ('created','scheduled') and
  (scheduled_start is null or scheduled_start < now()));`

## What shipped this session (all deployed unless noted)

**Email 2FA, real** (`/api/auth/2fa/*`, migration 20260842). Server-side
password check with a throwaway client, session revoked, HMAC-hashed
6-digit code emailed via Resend (10-min TTL, 5 attempts, single-use,
constant-time compare), session minted on verify via admin magic-link
token (no tokens at rest). Enroll proves the inbox; disable re-checks the
password. Fails closed without Resend. Rate limits + `log_security_event`
audit. Tested end-to-end in production by Jordan. Dormant GoTrue hook
ships with the migration (see checklist #3).

**Profile v2** (migration 20260843): banner (3:1, 1500×500 hint, fused
with the header card, avatar overlap), social links (icon buttons —
X/Instagram/LinkedIn/YouTube/GitHub/globe — top-right above the action
buttons), karma, live-now chip (links to the room), mutual follows,
tabs: Debates (only LIVE rows link; rows say "hosted by @x"), Scheduled,
Posts, Reposts, Comments (paginated RPC), **Communities** (own tab),
Shorts. ⋯ menu with Block (`block_user`) / Report (`submit_report` via
ReportModal). `get_user_profile` v4, `get_user_comments`,
`get_user_communities`, `update_profile_extras`. Edit Profile modal has
banner upload + links editor (`src/lib/socialLinks.ts`).

**Homepage sidebar is React** (`HomeSidebar.tsx`, strangler step 1).
Shared by `/` and `/users/[username]`; markup/classes identical to the old
static aside; `mvp-home.js`/`mvp-adapter.js` sidebar handlers retired;
nav is a callback (home: React panels / `loadHomePage`/`loadExplorePage`;
profile: `/?nav=<id>` deep link handled in `page.tsx`, panels open
immediately on mount). Subscriptions removed from markup.

**Scale fixes**: presence is a jittered 45s **poll** (was N² realtime
fan-out; API unchanged, `touch_presence` heartbeat untouched, hidden tabs
skip). `get_post_comments(p_post, p_limit=60, p_offset)` pages top-level
threads with descendants riding along; "Load more comments"; posting
appends locally.

**Homepage**: hero features **live rooms only** (no dead-room fallback),
"quiet" pills removed, Next dev-tools "N" hidden (`devIndicators:false`).
Hero slides redesigned: solid `#0b0b0d` 250px right column on every
slide; **news slides** = full-bleed photo + column (Reported by, summary,
"Read article at ⟨outlet⟩ ↗"); **room slides** = blurred thumbnail
backdrop + sharp square (host avatar fallback) centered on the slide,
column shows LIVE for Xm, speakers · audience, topic/secondary/format/
language chips, Speakers list (no PRO/CON, no open-seat row), hosted-by,
Watch Live. Thin chevron arrows. 9s autoplay. Room-title XSS in the slide
template fixed (escaped).

**News**: `/api/news` → NewsData (`prioritydomain=top`, world/politics/
business/science/technology, 2 pages, 20-min shared cache ≈ 144 of 200
free credits/day; ~12h free-tier delay), ranked by `src/lib/newsRank.ts`
(cross-outlet clustering → "Reported by", hard-news vocabulary, recency,
live-blog penalty; top 3 = `major` → hero, rest → ticker). Sample feeds
**never render**. Outlet names normalized (BBC, Al Jazeera…). Images:
BBC upgraded to 1024px; Guardian URLs are signed — never rewrite them.
News tab (`NewsPage.tsx`): major cards + rows, "Read at ⟨outlet⟩ ↗",
"Start a discussion" (prefills create modal; category→topic map),
"Queue a conversation" (→ `queue_for_topic`). Rejected providers: Google
News RSS (license forbids non-personal use), GDELT (429 wall), NewsAPI.org
(dev-only free tier, $449 prod). Lean/bias data: no API exists; an
in-house outlet-lean table was discussed, not built. Particle has no
public API (partner email is the only path).

**Communities**: Back pill (post → its board → All), right rail 310px,
page 1200px, **favorites** (star; `community_members.favorite`,
`set_community_favorite`, migration 20260845), **Community Bookmarks**
(Reddit-style mod-curated pill links + dropdown groups;
`communities.bookmarks` jsonb, `set_community_bookmarks`, migration
20260846; editor in board settings: `Label | URL` lines, `## Group`
headers; `src/lib/communityBookmarks.ts`). Thread depth cap: past 5 levels
no indent, one rounded half-rectangle bracket joins each reply.

**Explore**: results render the homepage block (`RoomCard.tsx`, shared;
`ExploreGrid.tsx` portals into `#epResultsGrid`; vanilla filters emit
`agora:explore-results` ids). Home feed still uses its inline copy —
**next step: switch TopicsHome to `RoomCard`** for one implementation.

**Queues**: one **Join** button per question (side auto-picked to match
instantly), no Pro/Con.

**Unpushed at handoff time** (local `main`, 4 commits ahead of origin):
single Join button, Explore blocks, hero thumbnail centering, this handoff.

## Alan's work (merged to main 08-21/22)

- **Live AI**: bare "Agora" wake word (`src/lib/wakeWord.ts`), **Live
  Moderator mode** (host toggle in the Agora panel; `debate_rooms.
  agora_moderator`; `maybeModerate` in `/api/agora/transcript` asks Gemini
  whether to add `context`/`insight` via `agora_interjections`; 150s shared
  cooldown), Shazam-style orb. **Known bug**: `maybeModerate` claims the
  interjection cooldown slot *before* the model decides — a "none" answer
  still consumes it, suppressing fact-checks for up to 150s. Fix: peek,
  then claim only when speaking.
- **User data platform** (`20260818_user_data_platform.sql`): consent
  table (Alan later flipped **consent on by default**), behavioral
  signals (`/api/signals`), expressed positions from transcripts, profile
  synthesis/learning style, personalization ranking, coaching notes,
  Data & Coach panel in Settings, `export_user_data`/`erase_user_data`.
  Adds `vitest.config.ts`. Not reviewed line-by-line; privacy posture
  (opt-out now) deserves a look.

## Test/verify conventions

`npm test` (vitest, **174** tests) and `npx tsc --noEmit` green;
`npm run build` before pushing; health endpoint after deploys. Signed-in
flows need a real login — have Jordan log into the Browser pane. The
homepage reloads data every 30s, which replaces synthetic carousel
injections — test live slides with a real live room. After editing
`mvp-home-html.ts` do a **full reload** (injected once at mount). If
Turbopack serves stale/broken modules, `rm -rf .next` and restart.

## Known gaps / next steps

1. CI + Preview env (see checklist) — biggest process risk.
2. Recordings/VOD (egress → R2 → replay → clips): HLS is live now; the
   Shorts tab is empty and ended debates are dead ends. Biggest product gap.
3. Homepage strangler: navbar → hero carousel → browse/rooms grid →
   explore chrome → delete `mvp-home.js`. Switch TopicsHome to `RoomCard`.
4. Alan's moderator cooldown bug; review the data-platform privacy defaults.
5. News: in-house outlet-lean table + cross-spectrum allowlist ("Reported
   by" balance bar); GNews key if real-time matters.
6. Mobile audit before open beta; mutual-follow *count* in profile RPC.
7. Big rocks unchanged: AI judging, ranked/ELO, moderation automation, Stripe.

## Access notes (this machine)

Git + `gh` as `jordangivenchy`; Vercel via `npx vercel` (redeploy is
permission-blocked for Claude — Jordan clicks Redeploy; `vercel env pull`
redacts sensitive values). Supabase MCP applies migrations. Branches:
`main` = production; `jordan/dev` is kept in sync with `main` (force-
updated after each push); `alan/dev` = Alan's branch (merged to main).
