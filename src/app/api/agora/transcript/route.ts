import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient, hasAdminCredentials } from "@/lib/supabase-admin";
import { findClaimCandidates } from "@/lib/claims/detect";
import { buildTranscriptWindow, parseModeratorAction, type WindowUtterance } from "@/lib/moderator/parse";
import { mergePersona, parseDelta } from "@/lib/personas/merge";
import { findRelevantEvidence } from "@/lib/retrieval/scrapedData";
import { generateAnswer } from "@/lib/ai/provider";
import { captureEvent } from "@/lib/posthog/server";

/* Agora's ears. Stage speakers' browsers POST batches of transcribed speech
   here while they debate. The route:
     1. authenticates the speaker and stores the utterances
     2. screens them for checkable factual claims (cheap, local)
     3. fact-checks strong candidates against retrieval + the model, and —
        if a claim is confidently wrong and the room allows it — posts an
        interjection that every client in the room renders and speaks
     4. every ANALYZE_EVERY utterances, updates the speaker's argumentation
        persona (see lib/personas/merge.ts)

   Interjections are throttled by claim_interjection_slot (DB-enforced
   cooldown per room) so Agora corrects, but never dominates, a debate. */

const ANALYZE_EVERY = 12;
const INTERJECTION_COOLDOWNS: Record<string, number> = {
  relaxed: 240,
  standard: 90,
  aggressive: 40,
};
const MIN_CONFIDENCE = 0.8;

/* Live Moderator pacing: proactive contributions are rarer than corrections
   (the cooldown covers ALL interjection kinds, so a recent correction also
   holds the moderator back — Agora never dogpiles), and the window it reads
   spans every speaker in the room. */
const MODERATOR_COOLDOWN_SECONDS = 150;
const MODERATOR_WINDOW = 24;
const MODERATOR_MIN_CONFIDENCE = 0.75;

const FACT_CHECK_SYSTEM = `You are Agora, the neutral live fact-checker on a debate platform. You are given a claim a debater just spoke aloud, plus optional reference evidence. Decide if the claim is factually wrong in a way that matters to the debate.

Respond ONLY with JSON, no markdown fences:
{"verdict": "accurate" | "false" | "misleading" | "unverifiable", "confidence": 0.0-1.0, "correction": "one or two spoken-style sentences correcting the record, naming your source", "sources": ["source name or url", ...]}

Rules:
- "false" only when you are confident the core assertion is wrong. Rounding, simplification, or debatable framing is NOT false.
- "misleading" for technically-true-but-materially-deceptive claims.
- When evidence is provided, weigh it; cite it in the correction when used.
- Spoken transcripts are messy: ignore grammar, fillers, and transcription noise. Judge the substance.
- confidence reflects how sure you are of the VERDICT. Never exceed 0.6 for claims about events after your knowledge cutoff unless the evidence covers them.
- The correction must be neutral and courteous — it corrects the claim, never attacks the speaker.`;

const MODERATOR_SYSTEM = `You are Agora, the live AI moderator of a spoken debate. You read the last stretch of the room's transcript and decide whether to contribute RIGHT NOW. Your bar for speaking is high: a good moderator is mostly silent, and separate machinery already handles correcting false claims — never duplicate it.

Respond ONLY with JSON, no markdown fences:
{"action": "none" | "context" | "insight", "text": "...", "confidence": 0.0-1.0}

Choose "context" when a concrete, sourced fact would genuinely sharpen the exchange both sides are having (a number, a study, a precedent they're circling without naming). Name the source in the text.
Choose "insight" for moderation itself: an important argument left unanswered, one side repeatedly interrupted or crowded out, the debate drifting off the motion, or a good moment to invite the quieter side to respond. Address the room, never scold a person.
Choose "none" whenever the debate is flowing well — this should be your most common answer.

The text is spoken aloud in the room: one to three conversational sentences, neutral, courteous, no markdown. confidence is how sure you are that speaking now improves the debate.`;

const PERSONA_SYSTEM = `You analyze HOW a debater argues, from a batch of their spoken utterances. Count observable argumentation moves. Respond ONLY with JSON, no markdown fences:
{"moves": {"cites_evidence": n, "cites_statistic": n, "cites_study": n, "anecdote": n, "personal_experience": n, "structured_argument": n, "addresses_counterargument": n, "concession": n, "emotional_appeal": n, "moral_framing": n, "interrupts": n, "ad_hominem": n, "dismissal": n, "asks_question": n, "requests_evidence": n}, "note": "one specific, constructive observation about this speaker's argumentation in this batch"}

Only include moves you actually observed (omit zeros). Judge style, not the positions taken — never record beliefs, identity, or demographics.`;

interface IncomingUtterance {
  text: string;
  at?: number;
}

export async function POST(req: Request) {
  // ── Parse and authenticate ──
  let roomId = "";
  let utterances: IncomingUtterance[] = [];
  try {
    const body = await req.json();
    roomId = String(body.roomId ?? "");
    utterances = Array.isArray(body.utterances)
      ? body.utterances
          .map((u: { text?: unknown; at?: unknown }) => ({
            text: String(u.text ?? "").slice(0, 2000).trim(),
            at: typeof u.at === "number" ? u.at : undefined,
          }))
          .filter((u: IncomingUtterance) => u.text.length > 0)
          .slice(0, 20)
      : [];
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  if (!roomId || utterances.length === 0) {
    return NextResponse.json({ error: "empty" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  // Only current stage participants may stream transcript into a room.
  const { data: participant } = await supabase
    .from("debate_participants")
    .select("role, left_at")
    .eq("room_id", roomId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!participant || participant.left_at || participant.role === "spectator") {
    return NextResponse.json({ error: "not_on_stage" }, { status: 403 });
  }

  // ── 1. Store the utterances (under the speaker's own RLS identity) ──
  const { error: insertError } = await supabase.from("debate_utterances").insert(
    utterances.map((u) => ({ room_id: roomId, user_id: user.id, content: u.text }))
  );
  if (insertError) {
    console.error("[transcript] insert failed:", insertError.message);
    return NextResponse.json({ error: "store_failed" }, { status: 500 });
  }

  // Everything past storage is best-effort: the speaker's browser should
  // never wait on model calls, so kick them off and respond immediately.
  const work = (async () => {
    try {
      await Promise.all([
        // Sequential on purpose: both may interject, and running the
        // moderator after the fact-checker lets the cooldown gate see a
        // correction posted moments ago instead of racing it.
        (async () => {
          await maybeFactCheck(roomId, user.id, utterances);
          await maybeModerate(roomId);
        })(),
        maybePersonaUpdate(user.id, roomId),
      ]);
    } catch (err) {
      console.error("[transcript] background work failed:", err);
    }
  })();
  // In serverless runtimes the response must not outlive the work; locally
  // this awaits fast because both branches usually no-op.
  await work;

  return NextResponse.json({ ok: true, stored: utterances.length });
}

/* ── Fact-check pipeline ── */
async function maybeFactCheck(roomId: string, speakerId: string, utterances: IncomingUtterance[]) {
  if (!hasAdminCredentials()) return;

  const candidates = utterances.flatMap((u) => findClaimCandidates(u.text));
  if (candidates.length === 0) return;

  const admin = createAdminClient();

  // Room settings: hosts control whether and how often Agora jumps in.
  const { data: room } = await admin
    .from("debate_rooms")
    .select("motion, topic_key, fact_check_intensity, status")
    .eq("id", roomId)
    .maybeSingle();
  if (!room || room.status !== "live") return;
  const intensity = (room.fact_check_intensity as string) ?? "standard";
  if (intensity === "off") return;
  const cooldown = INTERJECTION_COOLDOWNS[intensity] ?? INTERJECTION_COOLDOWNS.standard;

  // DB-enforced cooldown — bail before spending model tokens.
  const { data: slotFree } = await admin.rpc("claim_interjection_slot", {
    p_room_id: roomId,
    p_cooldown_seconds: cooldown,
  });
  if (!slotFree) return;

  // Check the single strongest claim of the batch.
  const claim = candidates[0];
  const evidence = await findRelevantEvidence({
    question: claim.text,
    motion: room.motion ?? "",
    topicKey: room.topic_key ?? null,
  });

  const evidenceBlock = evidence.length
    ? "Reference evidence:\n" +
      evidence
        .map((e) => `- [${e.source}] ${e.title}: ${(e.body ?? "").slice(0, 400)}`)
        .join("\n")
    : "No reference evidence available — rely on well-established knowledge only.";

  let verdictJson: string;
  try {
    const result = await generateAnswer({
      system: FACT_CHECK_SYSTEM,
      history: [],
      question: `Claim (spoken in a debate on "${room.motion}"):\n"${claim.text}"\n\n${evidenceBlock}`,
      maxOutputTokens: 400,
    });
    verdictJson = result.answer;
  } catch (err) {
    console.error("[transcript] fact-check model call failed:", err);
    return;
  }

  let verdict: { verdict?: string; confidence?: number; correction?: string; sources?: unknown };
  try {
    verdict = JSON.parse(verdictJson.replace(/^```json?\s*|\s*```$/g, ""));
  } catch {
    console.error("[transcript] unparseable fact-check verdict:", verdictJson.slice(0, 200));
    return;
  }

  const isWrong = verdict.verdict === "false" || verdict.verdict === "misleading";
  const confidence = typeof verdict.confidence === "number" ? verdict.confidence : 0;
  if (!isWrong || confidence < MIN_CONFIDENCE || !verdict.correction) return;

  // ── Agora jumps in ──
  const { error } = await admin.from("agora_interjections").insert({
    room_id: roomId,
    speaker_id: speakerId,
    kind: "correction",
    claim: claim.text.slice(0, 500),
    verdict: verdict.verdict,
    explanation: String(verdict.correction).slice(0, 800),
    sources: Array.isArray(verdict.sources) ? verdict.sources.slice(0, 5) : [],
    confidence,
  });
  if (error) console.error("[transcript] interjection insert failed:", error.message);
  else {
    captureEvent({
      distinctId: speakerId,
      event: "agora_interjected",
      properties: { room_id: roomId, verdict: verdict.verdict, confidence },
    });
  }
}

/* ── Live Moderator pipeline ── */
async function maybeModerate(roomId: string) {
  if (!hasAdminCredentials()) return;
  const admin = createAdminClient();

  const { data: room } = await admin
    .from("debate_rooms")
    .select("motion, status, agora_moderator")
    .eq("id", roomId)
    .maybeSingle();
  if (!room || room.status !== "live" || !room.agora_moderator) return;

  // One pacing gate for every interjection kind: a recent correction also
  // keeps the moderator quiet, so Agora never speaks twice in a row.
  const { data: slotFree } = await admin.rpc("claim_interjection_slot", {
    p_room_id: roomId,
    p_cooldown_seconds: MODERATOR_COOLDOWN_SECONDS,
  });
  if (!slotFree) return;

  // The whole room's recent exchange, speaker-labeled, oldest first.
  const { data: recent } = await admin
    .from("debate_utterances")
    .select("content, user:users(username)")
    .eq("room_id", roomId)
    .order("created_at", { ascending: false })
    .limit(MODERATOR_WINDOW);
  if (!recent || recent.length < 6) return; // too little context to moderate

  const window: WindowUtterance[] = recent.reverse().map((row) => {
    // Supabase types embedded relations as object-or-array; handle both.
    const u = row.user as { username?: string } | { username?: string }[] | null;
    const username = Array.isArray(u) ? u[0]?.username : u?.username;
    return { username: username ?? "speaker", content: String(row.content ?? "") };
  });

  let decisionJson: string;
  try {
    const result = await generateAnswer({
      system: MODERATOR_SYSTEM,
      history: [],
      question: `Motion: "${room.motion}"\n\nRecent transcript:\n${buildTranscriptWindow(window)}`,
      maxOutputTokens: 300,
    });
    decisionJson = result.answer;
  } catch (err) {
    console.error("[moderator] model call failed:", err);
    return;
  }

  const action = parseModeratorAction(decisionJson);
  if (!action || action.confidence < MODERATOR_MIN_CONFIDENCE) return;

  const { error } = await admin.from("agora_interjections").insert({
    room_id: roomId,
    speaker_id: null,
    kind: action.kind,
    claim: "(live moderator)",
    verdict: "context",
    explanation: action.text,
    sources: [],
    confidence: action.confidence,
  });
  if (error) console.error("[moderator] interjection insert failed:", error.message);
  else {
    captureEvent({
      distinctId: `room:${roomId}`,
      event: "agora_moderated",
      properties: { room_id: roomId, kind: action.kind, confidence: action.confidence },
    });
  }
}

/* ── Persona pipeline ── */
async function maybePersonaUpdate(userId: string, roomId: string) {
  if (!hasAdminCredentials()) return;
  const admin = createAdminClient();

  // Pull this speaker's unanalyzed backlog; only act on a full batch.
  const { data: backlog } = await admin
    .from("debate_utterances")
    .select("id, content")
    .eq("user_id", userId)
    .eq("analyzed", false)
    .order("created_at", { ascending: true })
    .limit(ANALYZE_EVERY * 2);
  if (!backlog || backlog.length < ANALYZE_EVERY) return;

  const batch = backlog.slice(0, ANALYZE_EVERY * 2);

  const { data: room } = await admin
    .from("debate_rooms")
    .select("topic_key")
    .eq("id", roomId)
    .maybeSingle();

  let deltaJson: string;
  try {
    const result = await generateAnswer({
      system: PERSONA_SYSTEM,
      history: [],
      question: batch.map((u) => `- ${u.content}`).join("\n"),
      maxOutputTokens: 300,
    });
    deltaJson = result.answer;
  } catch (err) {
    console.error("[transcript] persona model call failed:", err);
    return;
  }

  const delta = parseDelta(
    deltaJson.replace(/^```json?\s*|\s*```$/g, ""),
    batch.length,
    (room?.topic_key as string) ?? null
  );
  if (!delta) return;

  const { data: existing } = await admin
    .from("debate_personas")
    .select("profile, utterances_analyzed, rooms_seen")
    .eq("user_id", userId)
    .maybeSingle();

  const profile = mergePersona(existing?.profile ?? null, delta);

  const { error: upsertError } = await admin.from("debate_personas").upsert({
    user_id: userId,
    profile,
    utterances_analyzed: (existing?.utterances_analyzed ?? 0) + batch.length,
    rooms_seen: (existing?.rooms_seen ?? 0) + (existing ? 0 : 1),
    updated_at: new Date().toISOString(),
  });
  if (upsertError) {
    console.error("[transcript] persona upsert failed:", upsertError.message);
    return;
  }

  // Mark the batch consumed only after the profile landed.
  await admin
    .from("debate_utterances")
    .update({ analyzed: true })
    .in("id", batch.map((u) => u.id));
}
