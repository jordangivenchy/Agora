import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient, hasAdminCredentials } from "@/lib/supabase-admin";
import { hasConsent, type UserSignal } from "@/lib/dataPlatform/contract";
import { sanitizeBatch } from "@/lib/capture/batch";

/* Behavioral signal ingest. The client's capture lib (src/lib/capture/track)
   POSTs batches here. We authenticate the user, verify they've consented to
   analytics, sanitize the batch again server-side (never trust the client),
   and append to user_signals via the service role.

   Fail closed: no auth or no consent → nothing is stored. */

export async function POST(req: Request) {
  let signals: UserSignal[] = [];
  try {
    const body = await req.json();
    signals = Array.isArray(body.signals) ? body.signals : [];
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  if (signals.length === 0) {
    return NextResponse.json({ error: "empty" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  if (!hasAdminCredentials()) {
    // Storage not configured — accept-and-drop so the client doesn't retry-storm.
    return NextResponse.json({ ok: true, stored: 0 });
  }
  const admin = createAdminClient();

  // The gate: no analytics consent, no collection.
  if (!(await hasConsent(admin, user.id, "analytics"))) {
    return NextResponse.json({ ok: true, stored: 0, consent: false });
  }

  const rows = sanitizeBatch(signals).map((s) => ({
    user_id: user.id,
    kind: s.kind,
    subject_type: s.subjectType ?? null,
    subject_id: s.subjectId ?? null,
    topic_key: s.topicKey ?? null,
    value: s.value ?? null,
    meta: s.meta ?? {},
  }));
  if (rows.length === 0) return NextResponse.json({ ok: true, stored: 0 });

  const { error } = await admin.from("user_signals").insert(rows);
  if (error) {
    console.error("[signals] insert failed:", error.message);
    return NextResponse.json({ error: "store_failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, stored: rows.length });
}
