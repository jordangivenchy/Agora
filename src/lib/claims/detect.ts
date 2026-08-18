/**
 * Screens live-transcript utterances for checkable factual claims, so the
 * expensive fact-check (retrieval + model call) only runs on sentences that
 * could actually be wrong about the world. Pure logic — the transcript route
 * calls this on every batch; anything scoring past the threshold goes to
 * the model for a verdict.
 *
 * Philosophy: opinions, values, predictions, and questions are debate — not
 * Agora's business. Numbers, dates, named entities, and "studies show"
 * assertions are checkable. We'd rather miss a claim than interrupt a
 * debater over rhetoric.
 */

export interface ClaimCandidate {
  text: string;
  score: number;
  signals: string[];
}

const OPINION_MARKERS =
  /\b(i think|i believe|i feel|in my (view|opinion)|to me|personally|probably|maybe|might|should|ought to|i'd argue|seems like|imagine|suppose)\b/i;

const QUESTION_START = /^\s*(who|what|when|where|why|how|is|are|was|were|do|does|did|can|could|would|will|should)\b.*\?\s*$/i;

const FIRST_PERSON_ANECDOTE = /\b(i|we|my|our)\b\s+(went|saw|did|met|tried|remember|grew)\b/i;

/** Signals that a sentence asserts something about the checkable world. */
const FACT_SIGNALS: { name: string; pattern: RegExp; weight: number }[] = [
  { name: "number", pattern: /\b\d[\d,.]*\s*(%|percent|million|billion|thousand|trillion)?\b/i, weight: 0.35 },
  { name: "year", pattern: /\b(1[5-9]\d\d|20\d\d)s?\b/, weight: 0.3 },
  { name: "citation", pattern: /\b(study|studies|research|report|survey|data|statistics?|according to|found that|shows? that|proved?|evidence)\b/i, weight: 0.35 },
  { name: "superlative", pattern: /\b(first|only|never|always|every|no one|nobody|all|none|most|least|highest|lowest|biggest|smallest|largest)\b/i, weight: 0.2 },
  { name: "named-entity", pattern: /\b[A-Z][a-z]+(\s[A-Z][a-z]+)+\b|\b(UN|EU|US|UK|NATO|WHO|GDP|CO2)\b/, weight: 0.2 },
  { name: "definitive-verb", pattern: /\b(is|are|was|were|has|have|had|causes?|caused|led to|resulted in|increased|decreased|rose|fell|banned|legalized|invented|discovered|signed|abolished)\b/i, weight: 0.15 },
];

export const CLAIM_THRESHOLD = 0.5;
const MIN_WORDS = 5;

/** Split an utterance into rough sentences so one spoken run-on can carry
    several claims and each gets scored on its own. */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\s*[;]\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function scoreClaim(sentence: string): ClaimCandidate {
  const signals: string[] = [];
  let score = 0;

  const words = sentence.trim().split(/\s+/).length;
  if (words < MIN_WORDS || QUESTION_START.test(sentence)) {
    return { text: sentence, score: 0, signals };
  }

  for (const { name, pattern, weight } of FACT_SIGNALS) {
    if (pattern.test(sentence)) {
      signals.push(name);
      score += weight;
    }
  }

  // Universal assertions ("X has always banned Y", "no country has ever...")
  // are checkable even without numbers — the superlative + definitive verb
  // combination is the tell.
  if (signals.includes("superlative") && signals.includes("definitive-verb")) {
    signals.push("universal-assertion");
    score += 0.15;
  }

  // Hedged or personal statements are arguments, not claims to police.
  if (OPINION_MARKERS.test(sentence)) {
    signals.push("opinion-hedge");
    score *= 0.3;
  }
  if (FIRST_PERSON_ANECDOTE.test(sentence)) {
    signals.push("anecdote");
    score *= 0.5;
  }

  return { text: sentence, score: Math.min(1, score), signals };
}

/** All sentences in an utterance worth sending to the fact-checker,
    strongest first. */
export function findClaimCandidates(utterance: string): ClaimCandidate[] {
  return splitSentences(utterance)
    .map(scoreClaim)
    .filter((c) => c.score >= CLAIM_THRESHOLD)
    .sort((a, b) => b.score - a.score);
}
