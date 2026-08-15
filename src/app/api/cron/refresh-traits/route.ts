import { NextResponse } from "next/server";
import { createAdminClient, hasAdminCredentials } from "@/lib/supabase-admin";
import { refreshTraitsFromPostHog } from "@/lib/posthog/traits";

/* Hourly maintenance:
     1. refresh the PostHog trait cache (the ONLY place we read from PostHog —
        one batched HogQL query per run keeps us far under its rate limit)
     2. prune expired response-cache rows and ancient scraped data

   Schedule with Vercel cron (vercel.json):
     { "crons": [{ "path": "/api/cron/refresh-traits", "schedule": "0 * * * *" }] }
   or any external scheduler hitting GET with Authorization: Bearer CRON_SECRET.
   Vercel sends that header automatically when CRON_SECRET is set. */

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "cron_not_configured" }, { status: 503 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!hasAdminCredentials()) {
    return NextResponse.json({ error: "storage_not_configured" }, { status: 503 });
  }

  // Trait refresh is best-effort: if PostHog is down we still prune, and the
  // chat route keeps serving whatever traits were cached last time.
  let refresh = { refreshed: 0, errors: 0 };
  if (process.env.POSTHOG_PERSONAL_API_KEY && process.env.POSTHOG_PROJECT_ID) {
    try {
      refresh = await refreshTraitsFromPostHog();
    } catch (err) {
      console.error("[cron] trait refresh failed:", err);
      refresh = { refreshed: 0, errors: -1 };
    }
  }

  let pruned = true;
  try {
    const admin = createAdminClient();
    const { error } = await admin.rpc("prune_ai_pipeline");
    if (error) {
      console.error("[cron] prune failed:", error);
      pruned = false;
    }
  } catch (err) {
    console.error("[cron] prune threw:", err);
    pruned = false;
  }

  return NextResponse.json({ ok: true, ...refresh, pruned });
}
