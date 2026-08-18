import { NextResponse } from "next/server";
import { hasAdminCredentials } from "@/lib/supabase-admin";
import { getAppConfig } from "@/lib/appConfig";
import { emailConfigured } from "@/lib/email";

/* Integration health: which optional backends are live. Safe to expose —
   booleans only, never values. Hit this after pasting a key into Vercel
   env to confirm the feature actually lit up (see docs/ACTIVATION.md). */

export async function GET() {
  let push = false;
  try {
    const cfg = await getAppConfig();
    push = Boolean(cfg.vapid_public_key && cfg.vapid_private_key);
  } catch {
    /* config table unreachable — leave false */
  }

  return NextResponse.json({
    ok: true,
    supabaseAdmin: hasAdminCredentials(),
    livekit: Boolean(process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET),
    email: emailConfigured(),
    posthog: Boolean(process.env.POSTHOG_PERSONAL_API_KEY && process.env.POSTHOG_PROJECT_ID),
    hlsStorage: Boolean(
      process.env.S3_ACCESS_KEY && process.env.S3_SECRET_KEY && process.env.S3_BUCKET
    ),
    webPush: push,
    cron: Boolean(process.env.CRON_SECRET),
  });
}
