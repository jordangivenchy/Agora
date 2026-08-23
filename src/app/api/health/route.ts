import { NextResponse } from "next/server";
import { hasAdminCredentials } from "@/lib/supabase-admin";
import { getAppConfig } from "@/lib/appConfig";
import { emailConfigured } from "@/lib/email";
import { newsConfigured } from "@/lib/news";

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

  const ai = await probeAi();
  return NextResponse.json({
    ok: true,
    ai,
    supabaseAdmin: hasAdminCredentials(),
    livekit: Boolean(process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET),
    email: emailConfigured(),
    news: newsConfigured(),
    posthog: Boolean(process.env.POSTHOG_PERSONAL_API_KEY && process.env.POSTHOG_PROJECT_ID),
    hlsStorage: Boolean(
      // Must mirror the names /api/egress actually reads.
      process.env.HLS_S3_ENDPOINT &&
        process.env.HLS_S3_BUCKET &&
        process.env.HLS_S3_ACCESS_KEY &&
        process.env.HLS_S3_SECRET
    ),
    webPush: push,
    cron: Boolean(process.env.CRON_SECRET),
  });
}


/* Live AI probe: a one-token Gemini call (cached 10 min) so /api/health
   shows whether the key actually works, not just whether it's set. */
let aiProbe: { at: number; result: { configured: boolean; provider: string | null; reachable: boolean; error: string | null } } | null = null;
async function probeAi() {
  const key = process.env.GEMINI_API_KEY;
  const configured = Boolean(key || process.env.ANTHROPIC_API_KEY);
  if (!key) return { configured, provider: process.env.ANTHROPIC_API_KEY ? "anthropic" : null, reachable: false, error: key ? null : "GEMINI_API_KEY missing" };
  if (aiProbe && Date.now() - aiProbe.at < 10 * 60_000) return aiProbe.result;
  const model = process.env.GEMINI_MODEL ?? "gemini-flash-latest";
  let result;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      signal: ctrl.signal,
      body: JSON.stringify({ contents: [{ parts: [{ text: "ping" }] }], generationConfig: { maxOutputTokens: 1 } }),
    });
    clearTimeout(t);
    const text = res.ok ? null : (await res.text().catch(() => "")).slice(0, 200);
    result = { configured, provider: "gemini", reachable: res.ok, error: res.ok ? null : `Gemini ${res.status}: ${text}` };
  } catch (e) {
    result = { configured, provider: "gemini", reachable: false, error: e instanceof Error ? e.message : String(e) };
  }
  aiProbe = { at: Date.now(), result };
  return result;
}
