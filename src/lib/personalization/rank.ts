/**
 * Personalized ranking: order candidate content (rooms, topics, people) by a
 * user's profile — with a transparent reason attached to every pick. No black
 * box: the score is a small, legible sum, and each recommendation carries a
 * one-line rationale the UI can show ("because you engage most with ethics").
 *
 * Cold start (empty profile) falls back to the candidates' own order/recency,
 * so a brand-new user still gets a sensible feed.
 */

import type { UserDataProfile, UserRecommendations } from "@/lib/dataPlatform/contract";

export interface Candidate {
  id: string;
  type: string;            // room | topic | user | clip
  topicKey?: string | null;
  /** Baseline desirability independent of the user (recency, liveness, popularity). */
  baseScore?: number;
  meta?: Record<string, unknown>;
}

interface Scored extends Candidate {
  score: number;
  reason: string;
}

/** Extract topic → weight from a profile's behavior rollup. */
function topicAffinity(profile: UserDataProfile | null): Map<string, number> {
  const m = new Map<string, number>();
  const top = (profile?.behavior as { top_topics?: { topic: string; weight: number }[] } | undefined)?.top_topics;
  if (Array.isArray(top)) {
    const max = Math.max(1, ...top.map((t) => t.weight));
    for (const t of top) m.set(t.topic, t.weight / max); // normalize 0..1
  }
  return m;
}

export function rankRecommendations(
  profile: UserDataProfile | null,
  candidates: Candidate[]
): UserRecommendations {
  const affinity = topicAffinity(profile);
  const hasSignal = affinity.size > 0;

  const scored: Scored[] = candidates.map((c) => {
    const base = typeof c.baseScore === "number" ? c.baseScore : 0;
    const aff = c.topicKey ? affinity.get(c.topicKey) ?? 0 : 0;
    // Affinity dominates when we know the user; base carries cold start.
    const score = hasSignal ? aff * 2 + base * 0.5 : base;
    const reason =
      hasSignal && aff > 0.15
        ? `Because you engage most with ${c.topicKey} discussions`
        : base > 0
          ? "Popular and active right now"
          : "New — worth a look";
    return { ...c, score: Math.round(score * 1000) / 1000, reason };
  });

  scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

  // Group ranked ids and rationale by candidate type for the surfaces to read.
  const ranked: Record<string, string[]> = {};
  const rationale: Record<string, string> = {};
  for (const s of scored) {
    (ranked[s.type] ??= []).push(s.id);
    rationale[s.id] = s.reason;
  }

  return { ranked, rationale };
}
