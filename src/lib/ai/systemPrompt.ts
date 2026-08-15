/**
 * Assembles the system prompt for the Agora assistant. Pure — the route
 * gathers the pieces (scraped evidence, cached PostHog traits, motion) and this
 * module decides how they read to the model. Testable without any API.
 *
 * Layout matters for prompt caching: the stable persona comes first, volatile
 * per-request context (evidence, user profile) last, so providers that cache
 * by prefix reuse the persona across every request.
 */

export interface EvidenceItem {
  id: string;
  title: string;
  body: string | null;
  source: string;
  url: string | null;
  published_at: string | null;
}

export interface UserContext {
  /** PostHog person properties cached in user_preferences.traits. */
  traits: Record<string, unknown>;
  /** Explicit user settings; always win over inferred traits. */
  overrides: Record<string, unknown>;
}

/* The persona is the tuned prompt the product already ships with — kept
   verbatim so answer quality doesn't regress, with retrieval instructions
   appended. */
export const AGORA_PERSONA = `You are Agora, the neutral in-debate AI assistant on AgoraSphere, a live debate platform. Both debaters and the audience see your answers, so you never take a side on the motion.

Rules:
- Answer in 2 to 4 sentences. Debates move fast; be precise and quotable.
- When you state a fact or statistic, name your source inline: the study, author, institution, or dataset, with a year when you know it (e.g. "Finland's 2017-18 basic income pilot, per Kela's final report").
- If you are not confident, say so plainly and say what is uncertain. Never fabricate a citation.
- If a claim is contested in the literature, say what each side of the evidence shows.
- You may be asked to fact-check something a debater just said; assess the claim as stated, not the debater.
- Plain text only — no markdown headers or bullet lists; this renders in a small chat panel and is also read aloud.
- When the EVIDENCE section below contains relevant items, prefer citing them — they are fresher than your training data. Refer to them by their source name, never by their index number. Ignore evidence items that don't bear on the question.
- The USER CONTEXT section describes the person asking. Use it only to calibrate tone and depth (e.g. simpler phrasing for a newcomer, more technical for an experienced debater). It must never change the substance or neutrality of an answer.`;

const MAX_EVIDENCE_CHARS = 1200; // per item, keeps 6 items ≈ 2k tokens

/** Trait keys worth surfacing to the model. Everything else PostHog tracks
    (device ids, campaign params, raw event counts) is noise or PII we should
    not forward to a third-party model. */
const ALLOWED_TRAIT_KEYS = new Set([
  "favorite_topics",
  "debate_experience",
  "debates_watched",
  "debates_participated",
  "preferred_language",
  "preferred_answer_style",
  "curriculum",
]);

function sanitizeTraits(context: UserContext): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context.traits)) {
    if (ALLOWED_TRAIT_KEYS.has(key) && value != null) merged[key] = value;
  }
  // Explicit overrides win, same allowlist.
  for (const [key, value] of Object.entries(context.overrides)) {
    if (ALLOWED_TRAIT_KEYS.has(key) && value != null) merged[key] = value;
  }
  return merged;
}

export function formatEvidence(items: EvidenceItem[]): string {
  if (items.length === 0) return "";
  const blocks = items.map((item) => {
    const date = item.published_at ? ` (${item.published_at.slice(0, 10)})` : "";
    const body = item.body ? item.body.slice(0, MAX_EVIDENCE_CHARS) : "";
    return `- ${item.title} — ${item.source}${date}\n  ${body}`;
  });
  return `EVIDENCE — recently gathered material that may bear on the question:\n${blocks.join("\n")}`;
}

export function formatUserContext(context: UserContext): string {
  const traits = sanitizeTraits(context);
  if (Object.keys(traits).length === 0) return "";
  const lines = Object.entries(traits).map(
    ([key, value]) => `- ${key.replace(/_/g, " ")}: ${JSON.stringify(value)}`
  );
  return `USER CONTEXT — about the person asking (tone calibration only):\n${lines.join("\n")}`;
}

export function buildSystemPrompt(params: {
  evidence: EvidenceItem[];
  userContext: UserContext | null;
}): string {
  const sections = [AGORA_PERSONA];
  const evidence = formatEvidence(params.evidence);
  if (evidence) sections.push(evidence);
  if (params.userContext) {
    const user = formatUserContext(params.userContext);
    if (user) sections.push(user);
  }
  return sections.join("\n\n");
}

/** Deterministic cache key for a question. Two users asking the same thing
    about the same motion with the same evidence share one model call.
    Personalization is tone-only (see persona), so sharing is safe. */
export function responseCacheKey(params: {
  question: string;
  motion: string;
  evidenceIds: string[];
}): string {
  const normalizedQuestion = params.question.trim().toLowerCase().replace(/\s+/g, " ");
  const raw = `${normalizedQuestion}|${params.motion.trim().toLowerCase()}|${[...params.evidenceIds].sort().join(",")}`;
  // FNV-1a 64-bit-ish via two 32-bit passes — stable, dependency-free.
  let h1 = 0x811c9dc5;
  let h2 = 0xcbf29ce4;
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    h1 = ((h1 ^ c) * 0x01000193) >>> 0;
    h2 = ((h2 ^ c) * 0x01000197) >>> 0;
  }
  return `v1:${h1.toString(36)}${h2.toString(36)}`;
}
