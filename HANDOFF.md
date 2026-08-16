# AgoraSphere — Context Handoff

_Last updated: 2026-08-15 (evening). Covers the full deploy-day session._

## What this is

AgoraSphere: a live debate/discussion platform — Next.js 16 (App Router) + Supabase
(Postgres/auth/realtime) + LiveKit (voice/video) + a Three.js 3D amphitheater.
**Live in production at https://agorasphere.net.**

## Production infrastructure

| Piece | Where | Notes |
|---|---|---|
| Hosting | Vercel, project `agorasphere` (account `jordangivenchy`) | **Auto-deploys on every push to `main`** — no manual deploy needed |
| Domain | agorasphere.net, registered at Squarespace (ex-Google Domains) | Apex A → `216.198.79.1`, `www` CNAME → `cname.vercel-dns.com`; also live at agorasphere.vercel.app |
| Database | Supabase project ref `unedjtgfayhdisopwywz` ("jordangivenchy's Project") | Postgres 17, us-east-1 |
| Voice/video | LiveKit Cloud `wss://agora-8q35ahbv.livekit.cloud` | Token API at `/api/livekit` (guests forced subscribe-only server-side) |
| Auth URLs | Supabase → Site URL `https://agorasphere.net`; redirect allow-list covers prod + vercel.app + localhost | Reset/confirm emails link to the domain |
| Emails | Supabase built-in mailer (`noreply@mail.app.supabase.io`) | Works (verified via auth logs) but rate-limited & unbranded — custom SMTP (e.g. Resend) is a known TODO |

**Env vars** (set in Vercel production + `.env.local` locally, values NOT in this file):
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_LIVEKIT_URL`,
`LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`.
**Missing in prod:** `GEMINI_API_KEY`, PostHog keys, `SUPABASE_SERVICE_ROLE_KEY`, Apify —
Alan has these; without them the Agora AI assistant is inert in production (UI loads fine).

## Critical operational fact: DB migration drift

The live Supabase DB has **no tracked migration history** — everything was historically
applied by hand, so `supabase/migrations/` files are NOT proof of what's live. This has
bitten twice (raise-hand column missing; every function grant defaulting to
PUBLIC/anon — including a real `get_user_history` privacy leak, both fixed). When a
feature "doesn't persist" or errors with `42703`, **check the live DB first** (probe the
PostgREST endpoint or use the Supabase MCP). Recent migrations (`20260705` →
`20260821`) ARE applied live. A grant-drift audit of the non-profile RPCs
(room/queue/password-reset functions) was flagged but never done.

## Architecture map (key files)

- **Amphitheater room** (`/agora/[id]` — where all room links route):
  `src/app/agora/[id]/page.tsx` (state, queue derivation, control bar),
  `src/components/agora/AgoraScene3D.tsx` (Three.js scene: world built once per room;
  crowd/queue/video-feed groups rebuild independently, content-keyed),
  `Amphitheater.tsx` (HTML rail over the scene), `HostControls.tsx`,
  `useAgoraCall.ts` (LiveKit layer), `AgoraVideoDock.tsx`, `ReactionOverlay.tsx`,
  `queueLayout.ts` + tests (queue slot math), `stage.ts` (role model — NOTE:
  `stage_role='audience'` in DB is treated as "unset" because it's the column default).
- **Speaker queue** (teleport-based, per the design brief): DB is the queue —
  `hand_raised_at` ordered by (timestamp, user_id), server-stamped via `raise_hand`
  RPC; `advance_speaker_queue` / `step_down_from_mic` / `debate_rooms.mic_user_id`;
  host modes: manual "Bring up next" or `queue_auto_advance` (auto mode is driven by
  the host's client — no host present ⇒ no auto-advance).
- **Classic room** (`/rooms/[id]`): older 2D stage, still functional, guest-audience
  flow lives here too (`?spectate=1`).
- **Profiles**: modal system + shareable `/users/[username]` pages.
- **Auth/settings**: `/settings` (8 sections, all functional; mic/cam-on-join defaults
  stored but enforcement unverified), password reset flow with rate limiting
  (`/api/auth/forgot-password`), moderation panel at `/mod`.
- **AI assistant**: `AgoraAssistant.tsx` mounted in both room types; pipeline in
  `src/lib/ai|apify|chat|posthog|retrieval`, route `/api/agora` (needs the missing keys).

## Test/verify conventions

`npm test` (vitest, 61 tests) and `npx tsc --noEmit` must stay green — **ignore errors
under `next-app/`** (that's a dead prototype directory, excluded from the app).
Production build verified via `npm run build`. UI changes were verified in a live
browser throughout; the 3D scene renders at `/agora/<room-id>`.

## Known gaps / next steps (in rough priority)

1. **Real two-person camera/mic smoke test** — publish paths use standard LiveKit calls
   and are gated correctly, but actual capture was never exercised (no camera in the
   dev environment). Test: host clicks 📹 → face should appear on the stage holo screen.
2. **AI keys in Vercel** (from Alan) → assistant live in prod.
3. **Custom SMTP + branded email templates** (Resend + Supabase dashboard) → emails
   from `@agorasphere.net`, higher rate limits, personalized greeting.
4. **"Password changed" notification email** — doesn't exist (change succeeds silently).
5. **Grant-drift audit** for non-profile RPCs (see drift section above).
6. **Naming split**: UI says "Audience" in the amphitheater world, but the DB role is
   still `'spectator'` and some classic-room copy may still say Spectator.
7. Mic/cam-on-join settings enforcement; queue "+N more" overflow marker is a static
   depth cue, not a live count.

## Access notes (this machine)

Git identity + `gh` CLI authenticated as `jordangivenchy`; Vercel CLI logged in
(project linked in `.vercel/`); Supabase MCP connected to the project. DNS changes
happen in the user's Squarespace account; Supabase dashboard changes were driven via
the user's own Chrome session.
