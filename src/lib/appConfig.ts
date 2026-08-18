import { createAdminClient, hasAdminCredentials } from "@/lib/supabase-admin";

/* Server-only key/value config stored in public.app_config (RLS on, no
   policies — only the service role can read it). Holds the reminder
   webhook secret and the web-push VAPID keys, so notification delivery
   needs zero env vars. Cached per lambda instance. */

let cache: Record<string, string> | null = null;
let cachedAt = 0;

export async function getAppConfig(): Promise<Record<string, string>> {
  if (!hasAdminCredentials()) return {};
  if (cache && Date.now() - cachedAt < 5 * 60_000) return cache;
  const admin = createAdminClient();
  const { data } = await admin.from("app_config").select("key, value");
  cache = Object.fromEntries((data ?? []).map((r) => [r.key as string, r.value as string]));
  cachedAt = Date.now();
  return cache;
}
