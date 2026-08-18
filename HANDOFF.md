# AgoraSphere — Context Handoff

_Last updated: 2026-08-16 (late night). Covers the friend-system, profile-system,
pretty-URL, and restream sessions._

## What this is

AgoraSphere: a live debate/discussion platform — Next.js 16 (App Router) + Supabase
(Postgres/auth/realtime) + LiveKit (voice/video/egress) + a Three.js 3D amphitheater.
**Live in production at https://agorasphere.net — currently in closed beta.**

## Production infrastructure

| Piece | Where | Notes |
|---|---|---|
| Hosting | Vercel `agorasphere` (account `jordangivenchy`) | **Auto-deploys on every push to `main`** |
| Domain | agorasphere.net (Squarespace DNS) | Apex A → 216.198.79.1, www CNAME → Vercel |
| Database | Supabase ref `unedjtgfayhdisopwywz` | Postgres 17, us-east-1 |
| Voice/video | LiveKit Cloud `wss://agora-8q35ahbv.livekit.cloud` | Tokens at `/api/livekit`; restream egress at `/api/egress` |
| Beta gate | `BETA_INVITE_CODE` env (Vercel) | **Currently `agora-beta-2026`** (reset 2026-08-16 — the original code was deleted and could not be recovered). Unset the var + redeploy to open the site. Pass = 30-day cookie keyed to a hash of the code; rotating the code revokes all passes. |
| Emails | Supabase built-in mailer | Unbranded + rate-limited; custom SMTP (Resend) still TODO |

**Env vars (Vercel Production):** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`NEXT_PUBLIC_LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `GEMINI_API_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `APIFY_TOKEN`, `APIFY_WEBHOOK_SECRET`, `BETA_INVITE_CODE`.
**Still missing:** PostHog keys (Alan has them) — trait-refresh cron and personalization inert.
The five original vars are **Production-only**, so branch Preview builds fail on Vercel
(tick Preview on them in the dashboard to fix; merging to main is unaffected).

## Critical operational facts

- **DB migration drift**: the live DB is applied by hand/MCP; `supabase/migrations/` files
  document intent but are not proof of state. Everything through `20260827` IS applied live.
  When something 42703s, check the live DB first.
- **Moderators**: `jordan` and `jordan1` (`users.is_moderator`). Verified badges: `jordan1`, `alan`
  (grant/revoke via the Verify toggle on profile pages — mod-only, `set_user_verified` RPC).
- **A Twitch stream key was pasted into a Claude session on 2026-08-16** and should be
  reset in the Twitch dashboard (LyricalVAL account).
- Room cleanup habit: `update debate_rooms set status='ended', ended_at=now() where status='live'
  or (status in ('created','scheduled') and (scheduled_start is null or scheduled_start < now()));`
  spares future-scheduled rooms.

## Architecture map (key additions since the first handoff)

- **Friend system** (mutual follows = friends): sidebar Friends card + list overlay
  (`src/components/friends/FriendsSection.tsx`), friends-only DMs with realtime + unread
  badges (`src/components/messages/MessagesDock.tsx`, `dm_messages`), site-wide presence
  (`src/lib/presence.ts`, `PresenceBoot`), room invites + friend-request accept/decline in
  the bell, favorites (friends-only via RLS). Blocks sever follows/requests both directions.
- **Profiles**: full pages at `/users/[username]` aka `/@handle` (proxy rewrite), driven by
  `src/components/ProfileView.tsx` — also rendered as an in-room slide-over drawer
  (UserContextMenu "View profile" inside `/agora|/rooms` paths) so the debate keeps playing.
  Tabs: Debates / Scheduled / Posts / Shorts (clips). Own profile: Edit + Share under stats.
  `VerifiedBadge`, `UserAvatar` (photo w/ Google-size rewrite + broken-image fallback,
  `radius` prop for square tiles).
- **Pretty URLs** (`src/lib/urls.ts`): rooms `/agora/<motion-slug>-<short8>` resolved by
  `resolve_room_prefix` RPC (UUID links still work); users `/@name`.
- **Room lifecycle**: entering seats you as spectator (auto-seat), leaving vacates; host
  Leave prompts "Close stage / Just leave"; `status='ended'` shows a banner and walks
  everyone home. `?avdebug=1` on a room = live call-plumbing overlay.
- **Media cost/quality**: dynacast + simulcast + 720p capture; audience pulls 360p in
  audience view, 720p in speaker view (auto-retunes); classic room uses adaptiveStream.
  Audio autoplay blocking surfaces a "tap to listen" prompt.
- **Restream (RTMP)**: Host Controls → Room tab → paste `rtmp://host/app/KEY` →
  LiveKit room-composite egress films the room page in **broadcast mode** (`?token&url`
  present → chrome hidden, speaker view locked, watermark, connects with the recorder
  token from the URL, signals `START_RECORDING`). 1080p @ 6 Mbps, portrait toggle for
  TikTok. The compositor is **software WebGL** — broadcast mode renders the scene at the
  performance floor (1x, no shadows/MSAA). Beta gate exempts `/agora/*?token&url`.
- **Homepage Browse**: square 168px room cards (host photo thumbnail, LIVE pill, topic
  text top-right, title + "by host" + format/viewers in a bottom scrim), Lucide topic
  icons, glowing live/waiting status dots, Ethics tab removed.
- **bfcache guard** in `layout.tsx` head: reloads once when back/forward restores the HTML
  shell without the React flight payload (black-screen bug).
- Typography: Space Grotesk (display) + DM Sans + DM Mono, single Google Fonts link in
  layout. Logo is `logo.png` via the shared `Wordmark` component.

## Test/verify conventions

`npm test` (vitest, 61 tests) and `npx tsc --noEmit` stay green — ignore `next-app/`
(dead prototype). `npm run build` before pushing (transient Turbopack contention with the
dev server can fake failures — rerun standalone before believing one). UI verified in the
in-app browser; signed-in flows need a real login (jordan1 etc.).

## Backend hardening (2026-08-17 session — all applied live)

- **Display names in RPCs**: search_users, get_friends, get_followers/following,
  get_community_posts/comments (+ new `get_community_post` single fetch),
  get_dm_threads, get_notifications all return display_name; clients consume it
  (migration `20260829`). Client-side join workarounds removed.
- **LiveKit tokens are server-verified**: `/api/livekit` derives identity from the
  Supabase cookie session (no more client-claimed userId), names come from the DB,
  and scheduled rooms 403 (`room_not_open`) until 30 min before start (host exempt).
- **Search infra**: pg_trgm GIN indexes on users/community_posts/debate_rooms;
  discovery search has a DB-backed ROOMS section (full coverage, not just the
  homepage's fetch window).
- **DM rate limit**: trigger caps 20 sends/min/sender (`dm_rate_limited`).
- **Ghost seats**: `debate_participants.last_seen_at` + `touch_seat` heartbeat
  (both room pages, 60s) + `sweep_ghost_seats()` — runs opportunistically from
  /api/livekit and daily via `/api/cron/maintenance` (vercel.json 6:30).
- **Trusted presence**: `user_presence` table written only via `touch_presence()`
  (identity = auth.uid()) replaces the spoofable realtime presence channel;
  presence.ts heartbeats 45s, stale after 90s.
- **Egress auto-stop**: close-stage calls `/api/egress {action:"stop_all"}`;
  the maintenance cron also kills egress running against ended rooms.
- **OAuth avatar self-hosting**: maintenance cron copies googleusercontent
  avatars into the avatars bucket (10/run).
- **Grant audit done** (migration `20260831`): revoked anon execute on
  advance_speaker_queue, raise_hand, step_down_from_mic, set_user_verified;
  trigger/maintenance fns locked to service role. close_inactive_room keeps anon
  by design (guests may suggest closure; RPC re-validates).
- **Thumbnails**: Host Controls Room tab can change a room's thumbnail post-create.

## Known gaps / next steps

1. **PostHog keys** from Alan → Vercel (trait cron + retrieval inert without them).
2. **Custom SMTP + branded emails** (Resend account + DNS needed); password-changed email.
3. **HLS egress for audience at scale** (~300+ concurrent) — needs an S3/GCS bucket for
   segments; WebRTC stays for stage.
4. Restream niceties: first full TikTok run (Twitch verified end-to-end path except final
   frames).
5. Deploy note: at the moment the heartbeat code deploys, users on pre-deploy tabs don't
   beat and get swept after 5 min (seat restored on next visit) — transient, cosmetic.

## Access notes (this machine)

Git + `gh` as `jordangivenchy`; Vercel CLI logged in; Supabase MCP connected (it had a
~1h outage on 2026-08-16 — the dashboard SQL editor is the fallback). Alan (miroalan) and
Josh (joshuaabdala) have GitHub push access; their pushes auto-deploy fine.
