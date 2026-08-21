/**
 * Expressed-position extraction. From a user's OWN utterances in a debate,
 * distill the stance they actually argued on the motion — with pointers back
 * to the specific utterances it came from, so every position is traceable to
 * the user's own words and vanishes if they delete them.
 *
 * Hard boundaries (this is a coaching product, not a belief-inference engine):
 *   - Only positions the user EXPRESSED. Never infer unstated views, and
 *     never extrapolate to their stance on OTHER issues.
 *   - The summary is a neutral paraphrase of what they argued, not a
 *     judgment of it and not a psychological read of them.
 *   - Output is user-visible (debate_positions RLS = owner reads).
 *
 * The pure parser (parsePositions) is import-safe and tested; extractPositions
 * wraps it around the model call.
 */

import type { DebatePosition } from "@/lib/dataPlatform/contract";

export const POSITION_SYSTEM = `You read a single debater's spoken utterances from one debate and identify the position(s) they EXPRESSED on the motion. You are building the debater's own record of what they argued — not judging it, not inferring what they "really" believe, and never guessing their views on other topics.

Respond ONLY with JSON, no markdown fences:
{"positions": [{"stance": "PRO" | "CON" | "mixed" | "nuanced", "summary": "neutral one-to-two-sentence paraphrase of what they argued", "confidence": 0.0-1.0, "evidence_indexes": [<indexes of the utterances this came from>]}]}

Rules:
- Only include a position the debater actually stated or clearly argued. If they were mostly asking questions or the stance is unclear, return {"positions": []}.
- "summary" restates THEIR argument in neutral words. No evaluation, no "they seem to believe", no psychology.
- evidence_indexes are 0-based indexes into the numbered utterances provided.
- confidence is how clearly the stance was expressed, not how correct it is.
- Usually there is one position per motion; return more only if they genuinely argued distinct sub-positions.`;

interface RawPosition {
  stance?: unknown;
  summary?: unknown;
  confidence?: unknown;
  evidence_indexes?: unknown;
}

const VALID_STANCES = new Set(["PRO", "CON", "mixed", "nuanced"]);

/**
 * Validate a model reply into DebatePosition[]. `utteranceIds` maps evidence
 * indexes back to real utterance row ids. Returns [] on any unusable reply —
 * the caller then simply stores nothing for this batch.
 */
export function parsePositions(
  modelJson: string,
  utteranceIds: string[],
  ctx: { topicKey: string; motion: string | null; roomId?: string | null }
): DebatePosition[] {
  let raw: { positions?: unknown };
  try {
    raw = JSON.parse(modelJson.replace(/^```json?\s*|\s*```$/g, ""));
  } catch {
    return [];
  }
  if (!raw || !Array.isArray(raw.positions)) return [];

  const out: DebatePosition[] = [];
  for (const p of raw.positions as RawPosition[]) {
    const stance = typeof p.stance === "string" && VALID_STANCES.has(p.stance) ? p.stance : null;
    const summary = typeof p.summary === "string" ? p.summary.trim().slice(0, 600) : "";
    if (!summary) continue; // a position with no paraphrase is unusable

    const confidence =
      typeof p.confidence === "number" && Number.isFinite(p.confidence)
        ? Math.min(1, Math.max(0, p.confidence))
        : 0;

    // Map evidence indexes to real utterance ids, dropping out-of-range ones.
    const evidence: string[] = Array.isArray(p.evidence_indexes)
      ? (p.evidence_indexes as unknown[])
          .map((i) => (typeof i === "number" && utteranceIds[i] ? utteranceIds[i] : null))
          .filter((v): v is string => v !== null)
      : [];

    out.push({
      topicKey: ctx.topicKey,
      motion: ctx.motion,
      stance,
      summary,
      evidenceUtteranceIds: evidence,
      confidence,
      roomId: ctx.roomId ?? null,
    });
  }
  return out.slice(0, 4); // one motion rarely yields more than a few sub-positions
}

/**
 * Full extraction: format the user's utterances, call the model, parse.
 * `generate` is injected (the provider's generateAnswer) so this stays
 * decoupled and the parser above can be tested without a model.
 */
export async function extractPositions(params: {
  utterances: { id: string; content: string }[];
  motion: string | null;
  topicKey: string;
  roomId?: string | null;
  generate: (p: { system: string; history: []; question: string; maxOutputTokens?: number }) => Promise<{ answer: string }>;
}): Promise<DebatePosition[]> {
  if (params.utterances.length === 0) return [];
  const numbered = params.utterances.map((u, i) => `[${i}] ${u.content}`).join("\n");
  const question = `Motion: "${params.motion ?? "(none stated)"}"\n\nThe debater's utterances:\n${numbered}`;

  let answer: string;
  try {
    const res = await params.generate({
      system: POSITION_SYSTEM,
      history: [],
      question,
      maxOutputTokens: 500,
    });
    answer = res.answer;
  } catch {
    return [];
  }

  return parsePositions(answer, params.utterances.map((u) => u.id), {
    topicKey: params.topicKey,
    motion: params.motion,
    roomId: params.roomId,
  });
}
