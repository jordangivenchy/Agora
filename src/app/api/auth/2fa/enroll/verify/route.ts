import { NextRequest, NextResponse } from "next/server";
import { createAdminClient, hasAdminCredentials } from "@/lib/supabase-admin";
import { createClient } from "@/lib/supabase-server";
import {
  MAX_CODE_ATTEMPTS,
  challengeStatus,
  hashCode,
  hashesMatch,
  twoFactorSecret,
} from "@/lib/twoFactor";
import { getClientIp, logSecurityEvent } from "@/lib/twoFactorServer";

/* Complete enrollment: the code proves the user's inbox works, then the
   account flips to 2FA-required. */

const GENERIC_FAIL = "Invalid or expired code.";

export async function POST(request: NextRequest) {
  const server = await createClient();
  const {
    data: { user },
  } = await server.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to manage two-factor authentication." }, { status: 401 });
  }

  let pendingId: string;
  let code: string;
  try {
    const body = await request.json();
    pendingId = String(body?.pending || "");
    code = String(body?.code || "");
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  if (!/^[0-9a-f-]{36}$/.test(pendingId) || !/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: GENERIC_FAIL }, { status: 400 });
  }
  if (!hasAdminCredentials()) {
    return NextResponse.json({ error: "Unavailable right now." }, { status: 503 });
  }

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("two_factor_pending")
    .select("id, user_id, code_hash, attempts, sends, last_sent_at, expires_at, consumed_at")
    .eq("id", pendingId)
    .eq("purpose", "enroll")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!row || challengeStatus(row) !== "ok") {
    return NextResponse.json({ error: GENERIC_FAIL }, { status: 400 });
  }

  const { data: spent } = await admin
    .from("two_factor_pending")
    .update({ attempts: row.attempts + 1 })
    .eq("id", row.id)
    .eq("attempts", row.attempts)
    .is("consumed_at", null)
    .select("id")
    .maybeSingle();
  if (!spent) {
    return NextResponse.json({ error: GENERIC_FAIL }, { status: 400 });
  }

  if (!hashesMatch(hashCode(code, twoFactorSecret()), row.code_hash)) {
    const remaining = MAX_CODE_ATTEMPTS - (row.attempts + 1);
    return NextResponse.json(
      { error: remaining > 0 ? "Incorrect code." : GENERIC_FAIL },
      { status: 400 }
    );
  }

  const { data: consumed } = await admin
    .from("two_factor_pending")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", row.id)
    .is("consumed_at", null)
    .select("id")
    .maybeSingle();
  if (!consumed) {
    return NextResponse.json({ error: GENERIC_FAIL }, { status: 400 });
  }

  const { error } = await admin.from("user_2fa").upsert({
    user_id: user.id,
    enabled: true,
    enrolled_at: new Date().toISOString(),
  });
  if (error) {
    return NextResponse.json({ error: "Couldn't enable two-factor authentication." }, { status: 500 });
  }

  await logSecurityEvent("2fa_enabled", { user_id: user.id }, getClientIp(request));
  return NextResponse.json({ ok: true });
}
