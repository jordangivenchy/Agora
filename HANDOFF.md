# AgoraSphere — Context Handoff

_Last updated: 2026-08-31. Covers 08-29→08-31 (2FA actually enforced via
the Custom Access Token hook, an agent QA pass that found + fixed two
live bugs incl. invite codes broken for everyone, recording-cost
controls, a post-run Gemini transcription pipeline, real view counts,
community applications + community-locked rooms, and site chrome
everywhere: navbar/sidebar/starfield on every page). Everything below is
LIVE in production unless marked otherwise. Older digests' details are
folded into the archive sections._

## ⚡ 08-29→08-31 session digest (read this first)

**Migrations applied to the live DB this session: 20260875 → 20260885**
(files match live; every one verified with role-simulation queries in
ROLLED-BACK transactions — the `DO $$ ... RAISE EXCEPTION 'TEST_RESULTS'`
pattern, results ride out in the error message and nothing persists).

**🔐 2FA is now actually enforced (hook LIVE in the dashboard).** The
planned Password Verification Attempt hook turned out to be
**Team-plan-only** — never callable on our plan. Replacement
(20260875): `hook_custom_access_token` (Custom Access Token hook, Free
plan, ENABLED by Jordan in Supabase → Auth → Hooks) refuses to mint a
token for a `password`-grant sign-in when the account is 2FA-enrolled,
unless the short-lived two_factor_gate is open. Every other
authentication_method (token_refresh, magiclink/otp — the post-verify
mint — oauth, recovery) passes through; fails OPEN on unexpected errors.
Settings → change-password re-auth moved to `/api/auth/reauth` (gated
server-side check) since a client `signInWithPassword` would now be
rejected for 2FA users. **Section-1 QA (sign-in / enroll / code flow /
password change) still not walked by a human.**

**🧪 Agent QA pass over the launch checklist** (artifact:
https://claude.ai/code/artifact/92b1404a-6fd3-43a6-a3b5-f87cc749e9af —
checkable page, state saves per browser). DB-verifiable sections ran via
role-simulation agents; human halves (2FA, clips, 2-person recording,
mobile) remain. Results: private-room RLS/gating/replay-privacy PASS;
feed replays 4/4 PASS; topics/queue/duel plumbing PASS. Two REAL bugs
found and fixed:
- **join_private_room was broken for EVERYONE** (42702 `room_id is
  ambiguous` — the `returns table` OUT param vs unqualified column;
  shipped broken since 20260421). Fixed 20260878 with
  `#variable_conflict use_column`. Every invite-code join now works.
- **Blocked communities still appeared in the home feed** — 20260867
  promised exclusion but no layer implemented it. Fixed 20260876
  (blocked_comms CTE in get_home_feed's rooms/posts/comments).

**📼 Recording-cost controls (the "we pay for dead air" fixes).**
- **Egress stops the moment a room ends by ANY path** (20260879):
  trigger on debate_rooms live→ended → pg_net POST →
  `/api/internal/room-ended` (Bearer reminder_webhook_secret), which
  stops all active egresses + stamps hls_url/recording_ended_at.
  ⚠️ This exposed that the **beta gate was 307-ing ALL machine webhooks**
  — `/api/internal` is now in BETA_EXEMPT (src/proxy.ts). Any new
  machine endpoint must be added there too.
- **Host-gone grace 90s → 45s** (20260877). Clean host leave ends the
  room in ~45–105s.
- **Idle-room reaper** (20260880, on the every-minute room-lifecycle
  cron): live rooms with a flowing transcript but no utterance AND no
  chat for 20 min end as inactive (armed only after ≥1 utterance, so
  transcription-off rooms can't be false-killed); any recording past
  the 3-hour hard cap ends regardless. AFK-with-tab-open is now bounded.

**📝 Post-run replay transcription (Gemini, no ffmpeg, DEPLOYED +
backfilled).** Live Web-Speech transcripts are Chrome-only/gappy; now a
`replay-transcripts` pg_cron (every 2 min) enqueues ended recorded rooms
to `/api/internal/transcribe-replay`: parses the VOD playlist, extracts
raw AAC from the MPEG-TS segments with a minimal demuxer
(src/lib/replayTranscribe.ts — verified byte-exact against a prod
segment), transcribes ~9-min chunks via the existing GEMINI_API_KEY
(json prompt, 503/429 retries with backoff, fallback pinned
**gemini-2.5-flash** — `gemini-2.0-flash` 404s on this key), aligns
speaker attribution from live utterances (same recording_started_at
frame + PDT syncDelta as the player), stores to `replay_transcripts`
(RLS: readable iff room enterable; 75-min cap, 3 attempts). The replay
page prefers it when present. All 4 existing recordings backfilled
(the transcription pipeline is also what caught the beta-gate webhook
bug).

**👁 Views actually counted (20260885; per product decision: unique live
viewers, non-unique replay views).** viewer_count previously had NO
writer on the amphitheater route — everything showed 0. Now:
`touch_presence` records each signed-in user once per live room
(locked `room_viewers` table) and bumps viewer_count on first sight;
`bump_replay_view(p_room)` (+1 per watch, anon included, gated by
can_enter_room) feeds new `debate_rooms.replay_views`; the replay page
shows "N views" + "N watched live". Feed/popular ranking inputs are now
real. Historical rooms stay 0. HLS-overflow lurkers still uncounted (no
presence row).

**🏛 Community applications (20260883 + 20260884).** Private boards are
now application-based: Request opens a dialog with an optional ≤500-char
message; mods can set `communities.application_prompt` (≤1000 chars,
settings textarea, shown highlighted in the dialog) and then an answer
is REQUIRED (server-enforced, `application_required`). Mod panel section
is now APPLICATIONS with the message quoted per applicant. Two new
notification types — `join_request` (all mods, coalesced per board) and
`join_approved` (applicant; denial silent) — registered EVERYWHERE
(CHECK constraint, notification_types(), notifIcon/notifText/notifHref,
POST_TYPES filter, PREF_GROUPS toggles, OS_BODY; in-app only, no
email/push default). request_to_join is backward-compatible (p_message
defaults null).

**🚪 Community-locked rooms + code-room privacy fix (20260882).**
- New `access_mode='community'`: private room only that board's members
  enter (create_room requires the creator to be a community mod for
  community rooms already); Create modal shows a "⟨Board⟩ members" pill
  when creating from a board; denial screen says "join the board"; HLS
  refused like followers/friends; invite code still the escape hatch.
- **Code-room hole closed**: can_enter_room used to return TRUE for
  everyone on code rooms — a fully-hidden code room (and its replay) was
  readable with just the link. Now code rooms admit non-participants
  only when `allow_spectators` is on (the documented "listed,
  spectate-only" behavior, anon included); hidden ones are
  host/participants-only; the denial screen's code input redeems entry.

**🎨 Site chrome + UI (one big client push, commit 17f3bb8).**
- **SiteChrome** (src/components/SiteChrome.tsx): the REAL home navbar
  (same ids/classes so mvp-home.css styles it: logo, centered search
  pill with Create inside, messages, bell, avatar dropdown with real
  auth state) + glass sidebar + **Starfield** (src/components/
  Starfield.tsx, ported from mvp-home.js) on every standalone route:
  /replays, /clips, /users, /notifications, /settings, and ended
  /agora rooms. Live amphitheater + auth flows stay bare. Navbar is
  transparent with no hairline on chrome routes (home keeps solid
  black); nav row sits centered between page top and carousel; Create
  button optically nested (equal insets + 1px optical lift).
- **⚠️ CASCADE LAYER ORDER CHANGED** (globals.css line 1):
  `@layer theme, base, mvp-home, components, utilities;` — mvp-home now
  BEATS Tailwind preflight (needed for shared chrome) but still LOSES to
  utilities (preserving the original reset containment). Remember:
  stale-CSS symptoms after layer/CSS edits still mean `rm -rf .next`.
- Sidebar: reordered **Home · Feed · Communities · Trending · News ·
  Explore**; active tab is now a **gold 1px border** (no fill); the rail
  itself is translucent (rgba(10,10,12,0.55), unblurred) over the stars.
- **Feed**: 1440px wide; replay cards enlarged (208×117 thumbs, title
  above host line, no badge, "Watch discussion"); NEW right rail
  (src/components/feed/FeedRail.tsx, 310px sticky lg+, styled exactly
  like the Communities rail): Live now (60s refresh) · Who to follow
  (get_people_suggestions) · Queue a conversation (3 most-waited Daily
  Topics, stanceless queue + match poll) · Upcoming (your reminders).
  In-column live shelf is lg:hidden (rail covers it).
- **Communities**: 1440px; solid Join pills; joined-state badges REMOVED
  (rail ✓ and header "✓ Joined" both gone — membership = no Join button;
  Leave lives in ⋯); mod-tools grid moved OUT of the frosted header card
  onto the starfield (panels rgba(10,10,13,0.55) unblurred); gold title
  underline removed.
- **Replay screen**: back arrow removed (navbar logo is the way out);
  Discussion section restyled (YouTube-style unboxed thread, count chip,
  blue focus-ring composer); "More discussions" rail; glassy sections.
- **Language sweep: "replay" is gone from user-facing copy** (tags,
  toasts, emails, push, profile pill "Watch", settings copy — emailCopy
  tests updated). /replays URLs + identifiers unchanged.
- **Hero**: news slides have a solid-blue **Queue a discussion** pill
  (queue_for_headline via `agora:queue-headline` event → React handler in
  page.tsx owns RPC + match poll, `agora:hero-queue-state` paints the
  vanilla button, state survives 30s re-renders); next arrow at the
  slide edge (right: 2px); trending 1440px; profile header tightened
  (banner→name gap, social icons on the cap line, 28px page top pad).

**Watchouts discovered this session**
- Beta gate 307s webhooks: EVERY machine endpoint needs a BETA_EXEMPT
  entry (src/proxy.ts) — cost us silent egress-stop + transcription
  failures (405 in net._http_response).
- Debug pg_net webhooks via `select * from net._http_response order by
  created desc` — status codes of recent hook POSTs.
- `gemini-2.0-flash` is 404 on this key; pin `gemini-2.5-flash` as
  fallback. `gemini-flash-latest` 503s under load — retries required.
- The Browser pane, when hidden, reports innerWidth 0 and pauses
  requestAnimationFrame — canvas animations (starfield) can't be
  verified headless; self-heal on visibility is built in.
- plpgsql `returns table(col)` + unqualified `where col =` = 42702;
  use `#variable_conflict use_column` (precedent: 20260853, 20260878).
- The QA launch checklist artifact stays at the URL above.

**Still open (pre-launch, in rough priority)**
1. **Founders' QA section 1 (2FA)** — the hook is LIVE but no human has
   walked sign-in/enroll/change-password since. Do this first.
2. **Leaked-password protection** (Auth settings — may also be
   plan-gated like the password hook; Jordan to check).
3. **CSP** (defense-in-depth; next.config has no headers).
4. **Rate limiting** on auth+write endpoints; **moderation queue /
   blocklist** — still nothing.
5. **Secrets rotation** (R2 pair, Twitch, NewsData).
6. LiveKit webhook config (would make silent-crash room-end instant);
   recording-length bug likely fixed by the egress-stop trigger but
   verify with the section-6 recording QA.
7. Remaining human QA: clips happy path (prod), 2-person recording,
   private-room UI loop (now incl. community mode + applications),
   feed rail + transcript quality check, mobile pass.
8. Low: 'ethics' orphan topic; CRON_SECRET; PostHog; Trending tiles
   still show their own ENDED badge + 0-view counts on old rooms.

---

## 08-26→08-27 session digest (prior session)

**Migrations applied to the live DB this session: 20260865 → 20260874**
(files match live). 20260865_private_room_access_modes ·
20260866_private_room_access_enforcement · 20260867_community_blocks ·
20260868_lock_down_users_grants · 20260869_gate_room_content_and_rosters ·
20260870_pin_function_search_path · 20260871_home_feed_replays ·
20260872_seed_topics_batch · 20260873_seed_topics_batch2 ·
20260874_daily_topics_show_12. All verified against the live DB with
role-simulation queries. New npm dep: **mux.js** (client-side HLS→MP4).

**🔒 SECURITY AUDIT — three live criticals closed (all deployed).** A
multi-agent audit found the live DB diverged dangerously from the
migration files (same class as the earlier debate_rooms world-readable
bug):
- **Privilege escalation (CRITICAL, fixed 20260868):** anon/authenticated
  held the Supabase-default `GRANT ALL` on public.users, and the UPDATE
  RLS policy checked only `auth.uid()=id`, never columns — so any signed-in
  user could `PATCH` their own row to `is_moderator=true` (also verified,
  suspended_until=null, recording_storage_limit_mb). Revoked ALL client
  writes to users (legit writes go through definer RPCs / the signup
  trigger / admin client).
- **Email PII leak (CRITICAL, fixed 20260868):** same grant exposed
  users.email to anon. SELECT now restricted to display columns only
  (id, username, display_name, avatar_url, bio, banner_url, social_links,
  verified, is_moderator, created_at, username_changed_at).
- **Stored XSS → account takeover (CRITICAL, fixed):** public/mvp-home.js
  rendered room motion + display names UNESCAPED in the home cards / room
  modal / discovery. Every sink now runs through escHTML(). No CSP exists
  yet — adding one is the remaining defense-in-depth item.
- **Stage hijack (HIGH, fixed):** /api/livekit minted canPublish from the
  client-supplied `role`. Publish rights are now derived server-side from
  the actual debate_participants seat.
- **Private content world-readable (MEDIUM, fixed 20260869):**
  room_messages / debate_utterances / agora_interjections and
  community_members were `USING(true)`; now gated by can_enter_room /
  community_visible. 10 functions got search_path pinned (20260870).
- Advisor note: the 195 "security definer executable" and 12
  "rls_enabled_no_policy" lints are BY DESIGN (locked tables, controlled
  RPCs) — not risks. Leaked-password protection + the GoTrue 2FA hook are
  still OFF (dashboard toggles; see open list).

**Private rooms get access modes (20260865/20260866, deployed).**
debate_rooms.access_mode ∈ {code, followers, friends}; can_enter_room()
is the one predicate used at every layer. 20260866 is the real
foundation: debate_rooms + debate_participants SELECT are now gated by
can_enter_room (they were world-readable), which transitively gates the
replay (get_debate_replay reads as caller) and the LiveKit token route.
get_room_gate() powers the denial screen; egress refuses HLS for f/f
rooms. Create modal has a "Who can enter" pill row; the invite code
works in every mode as the escape hatch and now has a real front door
again (denial-screen code input + "Have an invite code?" in the Create
modal — the old JoinPrivateRoomModal/Navbar.tsx were orphaned; Navbar.tsx
deleted). **0 followers/friends rooms exist yet**, so the earlier
bypass window was never triggered.

**Clipping overhaul (deployed).** ✂ on a replay opens **ClipEditor** — a
Twitch-style trim panel (last ~30s pre-selected, drag in/out handles,
live-looping preview, inline title). Clips get their own **/clips/<id>**
page with Share (copy link), **Download** (client-side HLS→MP4 via
lib/clipDownload + mux.js — snaps to segment boundaries; uploaded clips
save directly), and **Post to community**. ClipEmbed renders any
/clips/<uuid> link in a post body inline. NOTE: download only works on
the real agorasphere.net origin — R2 CORS blocks localhost.

**Feed replays (20260871, deployed).** get_home_feed gained a 'replay'
kind: ended rooms with a recording join the ranked stream (paginated by
ended_at; live/scheduled stay page-1-only), scored by affinity+recency.
FeedPage renders them as a horizontal card (thumbnail + REPLAY badge +
"Watch replay" → /replays). Feed needs a signed-in session to view.

**Community ⋯ options menu (20260867, deployed).** Three-dots at the far
RIGHT of a board title (portal-rendered — the header card's
overflow:hidden + backdrop-filter would clip a normal dropdown): Copy
link, Mute/Unmute, Leave, Block/Unblock. Block = community_blocks table
+ set_community_block RPC (leaves the board, cancels join request, hides
it from browse + the aggregate feed; direct visit still works so you can
unblock). Owners can't block their own.

**Copy / naming / content**
- **karma → "Goatedness"** (display only; DB column stays `karma`).
  Profile stats capitalized: Followers · Following · Goatedness.
- **QUEUE section → "DAILY TOPICS"**; the per-question Join buttons say
  **"Queue"** / "Queue — match now".
- **Daily Topics pool seeded to ~605 active** (migrations 20260872 +
  20260873, idempotent): politics/economics/foreign-policy/science-tech/
  culture/**philosophy (0→populated)**/sports. get_debate_topics now
  shows **12 per category/day** (20260874, was 6). One orphan row has
  topic_key='ethics' (invalid category — surfaces nowhere; reassign to
  philosophy sometime).

**Smaller UI**
- Profile column centers in the space beside the collapsed rail; the
  sidebar active pill is mirrored (keyed to --sidebar-width). POPULAR
  ROOMS header + MessagesDock accents + Communities buttons unified on
  the queue-pill blue #2f7fe0 (New community button = hero-pill yellow
  #ffb700); solid disabled states added.
- Profile **Discussions** is a thumbnail GRID (replay tiles), filtered
  to **recorded discussions only**; the replay loading gate ("Entering
  the Agora…" / "Opening the replay…") is replaced by an instant
  layout **ReplaySkeleton** (no jump).
- **Shorts hidden** (profile tab + Trending shelf removed; the Trending
  short-player machinery stays dormant, clips untouched).
- All profile links now go to the standalone /users/<username> page —
  **UserProfileModal deleted**; ?profile=<id> and the agora:profile event
  resolve to it. The **Create** button routes signed-out users to /login.
- **TTS overlay fix** (src/lib/voice/tts.ts): a scoped unhandledrejection
  guard swallows the ML-runtime's floating rejections during model load
  (they were tripping Next's dev error overlay even though TTS falls back
  to the OS voice); WebGPU→WASM device fallback added. Dev-only; benign.

**Still open (pre-launch, in rough priority)**
1. **Enable the GoTrue password-verification hook** (Supabase → Auth →
   Hooks → public.hook_password_verification) — until on, a 2FA user's
   password alone can mint a session via the direct auth endpoint.
2. **Enable leaked-password protection** (Auth settings — one click).
3. **Add a Content-Security-Policy** (defense-in-depth behind the XSS
   escaping — next.config has no headers, no middleware).
4. **Rate limiting** on auth + write endpoints; **moderation queue /
   blocklist** on posts/comments/DMs — neither exists.
5. **Rotate secrets** (R2 token pair, Twitch key, NewsData key).
6. LiveKit webhook still unconfigured; recording-length bug still
   unverified (both carried from last session).
7. Founders' signed-in QA: private-room access loop (create friends-only
   → non-friend hits gate → friend enters → invite code admits an
   outsider), clip happy-path (cut → download on prod → post), feed
   replay cards, community Block/Leave/Mute.
8. Low: 3 extensions in public schema; the 'ethics' orphan topic.

---


## 08-25→08-26 session digest (prior session)

**REPO MOVED: `/Users/jordanjaca/Agora`** (fresh clone). macOS TCC
revoked Downloads access mid-session on 08-26; the old
`~/Downloads/Agora-main` copy is orphaned — delete it. Full `.env.local`
was copied over (public keys + LiveKit pair + NewsData; service-role
still absent). Git identity is configured repo-local.

**Migrations applied to the live DB (files match live through 20260864):**
20260856_stanceless_queue · 20260857_topic_rotation · 20260858_vod_settings
· 20260859_no_live_notif_for_duels · 20260860_presence_queue_status ·
20260861_dedebate_db_copy · 20260862_duel_lifecycle ·
20260863_duel_ends_on_leave · 20260864_clip_ranges. Plus live data ops:
communities renamed (Debates→Replays `…deba`, Debate Club→Discussion
Club), ~110 queue questions seeded, all recordings wiped 08-25 evening
(R2 segment files still orphaned in the bucket — purge from the
Cloudflare dashboard), a host-gone presence backstop folded into
end_hostless_rooms, and SQL-function user-visible copy de-debated in
place.

**Queues are the product's fast lane (all deployed)**
- **Stanceless matching**: queue_for_topic pairs the oldest fresh waiter
  regardless of side; seats assigned invisibly (Pro/Con is GONE from all
  UI — counts say "N waiting to talk", News daily poll is
  Agree/Disagree). Dead components deleted (VotingPanel, QueuePanel,
  DebatesPage, JoinPrivateRoomModal).
- **Topic rotation**: ~125-question pool, 6/category/day via
  date-seeded hash in get_debate_topics (reshuffles midnight UTC, no
  cron); queued topics never rotate out from under waiters; countdown
  chip in the QUEUE header. Growing the pool = plain inserts.
- **Duels** (queue matches, detected by pro_size/con_size 1/1): locked
  to the two-pane speaker gallery (vantage/layout toggles hidden, `g`
  disabled — EXCEPT screen shares, which pin near-fullscreen); NO host
  powers (HostControls hidden, no host-leave confirm); no followed_live
  notification blast; hidden from Popular Rooms + category counts; room
  ends the moment EITHER debater leaves (DB trigger on left_at — covers
  beacon/webhook/ghost-sweep paths); the 90s hostless reaper skips them.
- **Match-stranding fix**: getting matched writes matched_room_id, so a
  board refresh could flip am_queued off and tear down the poll before
  it delivered the room; any un-initiated dequeue now runs a final
  check_topic_match and jumps straight in.
- **Raised-hand fast lane**: HLS-overflow viewers who raise a hand get a
  real-time WebRTC seat (cap HLS_HAND_FAST_LANE_CAP, default 25, queue
  order; lowering returns the seat; beyond-cap clients re-check as the
  line moves).

**VOD system (all deployed except where noted)**
- **Recorder A/V fix (critical)**: the egress compositor's connect path
  returned before track handlers were registered → recordings had one
  camera and NO audio. Handlers now wire before either connect path.
  VERIFY with a fresh two-person recording — also: the 08-26 "dad" test
  room says 12 min recorded but its VOD is 25s; if that recurs
  post-fix, egress is dying early (next bug).
- **/replays/<motion-slug>-<short8>** — dedicated replay route
  (replayPath in lib/urls): DebateReplay directly, no 3D/LiveKit bundle.
  /agora/<id> for ended rooms still works. Trending ended tiles + the
  community embed link there.
- **ReplayPlayer** (agora/ReplayPlayer.tsx) — custom chrome shared by
  replay page / community embed / Trending shorts: gold drag-seek,
  volume, fullscreen, keyboard (space ←→ m f), auto-hiding controls, no
  download/PiP/rate. Supports `range` (clip playback) and `clipRoomId`
  (the ✂).
- **Clips**: ✂ in the player marks [start,end] → clips row
  (start_seconds/end_seconds over the room recording — no video
  processing). Trending Shorts plays ranges via ReplayPlayer. Uploaded
  clips unchanged.
- **Replay page**: YouTube-style inline comments under the VOD (same
  community_comments thread as the discussion post; first comment
  lazily creates it), "More replays" recommendation rail (same field
  first), transcript panel exactly the player's height (absolute-fill
  body — the height:0/min-height trick collapses in auto rows), and
  transcript sync corrected via the playlist's EXT-X-PROGRAM-DATE-TIME
  (offsets were from the egress REQUEST stamp; highlights led audio by
  compositor spin-up).
- **Community embed** (community/ReplayEmbed.tsx): replay threads embed
  the player inline (reverse lookup via discussion_post_id); the "watch
  the replay at /agora/…" body sentence is gone (DB rows nulled +
  ensure_debate_discussion patched).
- **VOD settings**: user_settings.record_debates toggle + 5 GB
  allowance (users.recording_storage_limit_mb — THE subscription
  lever), size estimated at 578 KB/s, stamped by trigger; egress
  start_hls quietly refuses when off/full; Settings → "Recordings &
  storage" shows a usage meter. Trending: ended rooms only get tiles
  when a VOD exists; tiles use thumbnail → host avatar → gradient.

**Rooms & presence**
- Room topbar is a broadcast-style scrim integrated into the scene (no
  glass card). Self-view is mirrored in EVERY surface (stage, layouts,
  dock) — screens never mirrored. Flat layouts clear the 3D scene's
  stage panels + medallion (no ghost mini-cards). Lantern ring is a
  true 36° mirror-symmetric ring (lanternRing.test.ts pins it).
- Presence has an "in queue" state (user_presence.queued via
  touch_presence(p_room, p_queued) — OLD single-arg signature DROPPED;
  friends list shows In a room / In queue / Online / Offline).
- Host-gone backstop: end_hostless_rooms stamps host_left_at itself
  when a live room's host has no presence heartbeat for 2+ min (beacon
  missed / crash); pg_cron 'room-lifecycle' runs it every minute — the
  Vercel CRON_SECRET is NOT needed for lifecycle (still needed for the
  maintenance/digest routes).

**"Debate" is retired site-wide** — ~100 UI strings, email + push copy,
SQL-generated copy (people-suggestion reasons, error messages), FORMATS
label, meta tags, communities renamed. Identifiers/tables/CSS keep the
old names on purpose. Fictional seed handles (SocraticDebates…) kept.

**Design pass (all deployed or in this push)**
- Solid pill button system everywhere: queue Join (solid #2f7fe0 /
  gold instant), News cards, replay Discussion, Explore cards, create
  modal chips, legacy modal. Explore FILTER pills: translucent idle +
  solid active (deliberate).
- **Hover-rail sidebar**: rests 64px icon rail, expands to 240px on
  hover/keyboard; --sidebar-width is a REGISTERED TRANSITIONED custom
  property (unlayered in globals.css — it must beat the layered
  mvp-home copy on the profile route), so the whole layout resizes with
  it. Active tab = warm fill + amber icon in a mirrored rounded box
  (46px, 9px each side); the gold indicator bar is retired. Uses
  :focus-visible not :focus-within (clicks were pinning it open).
  <900px drawer untouched.
- POPULAR ROOMS header = exact logo blue #3e7dff (sampled from the
  wordmark), SCHEDULED = violet #8b5cf6, section headers 13px. Room
  title scrim, avatar menu near-black #0e0e12, News page scales with
  the window (inline container spacing — MVP reset eats Tailwind
  px-8/max-w-[…]), hero "Read at ⟨outlet⟩" pill never wraps (short
  label + font autoshrink), navbar search inner-box CSS conflict fixed,
  AS favicon/icon/apple-icon cut from the real wordmark glyphs.

**Watchouts discovered (add to the permanent list)**
- **Turbopack served STALE compiled globals.css across restarts** —
  `rm -rf .next` is the only fix; suspect it whenever an appended CSS
  rule "doesn't apply".
- Unlayered globals.css declarations beat everything from mvp-home.css
  on routes that import it via @layer (profile) — put cross-route
  tokens in globals.css, unlayered.
- :focus-within on hover-UI pins open after clicks; use :focus-visible.
- get_people_suggestions-style user-visible strings live in SQL —
  copy sweeps must include pg_proc definitions.
- clips INSERT is client-side RLS; verify policy allows uploader_id =
  auth.uid() rows without video_url (worked in testing).

**Still open (pre-launch list, in order)**: LiveKit webhook config
(dashboard → /api/webhook/livekit — NOW THE TOP ITEM: instant
host-leave detection); verify recording length bug (above); founders'
signed-in QA (queue→duel→record→replay→clip loop); mobile pass;
moderation queue + blocklist on posts/comments/DMs; rate limits;
ToS/privacy + consent default; GoTrue password hook; secrets rotation
(R2 — also purge orphaned segments — Twitch, NewsData); CRON_SECRET +
PostHog; OG tags for /posts and /replays; beta-gate exit plan; content
seeding beyond queue questions; LiveKit spend alert. Subscription
shape agreed in principle: storage/retention/1080p/restream/seats
bundle ~$8-10/mo; storage allowance already enforced.

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
4. **GitHub CI — DONE 08-22.** `.github/workflows/ci.yml` runs `tsc` →
   `vitest` → `next build` on every push to `main` and every PR (repo
   vars `NEXT_PUBLIC_SUPABASE_URL/ANON_KEY`). Vercel **Preview** now has
   the Supabase public vars, so branch deploys build. CI reports but does
   not block — branch protection on `main` not enabled (would force PRs).

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

**Repo lives at `/Users/jordanjaca/Agora`** (since 08-26 — the old
`~/Downloads/Agora-main` is orphaned after a macOS TCC lockout; delete
it). Git + `gh` as `jordangivenchy` (repo-local identity set to
jordanjaca06@gmail.com); Vercel via `npx vercel` (redeploy is
permission-blocked for Claude — Jordan clicks Redeploy; `vercel env pull`
redacts sensitive values). Supabase MCP applies migrations. Branches:
`main` = production; `jordan/dev` is kept in sync with `main` (force-
updated after each push); `alan/dev` = Alan's branch (merged to main).
