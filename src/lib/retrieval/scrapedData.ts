import { createAdminClient, hasAdminCredentials } from "@/lib/supabase-admin";
import type { EvidenceItem } from "@/lib/ai/systemPrompt";

/* Retrieval over the Apify-fed corpus. All ranking logic lives in the
   search_scraped_data RPC (next to the index that serves it); this module just
   shapes the query and degrades to [] on any failure — the assistant must
   answer from model knowledge when the corpus is empty or the DB hiccups. */

const MAX_ITEMS = 6;

/** Strips filler so the tsquery matches on the substantive words. Postgres's
    english config already stems and drops stopwords; this only prunes chat
    phrasing that websearch_to_tsquery would otherwise AND together. */
function toSearchQuery(question: string, motion: string): string {
  const combined = `${question} ${motion}`
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\b(is|it|that|this|the|a|an|of|to|do|does|did|was|were|what|who|when|where|how|why|true|actually|really|please|agora)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // websearch syntax: plain words are ANDed; "or" between them is too strict
  // for short questions, so join with spaces and let ranking sort it out.
  return combined.split(" ").slice(0, 12).join(" ");
}

export async function findRelevantEvidence(params: {
  question: string;
  motion: string;
  topicKey?: string | null;
}): Promise<EvidenceItem[]> {
  if (!hasAdminCredentials()) return [];

  const query = toSearchQuery(params.question, params.motion);
  if (!query) return [];

  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("search_scraped_data", {
      p_query: query,
      p_topic_key: params.topicKey ?? null,
      p_limit: MAX_ITEMS,
    });
    if (error) {
      console.error("[retrieval] search failed:", error);
      return [];
    }
    return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
      id: String(row.id),
      title: String(row.title),
      body: (row.body as string | null) ?? null,
      source: String(row.source),
      url: (row.url as string | null) ?? null,
      published_at: (row.published_at as string | null) ?? null,
    }));
  } catch (err) {
    console.error("[retrieval] search threw:", err);
    return [];
  }
}
