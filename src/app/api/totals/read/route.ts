import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient, hasAdminCredentials } from "@/lib/supabase-admin";
import { configuredProviders, generateAnswer } from "@/lib/ai/provider";
import { deskGate } from "@/lib/totals/desk";
import { runReadings } from "@/lib/totals/readRun";

/* "Read now" on the totals desk: the same round the nightly job makes
   (lib/totals/readRun.ts), for someone on the desk's list who doesn't
   want to wait for the night. */

export const maxDuration = 120;

export async function POST(request: Request) {
  const gate = await deskGate(await createClient(request));
  if (gate.status === "login") return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (gate.status === "denied") return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!hasAdminCredentials()) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  if (configuredProviders().length === 0) return NextResponse.json({ error: "no_model" }, { status: 503 });

  try {
    const summary = await runReadings(createAdminClient(), { generate: generateAnswer, limit: 5, budgetMs: 60_000 });
    return NextResponse.json(summary, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("[totals] read now failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
