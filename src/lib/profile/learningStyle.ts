/**
 * Learning & reasoning style, derived from OBSERVED debate behavior. This
 * feeds the future persona-notes-and-coach: "given how you actually argue and
 * engage, here's how you seem to reason best, and where to grow."
 *
 * Grounding — deliberately NOT the debunked VARK "visual/auditory/
 * kinesthetic learning styles" myth (no credible evidence tailoring to those
 * improves learning). Instead these are dimensions with real support in the
 * learning-sciences literature, each mapped from behavior we can actually
 * observe in a debate:
 *
 *   evidence_grounding    reasoning from evidence vs. from prior conviction
 *                         (argumentation quality; calibration research)
 *   concrete_vs_abstract  learns/argues via concrete cases vs. abstract
 *                         principles (concreteness-fading; example-based
 *                         reasoning)
 *   revises_under_challenge  updates beliefs when a counterargument lands
 *                         (active open-minded thinking; belief updating)
 *   inquiry_seeking       asks questions / requests evidence vs. asserting
 *                         (self-explanation & question-driven learning)
 *   structured_reasoning  builds structured, sequenced arguments vs.
 *                         associative leaps (schema / organization effects)
 *
 * Each is a 0..1 tendency with a plain-language, strengths-first explanation
 * and a growth suggestion. Never a fixed label, never a deficit verdict.
 */

export interface LearningDimension {
  score: number;          // 0..1 observed tendency
  label: string;          // short human tag
  explanation: string;    // user-facing, strengths-first
  growth: string;         // one concrete way to stretch
}

export type LearningStyle = Record<string, LearningDimension>;

/** The debate_personas.profile.styles shape we read from. */
interface ArgumentStyle {
  styles?: Record<string, number>;
  counts?: Record<string, number>;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));
}

function dim(score: number, label: string, high: string, low: string, growthHigh: string, growthLow: string): LearningDimension {
  const s = clamp01(score);
  const leaning = s >= 0.5;
  return {
    score: Math.round(s * 100) / 100,
    label,
    explanation: leaning ? high : low,
    growth: leaning ? growthHigh : growthLow,
  };
}

/**
 * Map observed argument style (and, lightly, engagement signals) to learning
 * dimensions. Missing inputs yield neutral 0.5 dimensions rather than errors.
 */
export function deriveLearningStyle(
  argumentStyle: ArgumentStyle | null | undefined,
  _positionsCount = 0,
  _signalsCount = 0
): LearningStyle {
  const s = argumentStyle?.styles ?? {};
  const g = (k: string, fallback = 0.5) => (typeof s[k] === "number" ? clamp01(s[k]) : fallback);

  // evidence_grounding: how much they lean on evidence vs. unsupported assertion.
  const evidence = g("evidence_driven");

  // concrete_vs_abstract: anecdotal/concrete high → concrete; logical_structure
  // dominant with low anecdote → abstract. Centered at 0.5.
  const concrete = clamp01(0.5 + (g("anecdotal") - g("logical_structure")) * 0.5);

  // revises_under_challenge: derived from how often they concede / engage
  // counterarguments (logical_structure bucket also carries these moves).
  const revises = g("logical_structure");

  // inquiry_seeking: questioning tendency.
  const inquiry = g("questioning");

  // structured_reasoning: structured argument construction.
  const structured = g("logical_structure");

  return {
    evidence_grounding: dim(
      evidence, "evidence-grounded",
      "You tend to back your points with evidence and sources — a real strength for persuading skeptical audiences.",
      "You often reason from conviction more than cited evidence, which reads as confident but is easy to challenge.",
      "Push further: when you cite, name the specific study or number so it can't be waved away.",
      "Try grounding one key claim per discussion in a concrete source — it makes your strongest points unshakeable."
    ),
    concrete_vs_abstract: dim(
      concrete, "concrete-example-driven",
      "You reason best from concrete examples and cases, which makes your arguments vivid and relatable.",
      "You reason best from abstract principles, which gives your arguments reach and structure.",
      "Pair a concrete case with the principle behind it — the principle is what generalizes your point.",
      "Ground an abstract principle in one concrete example — the example is what makes it land for the room."
    ),
    revises_under_challenge: dim(
      revises, "updates-under-challenge",
      "You engage counterarguments and adjust — a sign of genuine reasoning, not just winning.",
      "You tend to hold your line under pressure, which is forceful but can miss a chance to strengthen your case.",
      "Keep it up, and name what changed your mind aloud — audiences trust speakers who visibly reason.",
      "When a counterpoint lands, try conceding the narrow point and re-anchoring — it disarms and strengthens you."
    ),
    inquiry_seeking: dim(
      inquiry, "inquiry-driven",
      "You learn and argue by asking sharp questions and requesting evidence — a powerful way to control an exchange.",
      "You tend to assert more than ask; direct, but you may leave your opponent's weak points unprobed.",
      "Channel it: use one question to set a trap you then close with evidence.",
      "Try opening with a question that exposes the gap in the other side before you make your own case."
    ),
    structured_reasoning: dim(
      structured, "structured",
      "You build arguments in clear, sequenced steps — easy to follow and hard to derail.",
      "Your reasoning is more associative than sequenced — creative, but sometimes hard for the room to track.",
      "Signpost your steps ('first… second…') so judges can follow your strongest chain.",
      "Try outlining three points before you speak — structure turns good instincts into a case people can score."
    ),
  };
}
