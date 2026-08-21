/**
 * Wake-phrase detection for the Agora assistant, shared by the stage
 * transcription stream and the classic hands-free loop.
 *
 * Two triggers:
 *   "hey agora …"  — anywhere in an utterance. Unambiguous, so it always
 *                    wins and carries everything after it as the question.
 *   "agora …"      — bare wake word, but ONLY when the utterance starts
 *                    with it AND continues like an address ("Agora, what's
 *                    the GDP of France?"). The platform itself is called
 *                    Agora, so mid-sentence mentions ("…here on Agora…") and
 *                    subject uses ("Agora is a great place to debate") must
 *                    never trigger. That's also why is/are/was/were don't
 *                    count as ask-starters: "Agora is…" is nearly always the
 *                    speaker talking ABOUT Agora, not TO it — those asks
 *                    still work via "hey Agora".
 */

export type WakeResult =
  | { kind: "question"; question: string }
  | { kind: "open" } // wake word alone — open the panel, no question
  | null;

const HEY_AGORA = /\bhey,?\s+agora\b[,.!?]?\s*(.*)/i;
const BARE_AGORA = /^\s*agora\b[,.!?]?\s+(.+)$/i;
const BARE_AGORA_ALONE = /^\s*agora[,.!?]?\s*$/i;

/** Words that make a bare "Agora …" read as an address rather than the
    start of a sentence about the platform. */
const ASK_STARTERS = new Set([
  "what", "whats", "who", "whos", "when", "where", "why", "how",
  "can", "could", "would", "should", "will", "do", "does", "did",
  "tell", "explain", "define", "describe", "check", "verify", "fact",
  "give", "show", "list", "compare", "summarize", "summarise", "help",
  "remind", "look", "find", "search", "settle", "confirm",
]);

/** Copulas that open BOTH questions ("is this true?") and statements about
    the platform ("is a great place") — they need a second signal. */
const COPULAS = new Set(["is", "are", "was", "were"]);

/** Words that follow a copula in inverted questions but (practically) never
    in declaratives whose subject is Agora. */
const INVERSION_CUES = new Set([
  "this", "that", "these", "those", "it", "there",
  "he", "she", "they", "we", "you", "i",
  "anyone", "anybody", "everyone", "everybody", "something", "anything",
]);

export function extractWake(text: string): WakeResult {
  const hey = text.match(HEY_AGORA);
  if (hey) {
    const q = hey[1]?.trim();
    return q ? { kind: "question", question: q } : { kind: "open" };
  }

  if (BARE_AGORA_ALONE.test(text)) return { kind: "open" };

  const bare = text.match(BARE_AGORA);
  if (bare) {
    const rest = bare[1].trim();
    // Normalize hard: "What's" → "whats", so contractions hit the allowlist.
    const words = rest.split(/\s+/).map((w) => w.toLowerCase().replace(/[^a-z]/g, ""));
    const firstWord = words[0];
    if (firstWord && ASK_STARTERS.has(firstWord)) {
      return { kind: "question", question: rest };
    }
    // "Agora is/are/was/were …" is usually ABOUT the platform — except when
    // it's phrased as a question. Two tells we can read from bare text:
    //   * the recognizer emitted a question mark, or
    //   * inverted question syntax — the copula is followed by a pronoun or
    //     demonstrative ("is THIS claim true", "was IT ever repealed"),
    //     which declaratives about Agora ("is A great place", "is THE best
    //     platform") don't produce.
    if (firstWord && COPULAS.has(firstWord)) {
      const questionish =
        /\?\s*$/.test(rest) || (words[1] !== undefined && INVERSION_CUES.has(words[1]));
      if (questionish) return { kind: "question", question: rest };
    }
  }

  return null;
}
