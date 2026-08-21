/**
 * Recompute a user's recommendations from their profile and a candidate set,
 * and store them. Gated on 'personalization' consent. `admin` is a
 * service-role client, passed in.
 *
 * The candidate set (open rooms, trending topics, suggested people) is
 * assembled by the caller — this module only ranks and persists, so the
 * ranking stays pure and testable and the query lives at the call site.
 */

import { hasConsent } from "@/lib/dataPlatform/contract";
import type { UserDataProfile } from "@/lib/dataPlatform/contract";
import { rankRecommendations, type Candidate } from "./rank";

interface Admin {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
  from: (table: string) => {
    select: (cols: string) => { eq: (col: string, val: unknown) => { maybeSingle: () => PromiseLike<{ data: unknown }> } };
    upsert: (row: Record<string, unknown>) => PromiseLike<{ error: unknown }>;
  };
}

export async function recomputeRecommendations(
  admin: Admin,
  userId: string,
  candidates: Candidate[]
): Promise<boolean> {
  if (!(await hasConsent(admin, userId, "personalization"))) return false;

  const prof = await admin.from("user_data_profiles").select("behavior, argument_style, learning_style, positions_summary, highlights, signals_count").eq("user_id", userId).maybeSingle();
  const profile = (prof.data as UserDataProfile | null) ?? null;

  const rec = rankRecommendations(profile, candidates);

  const { error } = await admin.from("user_recommendations").upsert({
    user_id: userId,
    ranked: rec.ranked,
    rationale: rec.rationale,
    computed_at: new Date().toISOString(),
  });
  if (error) {
    console.error("[recs] upsert failed:", error);
    return false;
  }
  return true;
}
