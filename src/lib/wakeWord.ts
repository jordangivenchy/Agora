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
    const firstWord = rest.split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, "");
    if (firstWord && ASK_STARTERS.has(firstWord)) {
      return { kind: "question", question: rest };
    }
  }

  return null;
}
