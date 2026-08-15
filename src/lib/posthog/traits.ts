import { createAdminClient } from "@/lib/supabase-admin";

/* Reading PostHog person properties.

   The hot path NEVER calls PostHog: the Query API needs a personal API key and
   is rate-limited to ~120 requests/hour — three orders of magnitude below what
   10k DAU produces. So:

     chat request  → readCachedTraits()      → Supabase only, milliseconds
     cron (hourly) → refreshTraitsFromPostHog() → HogQL batch → user_preferences

   A cache miss means "no personalization", never an error. */

export interface CachedTraits {
  traits: Record<string, unknown>;
  overrides: Record<string, unknown>;
  refreshedAt: string;
}

/** Hot-path read. One primary-key lookup; returns null on any failure. */
export async function readCachedTraits(userId: string): Promise<CachedTraits | null> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("user_preferences")
      .select("traits, overrides, refreshed_at")
      .eq("user_id", userId)
      .maybeSingle();
    if (error || !data) return null;
    return {
      traits: (data.traits as Record<string, unknown>) ?? {},
      overrides: (data.overrides as Record<string, unknown>) ?? {},
      refreshedAt: data.refreshed_at as string,
    };
  } catch (err) {
    console.error("[posthog] trait cache read failed:", err);
    return null;
  }
}

const POSTHOG_API_HOST = (process.env.POSTHOG_API_HOST ?? "https://us.posthog.com").replace(/\/$/, "");

interface PersonRow {
  distinctId: string;
  properties: Record<string, unknown>;
}

/**
 * Batch-fetches person properties for a set of users via one HogQL query —
 * a single API call per cron run regardless of user count, which is what keeps
 * us inside PostHog's rate limit.
 */
export async function fetchPersonProperties(distinctIds: string[]): Promise<PersonRow[]> {
  const apiKey = process.env.POSTHOG_PERSONAL_API_KEY;
  const projectId = process.env.POSTHOG_PROJECT_ID;
  if (!apiKey || !projectId || distinctIds.length === 0) return [];

  const idList = distinctIds.map((id) => `'${id.replace(/'/g, "")}'`).join(",");
  const res = await fetch(`${POSTHOG_API_HOST}/api/projects/${projectId}/query/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query: {
        kind: "HogQLQuery",
        query: `
          select pdi.distinct_id, p.properties
          from persons p
          join person_distinct_ids pdi on pdi.person_id = p.id
          where pdi.distinct_id in (${idList})
        `,
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`PostHog query failed: ${res.status} ${await res.text().catch(() => "")}`);
  }

  const data = await res.json();
  const rows: unknown[][] = data.results ?? [];
  return rows.map((row) => {
    let properties: Record<string, unknown> = {};
    try {
      properties = typeof row[1] === "string" ? JSON.parse(row[1]) : ((row[1] as Record<string, unknown>) ?? {});
    } catch {
      /* malformed properties: keep empty */
    }
    return { distinctId: String(row[0]), properties };
  });
}

/**
 * Cron entry point: refresh the N stalest cached users plus users who have
 * chatted recently but were never cached. Bounded per run so one execution
 * stays well under both PostHog's rate limit and the cron timeout.
 */
export async function refreshTraitsFromPostHog(batchSize = 200): Promise<{
  refreshed: number;
  errors: number;
}> {
  const admin = createAdminClient();

  // Users who used the assistant in the last 7 days, stalest cache first.
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: activeRows } = await admin
    .from("chat_messages")
    .select("user_id")
    .gte("created_at", since)
    .limit(2000);
  const activeIds = [...new Set((activeRows ?? []).map((r) => r.user_id as string))];

  const { data: staleRows } = await admin
    .from("user_preferences")
    .select("user_id, refreshed_at")
    .in("user_id", activeIds.length > 0 ? activeIds : ["00000000-0000-0000-0000-000000000000"])
    .order("refreshed_at", { ascending: true })
    .limit(batchSize);

  const cachedIds = new Set((staleRows ?? []).map((r) => r.user_id as string));
  const uncachedIds = activeIds.filter((id) => !cachedIds.has(id));
  const targetIds = [...uncachedIds, ...cachedIds].slice(0, batchSize);
  if (targetIds.length === 0) return { refreshed: 0, errors: 0 };

  let people: PersonRow[] = [];
  try {
    people = await fetchPersonProperties(targetIds);
  } catch (err) {
    console.error("[posthog] batch trait fetch failed:", err);
    return { refreshed: 0, errors: targetIds.length };
  }

  const byId = new Map(people.map((p) => [p.distinctId, p.properties]));
  const now = new Date().toISOString();
  const upserts = targetIds.map((userId) => ({
    user_id: userId,
    traits: byId.get(userId) ?? {},
    refreshed_at: now,
    last_error: byId.has(userId) ? null : "not found in posthog",
  }));

  const { error: upsertError } = await admin
    .from("user_preferences")
    .upsert(upserts, { onConflict: "user_id", ignoreDuplicates: false });

  if (upsertError) {
    console.error("[posthog] trait cache upsert failed:", upsertError);
    return { refreshed: 0, errors: targetIds.length };
  }
  return { refreshed: targetIds.length, errors: 0 };
}
