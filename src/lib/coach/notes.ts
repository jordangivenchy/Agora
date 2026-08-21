/**
 * The persona-notes-and-coach generator. From a user's synthesized profile
 * and expressed positions, produce specific, constructive, user-facing coach
 * notes — each with a concrete next step. This is the feature the whole data
 * platform exists to serve.
 *
 * Boundaries: the coach speaks to HOW the person argues and learns (their
 * observed style, their own past arguments), never lectures them about what
 * to believe. It is encouraging and specific, not generic praise.
 *
 * Pure parser (parseCoachNotes) is tested; generateCoachNotes wraps the model.
 */

import { hasConsent, type CoachNote, type CoachScope } from "@/lib/dataPlatform/contract";

export const COACH_SYSTEM = `You are Agora's debate coach. Given a debater's profile (their observed argument style, learning tendencies, and the positions they've actually argued), write specific, encouraging, actionable coaching notes. You coach HOW they argue and learn — never what they should believe.

Respond ONLY with JSON, no markdown fences:
{"notes": [{"scope": "general" | "debate" | "topic" | "skill", "scope_ref": "optional topic key or skill name", "note": "one specific observation about their debating", "suggestion": "one concrete thing to try next time"}]}

Rules:
- Ground every note in something in their profile. No generic advice that would fit anyone.
- Strengths-first and constructive; name a real strength before a growth area.
- Each suggestion is concrete and doable in their next debate.
- 2 to 4 notes. Never comment on the correctness of their opinions — only their craft.`;

const VALID_SCOPES = new Set<CoachScope>(["general", "debate", "topic", "skill"]);

interface RawNote {
  scope?: unknown;
  scope_ref?: unknown;
  note?: unknown;
  suggestion?: unknown;
}

/** Validate a model reply into CoachNote[]. Returns [] on unusable output. */
export function parseCoachNotes(modelJson: string): CoachNote[] {
  let raw: { notes?: unknown };
  try {
    raw = JSON.parse(modelJson.replace(/^```json?\s*|\s*```$/g, ""));
  } catch {
    return [];
  }
  if (!raw || !Array.isArray(raw.notes)) return [];

  const out: CoachNote[] = [];
  for (const n of raw.notes as RawNote[]) {
    const note = typeof n.note === "string" ? n.note.trim().slice(0, 600) : "";
    if (!note) continue;
    const scope: CoachScope = typeof n.scope === "string" && VALID_SCOPES.has(n.scope as CoachScope) ? (n.scope as CoachScope) : "general";
    out.push({
      scope,
      scopeRef: typeof n.scope_ref === "string" ? n.scope_ref.slice(0, 120) : null,
      note,
      suggestion: typeof n.suggestion === "string" ? n.suggestion.trim().slice(0, 400) : null,
    });
  }
  return out.slice(0, 4);
}

interface Admin {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
  from: (table: string) => {
    select: (cols: string) => { eq: (col: string, val: unknown) => { maybeSingle: () => PromiseLike<{ data: unknown }>; limit: (n: number) => PromiseLike<{ data: unknown }> } };
    insert: (rows: Record<string, unknown>[]) => PromiseLike<{ error: unknown }>;
  };
}

/**
 * Generate and store fresh coach notes for a user. Gated on 'coaching'
 * consent. `generate` is the provider's generateAnswer, injected.
 */
export async function generateCoachNotes(
  admin: Admin,
  userId: string,
  generate: (p: { system: string; history: []; question: string; maxOutputTokens?: number }) => Promise<{ answer: string }>
): Promise<number> {
  if (!(await hasConsent(admin, userId, "coaching"))) return 0;

  const prof = await admin.from("user_data_profiles").select("behavior, argument_style, learning_style, positions_summary").eq("user_id", userId).maybeSingle();
  const profile = prof.data as Record<string, unknown> | null;
  if (!profile) return 0;

  let answer: string;
  try {
    const res = await generate({
      system: COACH_SYSTEM,
      history: [],
      question: `Debater profile:\n${JSON.stringify(profile).slice(0, 4000)}`,
      maxOutputTokens: 700,
    });
    answer = res.answer;
  } catch {
    return 0;
  }

  const notes = parseCoachNotes(answer);
  if (notes.length === 0) return 0;

  const { error } = await admin.from("user_coach_notes").insert(
    notes.map((n) => ({
      user_id: userId,
      scope: n.scope,
      scope_ref: n.scopeRef ?? null,
      note: n.note,
      suggestion: n.suggestion ?? null,
    }))
  );
  if (error) {
    console.error("[coach] insert failed:", error);
    return 0;
  }
  return notes.length;
}
