/* Motions drafted from a headline.

   A headline reports something that happened; a motion is a claim
   someone can refuse. "Energy secretary says US might not reach nuclear
   agreement with Iran" has no other side to take, so a queue built on it
   waits forever — which is what ours did. This turns a story into four
   questions people can actually disagree about.

   Four shapes cover most of the news: what should be done, whether it
   was right, what follows, and what matters more. They are written as
   yes/no questions to match the 600 curated topics already in
   debate_topics ("Should college be tuition-free?") and the For/Against
   the queue offers.

   Drafting is keyed to the story, not the article, and cached: the
   queue matches people by the exact text of the question, so two people
   reading the same story have to be offered the same sentence or they
   end up in two queues of one. */

import { createHash } from "node:crypto";
import { titleTokens } from "@/lib/newsRank";

export type MotionShape = "policy" | "judgment" | "prediction" | "priority";

export const MOTION_SHAPES: { key: MotionShape; label: string; hint: string }[] = [
  { key: "policy", label: "What to do", hint: "Someone should act, or shouldn't" },
  { key: "judgment", label: "Was it right", hint: "Worth it, or not" },
  { key: "prediction", label: "What follows", hint: "What this leads to" },
  { key: "priority", label: "What matters more", hint: "This against that" },
];

export interface DraftedMotion {
  shape: MotionShape;
  text: string;
}

export interface MotionStory {
  headline: string;
  summary?: string | null;
  category?: string | null;
}

/** The DB's own limits on debate_topics.question. */
export const MOTION_MIN = 5;
export const MOTION_MAX = 200;
/** Long enough to be specific, short enough to read on a chip. */
export const MOTION_IDEAL_MAX = 120;

/* The story a headline belongs to, by the words that carry its meaning.
   The feed has already merged near-duplicate headlines into one story
   (lib/newsRank clusterStories), so this only has to stay steady as the
   feed refreshes — same story, same four questions, same queue. */
export function storyKey(headline: string): string {
  const signature = [...titleTokens(headline)].sort().join(" ");
  return createHash("sha256").update(signature || headline.toLowerCase().trim()).digest("hex").slice(0, 32);
}

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

/** Whether a drafted or typed motion is ready to queue on. */
export function motionOk(text: string): boolean {
  return motionProblem(text) === null;
}

export const MOTION_SYSTEM = `You turn a news story into questions people can take sides on at AgoraSphere, a live debate platform. Someone picks one of your questions, takes a side, and is matched with a person who takes the other.

Write exactly four questions about the story, one of each shape:
- policy: should someone act, and how
- judgment: was it right, was it worth it
- prediction: what this leads to, by when
- priority: whether one thing matters more than another

Rules:
- Every question must be answerable yes or no, and both answers must have a real case behind them. If nobody would take one side, the question is no good.
- Name who and what, concretely: "Should the EU fine carriers that…" beats "Should we do more about…". Never "we", "society" or "people".
- Ask what should follow, never what already happened. A verdict, a death toll or a share price can be looked up; those are not arguments.
- No loaded or emotive words, and no question that assumes its own answer.
- Plain words, the ones a person would use out loud. The story you are given is written in headline language and you must not copy it: no "rein in", "crack down", "curb", "slam", "blast", "vow", "spark", "mull", "eye", "soar", "plunge". Say what would actually happen instead — "Should the EU limit how much data AI firms can train on?", never "Should the EU rein in AI?".
- Under 120 characters. One sentence, ending in a question mark.
- Stay on the story you are given. Do not invent facts, numbers or quotes.

Some stories carry no argument at all — a death, a verdict already reached, a disaster with nobody to blame. When that is true, return an empty list rather than forcing a side.

Answer with JSON only, no prose and no code fence:
[{"shape":"policy","text":"…"},{"shape":"judgment","text":"…"},{"shape":"prediction","text":"…"},{"shape":"priority","text":"…"}]`;

/** The story as the model sees it. */
export function motionRequest(story: MotionStory): string {
  const parts = [`Headline: ${story.headline.trim()}`];
  const summary = (story.summary ?? "").trim();
  if (summary) parts.push(`Summary: ${summary}`);
  const category = (story.category ?? "").trim();
  if (category) parts.push(`Section: ${category}`);
  return parts.join("\n");
}

const SHAPES = new Set<string>(MOTION_SHAPES.map((s) => s.key));

/* A model that was told to answer in JSON mostly does; this survives the
   times it wraps the array in a fence or a sentence, and drops anything
   that wouldn't pass the same check a typed question has to pass. */
export function parseMotions(raw: string): DraftedMotion[] {
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: DraftedMotion[] = [];
  const seen = new Set<string>();
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const { shape, text } = item as { shape?: unknown; text?: unknown };
    if (typeof shape !== "string" || typeof text !== "string") continue;
    if (!SHAPES.has(shape)) continue;
    const clean = text.trim().replace(/\s+/g, " ");
    const key = clean.toLowerCase();
    if (!motionOk(clean) || seen.has(key)) continue;
    seen.add(key);
    out.push({ shape: shape as MotionShape, text: clean });
  }
  /* In the order the shapes are listed, whatever order they came back in. */
  return MOTION_SHAPES.flatMap((s) => out.filter((m) => m.shape === s.key).slice(0, 1));
}
