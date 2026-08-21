# Agora User Data Platform — Developer Reference

Internal reference for the team. Documents the tables, security model, and
libraries that make up Agora's user data platform — the system that builds a
per-user data profile from app behavior and debate participation, and turns it
into personalized recommendations and coaching (the "persona notes & coach"
feature).

This is documentation of **our own data model, for our own developers**. It is
not a data-sale package and the platform is not designed to export personal
data to third parties.

## Design principles

Every table and code path honors these. They are not optional.

1. **Consent-gated.** Nothing is collected or derived until the user opts in,
   per category, via `user_data_consent` (all flags default `false`). Server
   code checks `has_data_consent()` / `hasConsent()` before writing.
2. **For the user, not just about them.** Every derived row is readable by its
   owner (RLS `select = auth.uid()`). No hidden dossiers.
3. **Expressed, not secretly inferred.** `debate_positions` records what a user
   *actually argued*, with evidence pointers to their own utterances. We do not
   infer unstated beliefs or build political/psychological classifications.
4. **Service-role writes.** Derived tables have no user insert/update policy —
   only the server writes them. A client can never forge a profile or read
   another user's.
5. **Erasable & exportable.** `export_user_data()` and `erase_user_data()` give
   each user a real "download everything" and "delete everything derived" path,
   hard-scoped to `auth.uid()`.

## Tables

Migration: `supabase/migrations/20260818_user_data_platform.sql`.

| Table | Holds | Written by | Read by owner |
|---|---|---|---|
| `user_data_consent` | Per-category opt-in flags | the user | ✅ (+ writes own) |
| `user_signals` | Behavioral event log (view/click/like/watch/dwell/…) | server (`/api/signals`) | ✅ |
| `debate_positions` | Stances the user *expressed*, with evidence utterance ids | server (transcript pipeline) | ✅ |
| `debate_personas` | Argument-style profile (pre-existing, 20260816) | server | ✅ |
| `user_data_profiles` | The synthesized, accessible profile | server (`profile/refresh`) | ✅ |
| `user_recommendations` | Ranked feed + rationale | server (`personalization/recompute`) | ✅ |
| `user_coach_notes` | Persona notes & coaching | server (`coach/notes`) | ✅ |

Functions: `has_data_consent(user_id, category)`, `export_user_data()`,
`erase_user_data()`.

## Consent categories

`analytics` (behavioral signals) · `debate_analysis` (transcript → argument
style + positions) · `personalization` (recommendations) · `coaching` (profile
synthesis + coach notes). Each write path gates on exactly one.

## Libraries (the workstreams)

All types and the consent gate live in `src/lib/dataPlatform/contract.ts`.

**Capture & storage** — `src/lib/capture/`, `src/lib/positions/`
- `capture/track.ts` — client `track(signal)`; batches → `POST /api/signals`.
  Call `setCaptureEnabled(consent.analytics)` from the consent boot.
- `capture/batch.ts` — pure coalescing/sanitizing (tested).
- `positions/extract.ts` — `extractPositions()` distills expressed stances from
  a debater's utterances; pure `parsePositions()` is tested.

**Profile synthesis & learning science** — `src/lib/profile/`
- `synthesize.ts` — pure fold → `UserDataProfile`.
- `learningStyle.ts` — evidence-based reasoning/learning dimensions from
  observed behavior (not VARK). Strengths-first, with growth steps.
- `refresh.ts` — `refreshUserProfile(admin, userId)`; gated on `coaching`.

**Personalization & coaching** — `src/lib/personalization/`, `src/lib/coach/`
- `personalization/rank.ts` — pure `rankRecommendations(profile, candidates)`,
  every pick carries a transparent rationale.
- `personalization/recompute.ts` — reads profile, ranks, upserts; gated on
  `personalization`. Caller supplies the candidate set.
- `coach/notes.ts` — `generateCoachNotes(admin, userId, generate)`; gated on
  `coaching`. Pure `parseCoachNotes()` is tested.

## Data flow

```
app usage ──track()──► /api/signals ──► user_signals ─┐
debate mic ─transcript─► extractPositions ─► debate_positions ─┤
                        (persona layer) ─► debate_personas ────┤
                                                               ▼
                                        profile/refresh ─► user_data_profiles
                                                               │
                                   ┌───────────────────────────┼───────────────┐
                                   ▼                           ▼               ▼
                        personalization/recompute      coach/notes     "what Agora knows"
                        ─► user_recommendations   ─► user_coach_notes    (export_user_data)
```

## Consuming this in a future feature

- **Feed / discovery:** read `user_recommendations.ranked[<type>]` for ids and
  `rationale[id]` for the "why" chip. Fall back to base ordering if absent.
- **Persona notes & coach UI:** read `user_coach_notes` (newest first) and the
  `user_data_profiles.learning_style` / `highlights` for the profile view.
- **"What Agora knows about me":** call `export_user_data()` (returns the
  caller's full footprint) for the transparency/download page; wire the
  delete button to `erase_user_data()`.
- Always check the user's consent flags before showing a surface that implies
  collection.
