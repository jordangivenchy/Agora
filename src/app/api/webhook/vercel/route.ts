import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getAppConfig } from "@/lib/appConfig";
import { deployMessage, discordWebhook, postDiscord } from "@/lib/discord";

/* Vercel's deployment webhook → a card in #announcements when a
   production build goes live, so testers know what to retry. Set up in
   Vercel: Team Settings → Webhooks → Create → event
   "Deployment Succeeded" → URL https://agorasphere.net/api/webhook/vercel
   → copy the secret into VERCEL_WEBHOOK_SECRET. Vercel signs the raw
   body with HMAC-SHA1 in x-vercel-signature. /api/webhook/* is
   beta-gate exempt (src/proxy.ts). */

interface VercelEvent {
  type?: string;
  createdAt?: number;
  payload?: {
    target?: string | null;
    deployment?: {
      id?: string;
      url?: string;
      meta?: Record<string, string | undefined>;
      target?: string | null;
    };
  };
}

function signed(secret: string, body: string, signature: string | null): boolean {
  if (!signature) return false;
  const expected = createHmac("sha1", secret).update(body).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature.trim().toLowerCase());
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  const secret = process.env.VERCEL_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "not_configured" }, { status: 503 });

  const body = await request.text();
  if (!signed(secret, body, request.headers.get("x-vercel-signature"))) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  let ev: VercelEvent;
  try {
    ev = JSON.parse(body) as VercelEvent;
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const target = ev.payload?.target ?? ev.payload?.deployment?.target ?? null;
  if (ev.type !== "deployment.succeeded" || target !== "production") {
    return NextResponse.json({ ok: true, posted: false, skipped: "not_a_production_deploy" });
  }
  const url = discordWebhook("announcements");
  if (!url) return NextResponse.json({ ok: true, posted: false, skipped: "no_webhook" });

  const meta = ev.payload?.deployment?.meta ?? {};
  const cfg = await getAppConfig().catch(() => ({}) as Record<string, string>);
  const origin = cfg.app_origin ?? "https://agorasphere.net";
  const { ok } = await postDiscord(
    url,
    deployMessage(
      {
        sha: meta.githubCommitSha ?? null,
        message: meta.githubCommitMessage ?? null,
        author: meta.githubCommitAuthorName ?? null,
        at: ev.createdAt ? new Date(ev.createdAt).toISOString() : new Date().toISOString(),
      },
      origin
    )
  );
  return NextResponse.json({ ok: true, posted: ok });
}
