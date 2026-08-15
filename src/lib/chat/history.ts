import { createAdminClient } from "@/lib/supabase-admin";
import type { ChatTurn } from "@/lib/ai/provider";

/* Chat persistence for the Agora assistant. Signed-in users get durable
   sessions and history-aware answers; guests get stateless answers (the route
   simply skips these calls). Every function degrades gracefully — persistence
   failures must never take down the answer itself. */

const HISTORY_TURNS = 10; // last 5 exchanges — enough context, bounded tokens

export interface SessionRef {
  id: string;
}

/** Finds or creates the user's session for this room (or their roomless one). */
export async function ensureSession(params: {
  userId: string;
  roomId: string | null;
  motion: string | null;
}): Promise<SessionRef | null> {
  try {
    const admin = createAdminClient();
    let query = admin.from("chat_sessions").select("id").eq("user_id", params.userId);
    query = params.roomId ? query.eq("room_id", params.roomId) : query.is("room_id", null);
    const { data: existing } = await query.maybeSingle();
    if (existing) return { id: existing.id as string };

    const { data: created, error } = await admin
      .from("chat_sessions")
      .insert({ user_id: params.userId, room_id: params.roomId, motion: params.motion })
      .select("id")
      .single();
    if (error || !created) {
      // Unique-violation race: another request created it first — reuse theirs.
      const { data: raced } = await query.maybeSingle();
      if (raced) return { id: raced.id as string };
      console.error("[chat] session create failed:", error);
      return null;
    }
    return { id: created.id as string };
  } catch (err) {
    console.error("[chat] ensureSession threw:", err);
    return null;
  }
}

export async function fetchRecentHistory(sessionId: string): Promise<ChatTurn[]> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("chat_messages")
      .select("role, content")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: false })
      .limit(HISTORY_TURNS);
    if (error || !data) return [];
    // Reverse to chronological order for the model.
    return data.reverse().map((row) => ({
      role: row.role as "user" | "assistant",
      content: row.content as string,
    }));
  } catch (err) {
    console.error("[chat] history fetch failed:", err);
    return [];
  }
}

/** Epoch-ms timestamps of the user's recent questions, for the rate limiter. */
export async function fetchRecentRequestTimestamps(userId: string): Promise<number[]> {
  try {
    const admin = createAdminClient();
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data } = await admin
      .from("chat_messages")
      .select("created_at")
      .eq("user_id", userId)
      .eq("role", "user")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(100);
    return (data ?? []).map((row) => new Date(row.created_at as string).getTime());
  } catch (err) {
    console.error("[chat] rate-limit fetch failed:", err);
    return []; // fail open: better to answer than to block on a DB error
  }
}

export async function saveExchange(params: {
  sessionId: string;
  userId: string;
  question: string;
  answer: string;
  provider: string | null;
  model: string | null;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  contextIds: string[];
}): Promise<void> {
  try {
    const admin = createAdminClient();
    const { error } = await admin.from("chat_messages").insert([
      {
        session_id: params.sessionId,
        user_id: params.userId,
        role: "user",
        content: params.question,
      },
      {
        session_id: params.sessionId,
        user_id: params.userId,
        role: "assistant",
        content: params.answer,
        provider: params.provider,
        model: params.model,
        latency_ms: params.latencyMs,
        input_tokens: params.inputTokens,
        output_tokens: params.outputTokens,
        context_ids: params.contextIds,
      },
    ]);
    if (error) console.error("[chat] saveExchange failed:", error);

    await admin
      .from("chat_sessions")
      .update({ last_message_at: new Date().toISOString() })
      .eq("id", params.sessionId);
  } catch (err) {
    console.error("[chat] saveExchange threw:", err);
  }
}
