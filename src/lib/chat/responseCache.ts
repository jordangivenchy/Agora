import { createAdminClient, hasAdminCredentials } from "@/lib/supabase-admin";

/* Supabase-backed response cache. Debate audiences ask near-identical
   questions in bursts ("is that stat true?"), so identical (question, motion,
   evidence) tuples share one model call. Also the last line of defense: when
   every AI provider is down, a cache hit still answers.

   TTL is short — evidence and news move fast during a debate cycle. */

const TTL_MS = 15 * 60 * 1000; // 15 min

export interface CachedAnswer {
  answer: string;
  provider: string | null;
  model: string | null;
}

export async function readCachedAnswer(cacheKey: string): Promise<CachedAnswer | null> {
  if (!hasAdminCredentials()) return null;
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("claim_cached_response", { p_cache_key: cacheKey });
    if (error || !data) return null;
    const row = (Array.isArray(data) ? data[0] : data) as
      | { answer: string; provider: string | null; model: string | null }
      | undefined;
    return row ? { answer: row.answer, provider: row.provider, model: row.model } : null;
  } catch (err) {
    console.error("[cache] read failed:", err);
    return null;
  }
}

export async function writeCachedAnswer(params: {
  cacheKey: string;
  question: string;
  answer: string;
  provider: string;
  model: string;
}): Promise<void> {
  if (!hasAdminCredentials()) return;
  try {
    const admin = createAdminClient();
    const { error } = await admin.from("ai_response_cache").upsert(
      {
        cache_key: params.cacheKey,
        question: params.question.slice(0, 2000),
        answer: params.answer,
        provider: params.provider,
        model: params.model,
        expires_at: new Date(Date.now() + TTL_MS).toISOString(),
      },
      { onConflict: "cache_key" }
    );
    if (error) console.error("[cache] write failed:", error);
  } catch (err) {
    console.error("[cache] write threw:", err);
  }
}
