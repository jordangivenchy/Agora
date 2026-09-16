/* POST /api/news/motions — a story in, four arguable questions out.

   Queuing from a headline used to write the headline itself into
   debate_topics.question, so people waited to be matched on sentences
   nobody could take the other side of. This drafts the questions
   instead: what should be done, whether it was right, what follows,
   what matters more (lib/motions.ts).

   Drafted once per story and kept, because the queue matches on the
   exact text of the question — two people reading the same story have
   to be offered the same sentence or they wait in two queues of one.
   Without the service role (a local run) there is nowhere shared to
   keep them, so each caller drafts their own; production has it. */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient, hasAdminCredentials } from "@/lib/supabase-admin";
import { configuredProviders, generateAnswer } from "@/lib/ai/provider";
import {
  MOTION_SYSTEM,
  motionRequest,
  parseMotions,
  storyKey,
  type DraftedMotion,
} from "@/lib/motions";

export const dynamic = "force-dynamic";

interface Body {
  headline?: unknown;
  summary?: unknown;
  category?: unknown;
  topicKey?: unknown;
  sourceUrl?: unknown;
}

const str = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim().replace(/\s+/g, " ");
  return t ? t.slice(0, max) : null;
};

export async function POST(req: Request) {
  /* Drafting costs a model call, so it is for people who are signed in
     — the same people who can queue. */
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Sign in to queue a discussion." }, { status: 401 });

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Nothing to read." }, { status: 400 });
  }
  const headline = str(body.headline, 300);
  if (!headline) return NextResponse.json({ error: "No headline." }, { status: 400 });
  const summary = str(body.summary, 600);
  const category = str(body.category, 60);
  const topicKey = str(body.topicKey, 40) ?? "foreign-policy";
  const sourceUrl = str(body.sourceUrl, 600);
  const key = storyKey(headline);

  const admin = hasAdminCredentials() ? createAdminClient() : null;
  if (admin) {
    const { data } = await admin.from("news_motions").select("motions").eq("story_key", key).maybeSingle();
    const kept = (data as { motions?: DraftedMotion[] } | null)?.motions;
    if (Array.isArray(kept)) return NextResponse.json({ motions: kept, drafted: false });
  }

  if (configuredProviders().length === 0) {
    return NextResponse.json({ error: "Drafting isn't set up on this deployment." }, { status: 503 });
  }

  let motions: DraftedMotion[];
  try {
    const { answer } = await generateAnswer({
      system: MOTION_SYSTEM,
      history: [],
      question: motionRequest({ headline, summary, category }),
      maxOutputTokens: 600,
    });
    motions = parseMotions(answer);
  } catch (e) {
    console.error("[motions] drafting failed", e);
    return NextResponse.json({ error: "Couldn't draft questions for this story — write your own." }, { status: 502 });
  }

  /* An empty list is an answer: a verdict, a death, a disaster with
     nobody to argue with. It is kept like any other, so the next person
     to tap the story is told the same thing without a second call. */
  if (admin) {
    const { error } = await admin
      .from("news_motions")
      .upsert({ story_key: key, headline, topic_key: topicKey, source_url: sourceUrl, motions }, { onConflict: "story_key" });
    if (error) console.error("[motions] couldn't keep the draft", error.message);
  }

  return NextResponse.json({ motions, drafted: true });
}
