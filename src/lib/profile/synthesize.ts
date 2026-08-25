/**
 * Profile synthesis: fold behavioral signals, argument style, expressed
 * positions, and learning style into one accessible UserDataProfile — the
 * "clean, efficient profile" a user (and the coach) can read.
 *
 * Pure core: no DB, no model. refresh.ts wires it to the tables. A model may
 * later polish `highlights` into prose, but the deterministic version here is
 * always the fallback so a profile is never empty.
 */

import type { UserDataProfile, UserSignal, DebatePosition } from "@/lib/dataPlatform/contract";
import { deriveLearningStyle, type LearningStyle } from "./learningStyle";

export interface BehaviorRollup {
  top_topics: { topic: string; weight: number }[];
  content_preferences: Record<string, number>; // subject_type → share
  engagement_events: number;
}

/** Roll a raw signal log into a compact behavioral summary. */
export function synthesizeBehavior(signals: UserSignal[]): BehaviorRollup {
  const topicWeight = new Map<string, number>();
  const typeCount = new Map<string, number>();

  for (const s of signals) {
    // Weight: engaged actions (watch/dwell/like/follow) count more than a view.
    const w = s.kind === "view" ? 1 : s.kind === "like" || s.kind === "follow" ? 4 : 2 + (s.value ? Math.min(s.value / 30, 3) : 0);
    if (s.topicKey) topicWeight.set(s.topicKey, (topicWeight.get(s.topicKey) ?? 0) + w);
    if (s.subjectType) typeCount.set(s.subjectType, (typeCount.get(s.subjectType) ?? 0) + 1);
  }

  const totalType = [...typeCount.values()].reduce((a, b) => a + b, 0) || 1;
  const content_preferences: Record<string, number> = {};
  for (const [t, c] of typeCount) content_preferences[t] = Math.round((c / totalType) * 100) / 100;

  const top_topics = [...topicWeight.entries()]
    .map(([topic, weight]) => ({ topic, weight: Math.round(weight * 10) / 10 }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 8);

  return { top_topics, content_preferences, engagement_events: signals.length };
}

/** Compact index of expressed positions: topic → { stance, summary }. */
function summarizePositions(positions: DebatePosition[]): Record<string, unknown> {
  const byTopic: Record<string, { stance: string | null; summary: string }[]> = {};
  for (const p of positions) {
    (byTopic[p.topicKey] ??= []).push({ stance: p.stance, summary: p.summary });
  }
  return byTopic;
}

/** Build the deterministic, user-facing highlight lines. */
function buildHighlights(
  behavior: BehaviorRollup,
  learning: LearningStyle,
  positions: DebatePosition[]
): string[] {
  const out: string[] = [];
  if (behavior.top_topics.length) {
    out.push(`You engage most with ${behavior.top_topics.slice(0, 2).map((t) => t.topic).join(" and ")} discussions.`);
  }
  // Lead with the learner's strongest observed dimension.
  const strongest = Object.values(learning).sort((a, b) => b.score - a.score)[0];
  if (strongest) out.push(strongest.explanation);
  if (positions.length) {
    out.push(`You've argued positions on ${new Set(positions.map((p) => p.topicKey)).size} topic(s) — revisit them anytime.`);
  }
  return out.slice(0, 3);
}

export function synthesizeProfile(input: {
  signals: UserSignal[];
  argumentStyle: { styles?: Record<string, number>; counts?: Record<string, number> } | null;
  positions: DebatePosition[];
}): UserDataProfile {
  const behavior = synthesizeBehavior(input.signals);
  const learning = deriveLearningStyle(input.argumentStyle, input.positions.length, input.signals.length);
  return {
    behavior: behavior as unknown as Record<string, unknown>,
    argument_style: (input.argumentStyle ?? {}) as Record<string, unknown>,
    learning_style: learning as unknown as Record<string, unknown>,
    positions_summary: summarizePositions(input.positions),
    highlights: buildHighlights(behavior, learning, input.positions),
    signals_count: input.signals.length,
  };
}
