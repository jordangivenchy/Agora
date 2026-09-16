/* Motions drafted from a headline — the app's half.

   A headline reports something that happened; a motion is a claim
   someone can refuse, and the queue matches two people on opposite
   sides of one. The drafting is the website's (api/news/motions, from
   the story rather than the article so everyone reading it is offered
   the same sentence); this is the shapes, the check and the call.

   Mirrors src/lib/motions.ts on the site — the prompt itself lives
   there, since the drafting is the website's. */

import { apiFetch, type ApiAuth } from "./api";

export type MotionShape = "policy" | "judgment" | "prediction" | "priority";

export const MOTION_SHAPES: { key: MotionShape; label: string }[] = [
  { key: "policy", label: "What to do" },
  { key: "judgment", label: "Was it right" },
  { key: "prediction", label: "What follows" },
  { key: "priority", label: "What matters more" },
];

export interface DraftedMotion {
  shape: MotionShape;
  text: string;
}

/** The DB's own limits on debate_topics.question. */
export const MOTION_MIN = 5;
export const MOTION_MAX = 200;

const OPENERS = /^(should|is|are|was|were|do|does|did|can|could|must|will|would|has|have|ought)\b/i;
/* "First Thing: …", "Analysis: …" — a newsletter's label, not the story. */
const PREFIX = /^[A-Z][A-Za-z' ]{2,20}:\s/;

/** What's wrong with this as a motion, in words to show the writer. */
export function motionProblem(raw: string): string | null {
  const text = raw.trim().replace(/\s+/g, " ");
  if (text.length < MOTION_MIN) return "Write the question you want to take a side on.";
  if (text.length > MOTION_MAX) return `Keep it under ${MOTION_MAX} characters.`;
  if (PREFIX.test(text)) return "Drop the “First Thing:” part — just the question.";
  if (!text.endsWith("?")) return "Make it a question — one people can answer yes or no.";
  if (!OPENERS.test(text)) return "Start with Should, Is, Will or Does, so there's a side to take.";
  return null;
}

export const shapeLabel = (shape: string): string =>
  MOTION_SHAPES.find((s) => s.key === shape)?.label ?? "";

export interface MotionStory {
  headline: string;
  summary?: string | null;
  category?: string | null;
}

/* The questions for a story, or an empty list when it carries no
   argument — a verdict, a death. Null is the call itself failing. */
export async function fetchMotions(story: MotionStory, auth: ApiAuth): Promise<DraftedMotion[] | null> {
  const res = await apiFetch("/api/news/motions", auth, {
    method: "POST",
    body: JSON.stringify({ headline: story.headline, summary: story.summary ?? null, category: story.category ?? null }),
  }).catch(() => null);
  if (!res?.ok) return null;
  const body = (await res.json().catch(() => null)) as { motions?: DraftedMotion[] } | null;
  return Array.isArray(body?.motions) ? body.motions : null;
}
