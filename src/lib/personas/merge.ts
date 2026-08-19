/**
 * Argumentation persona profiles: the shape Agora maintains per user, and
 * the pure merge of one batch-analysis delta into the stored profile.
 *
 * The analyzer (Gemini, see /api/agora/transcript) looks at a batch of a
 * speaker's utterances and returns a PersonaDelta — counts of argumentation
 * moves it observed. Merging is additive with exponential decay on style
 * ratios, so a debater who stops leaning on anecdotes sees their profile
 * drift with them instead of being haunted by month-old habits.
 *
 * Everything here is deliberately observable-behavior only: HOW someone
 * argues (evidence use, structure, engagement), never inferred demographics
 * or beliefs. The profile is shown to its own user verbatim.
 */

export interface PersonaProfile {
  /** Rolling ratios 0..1 per argumentation style dimension. */
  styles: Record<string, number>;
  /** Lifetime counts of concrete observed moves. */
  counts: Record<string, number>;
  /** Short model-written observations, most recent first (capped). */
  notes: string[];
  /** Topic keys this user debates, with utterance counts. */
  topics: Record<string, number>;
}

export interface PersonaDelta {
  /** Moves observed in this batch, e.g. { cites_evidence: 3, anecdote: 1 }. */
  moves: Record<string, number>;
  /** One fresh observation sentence about this batch, if notable. */
  note?: string;
  topicKey?: string | null;
  utterances: number;
}

/** Dimensions the UI knows how to render; unknown move names still count
    into `counts` but don't create style ratios. */
export const STYLE_DIMENSIONS: Record<string, string[]> = {
  evidence_driven: ["cites_evidence", "cites_statistic", "cites_study"],
  anecdotal: ["anecdote", "personal_experience"],
  logical_structure: ["structured_argument", "addresses_counterargument", "concession"],
  emotional_appeal: ["emotional_appeal", "moral_framing"],
  aggressive: ["interrupts", "ad_hominem", "dismissal"],
  questioning: ["asks_question", "requests_evidence"],
};

const NOTE_CAP = 12;
/** Weight of history vs the new batch when updating style ratios. */
const DECAY = 0.85;

export function emptyProfile(): PersonaProfile {
  return { styles: {}, counts: {}, notes: [], topics: {} };
}

/** Defensive read of a stored jsonb profile — tolerates missing keys from
    older analyzer versions. */
export function normalizeProfile(raw: unknown): PersonaProfile {
  const p = (raw ?? {}) as Partial<PersonaProfile>;
  return {
    styles: typeof p.styles === "object" && p.styles !== null ? { ...p.styles } : {},
    counts: typeof p.counts === "object" && p.counts !== null ? { ...p.counts } : {},
    notes: Array.isArray(p.notes) ? p.notes.slice(0, NOTE_CAP) : [],
    topics: typeof p.topics === "object" && p.topics !== null ? { ...p.topics } : {},
  };
}

export function mergePersona(stored: unknown, delta: PersonaDelta): PersonaProfile {
  const profile = normalizeProfile(stored);

  // Lifetime move counts are simply additive.
  for (const [move, n] of Object.entries(delta.moves)) {
    if (n > 0) profile.counts[move] = (profile.counts[move] ?? 0) + n;
  }

  // Style ratios: what share of this batch's utterances showed each
  // dimension, folded into history with decay.
  const batchSize = Math.max(1, delta.utterances);
  for (const [dimension, moves] of Object.entries(STYLE_DIMENSIONS)) {
    const observed = moves.reduce((sum, m) => sum + (delta.moves[m] ?? 0), 0);
    const batchRatio = Math.min(1, observed / batchSize);
    const prior = profile.styles[dimension];
    profile.styles[dimension] =
      prior === undefined
        ? batchRatio
        : Math.round((prior * DECAY + batchRatio * (1 - DECAY)) * 1000) / 1000;
  }

  if (delta.note && delta.note.trim()) {
    profile.notes = [delta.note.trim(), ...profile.notes].slice(0, NOTE_CAP);
  }
  if (delta.topicKey) {
    profile.topics[delta.topicKey] = (profile.topics[delta.topicKey] ?? 0) + delta.utterances;
  }

  return profile;
}

/** Parse the analyzer model's JSON reply into a safe delta. Returns null if
    the reply is unusable — the caller then just skips this batch. */
export function parseDelta(modelJson: string, utterances: number, topicKey: string | null): PersonaDelta | null {
  try {
    const raw = JSON.parse(modelJson) as { moves?: Record<string, unknown>; note?: unknown };
    if (!raw || typeof raw !== "object" || typeof raw.moves !== "object" || raw.moves === null) return null;
    const moves: Record<string, number> = {};
    for (const [k, v] of Object.entries(raw.moves)) {
      const n = typeof v === "number" ? Math.floor(v) : NaN;
      // Cap per-batch counts so a hallucinated "cites_evidence: 9000"
      // can't poison a profile.
      if (Number.isFinite(n) && n > 0 && /^[a-z_]{2,40}$/.test(k)) {
        moves[k] = Math.min(n, utterances * 3);
      }
    }
    return {
      moves,
      note: typeof raw.note === "string" ? raw.note.slice(0, 240) : undefined,
      topicKey,
      utterances,
    };
  } catch {
    return null;
  }
}
