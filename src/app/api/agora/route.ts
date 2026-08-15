import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { hasAdminCredentials } from "@/lib/supabase-admin";
import {
  generateAnswer,
  configuredProviders,
  AllProvidersFailedError,
  type ChatTurn,
} from "@/lib/ai/provider";
import { buildSystemPrompt, responseCacheKey, type UserContext } from "@/lib/ai/systemPrompt";
import { findRelevantEvidence } from "@/lib/retrieval/scrapedData";
import { readCachedTraits } from "@/lib/posthog/traits";
import { captureEvent } from "@/lib/posthog/server";
import { checkChatRateLimit } from "@/lib/chat/rateLimit";
import {
  ensureSession,
  fetchRecentHistory,
  fetchRecentRequestTimestamps,
  saveExchange,
} from "@/lib/chat/history";
import { readCachedAnswer, writeCachedAnswer } from "@/lib/chat/responseCache";

/* Agora — the in-debate AI assistant, now the pipeline orchestrator.

   Per request:
     1. auth (optional — guests get stateless answers)
     2. rate limit           (Supabase timestamps + pure policy fn)
     3. response cache       (identical question+motion+evidence → no model call)
     4. gather in parallel:  chat history, cached PostHog traits, scraped evidence
     5. build system prompt  (persona + evidence + tone-only user context)
     6. generate             (Gemini primary → Claude fallback)
     7. persist + analytics  (fire-and-forget; failures never break the answer)

   Degradation ladder: PostHog down → no personalization. Corpus empty → model
   knowledge only. All providers down → serve cache; else 502. Supabase down →
   stateless answer, since only persistence and history are lost. */

export async function POST(req: Request) {
  const startedAt = Date.now();

  if (configuredProviders().length === 0) {
    return NextResponse.json(
      {
        error: "no_key",
        answer:
          "Agora's knowledge engine isn't connected yet — add a GEMINI_API_KEY or ANTHROPIC_API_KEY to .env.local and restart the server, and I'll answer with sourced facts.",
      },
      { status: 503 }
    );
  }

  let question = "";
  let motion = "";
  let roomId: string | null = null;
  let topicKey: string | null = null;
  try {
    const body = await req.json();
    question = String(body.question ?? "").slice(0, 2000);
    motion = String(body.motion ?? "").slice(0, 300);
    roomId = typeof body.roomId === "string" ? body.roomId : null;
    topicKey = typeof body.topicKey === "string" ? body.topicKey : null;
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  if (!question.trim()) {
    return NextResponse.json({ error: "empty_question" }, { status: 400 });
  }

  // ── 1. Who's asking? Guests are allowed; they just get no history. ────────
  let userId: string | null = null;
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    userId = data.user?.id ?? null;
  } catch (err) {
    console.error("[agora] auth lookup failed (continuing as guest):", err);
  }

  const persistable = Boolean(userId) && hasAdminCredentials();

  // ── 2. Rate limit (signed-in users; guests are bounded by room membership).
  if (persistable && userId) {
    const timestamps = await fetchRecentRequestTimestamps(userId);
    const decision = checkChatRateLimit({ requestTimestamps: timestamps });
    if (decision.limited) {
      return NextResponse.json(
        {
          error: "rate_limited",
          answer: `You're asking faster than I can check — give me about ${decision.retryAfterSeconds} seconds.`,
        },
        { status: 429, headers: { "Retry-After": String(decision.retryAfterSeconds) } }
      );
    }
  }

  // ── 3 + 4. Evidence first (it's part of the cache key), the rest in parallel.
  const [evidence, session, traits] = await Promise.all([
    findRelevantEvidence({ question, motion, topicKey }),
    persistable && userId ? ensureSession({ userId, roomId, motion: motion || null }) : null,
    persistable && userId ? readCachedTraits(userId) : null,
  ]);

  const cacheKey = responseCacheKey({
    question,
    motion,
    evidenceIds: evidence.map((item) => item.id),
  });

  const cached = await readCachedAnswer(cacheKey);
  if (cached) {
    if (persistable && userId && session) {
      void saveExchange({
        sessionId: session.id,
        userId,
        question,
        answer: cached.answer,
        provider: cached.provider,
        model: cached.model,
        latencyMs: Date.now() - startedAt,
        inputTokens: null,
        outputTokens: null,
        contextIds: evidence.map((item) => item.id),
      });
      captureEvent({
        distinctId: userId,
        event: "agora_question_answered",
        properties: { cached: true, room_id: roomId, topic_key: topicKey },
      });
    }
    return NextResponse.json({ answer: cached.answer, cached: true });
  }

  const history: ChatTurn[] = session ? await fetchRecentHistory(session.id) : [];

  const userContext: UserContext | null = traits
    ? { traits: traits.traits, overrides: traits.overrides }
    : null;

  const system = buildSystemPrompt({ evidence, userContext });
  const questionWithMotion = motion
    ? `Motion under debate: "${motion}"\n\nQuestion: ${question}`
    : question;

  // ── 5 + 6. Generate. ──────────────────────────────────────────────────────
  let result;
  try {
    result = await generateAnswer({ system, history, question: questionWithMotion });
  } catch (err) {
    console.error("[agora] generation failed:", err);
    if (err instanceof AllProvidersFailedError) {
      return NextResponse.json(
        { error: "upstream", answer: "Something went wrong reaching my knowledge engine — try again." },
        { status: 502 }
      );
    }
    return NextResponse.json(
      { error: "upstream", answer: "Something went wrong reaching my knowledge engine — try again." },
      { status: 502 }
    );
  }

  const answer = result.answer || "I don't have a useful answer to that — try rephrasing?";
  const latencyMs = Date.now() - startedAt;

  // ── 7. Persist and instrument — never on the critical path. ──────────────
  void writeCachedAnswer({
    cacheKey,
    question,
    answer,
    provider: result.provider,
    model: result.model,
  });

  if (persistable && userId && session) {
    void saveExchange({
      sessionId: session.id,
      userId,
      question,
      answer,
      provider: result.provider,
      model: result.model,
      latencyMs,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      contextIds: evidence.map((item) => item.id),
    });
    captureEvent({
      distinctId: userId,
      event: "agora_question_answered",
      properties: {
        cached: false,
        provider: result.provider,
        model: result.model,
        latency_ms: latencyMs,
        evidence_count: evidence.length,
        room_id: roomId,
        topic_key: topicKey,
      },
      // Feed lightweight usage traits back into the profile the cron reads.
      set: { last_agora_topic: topicKey ?? undefined },
    });
  }

  return NextResponse.json({ answer });
}
