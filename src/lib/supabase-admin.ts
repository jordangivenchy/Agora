import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";

/* Service-role Supabase client. Bypasses RLS, so it is ONLY for server-side
   routes that legitimately act outside a user session: the Apify webhook
   (writes scraped_data), the trait-refresh cron, and the response cache.

   Never import this into a client component, and never use it to read
   user-owned rows on behalf of a request — use supabase-server.ts for that, so
   RLS still decides what the caller can see. */

/* Untyped schema on purpose: the project has no generated Database types yet
   (matching the @supabase/ssr clients, which default to the same). When
   `supabase gen types` is adopted, swap `any` for the generated Database. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = SupabaseClient<any, "public", any>;

let cached: AdminClient | null = null;

export function createAdminClient(): AdminClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      "Supabase admin client needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY"
    );
  }

  if (!cached) {
    cached = createSupabaseClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cached;
}

/** True when the service role is configured. Lets routes degrade with a clear
    message instead of throwing on a cold start. */
export function hasAdminCredentials(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}
