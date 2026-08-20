import { NextRequest, NextResponse } from "next/server";
import { createAdminClient, hasAdminCredentials } from "@/lib/supabase-admin";
import {
  MAX_CODE_ATTEMPTS,
  challengeStatus,
  hashCode,
  hashesMatch,
  twoFactorSecret,
} from "@/lib/twoFactor";
import { getClientIp, logSecurityEvent, mintSessionCookies } from "@/lib/twoFactorServer";

/* Second step of a 2FA login: code in, session cookies out. All failure
   modes share one message so the response never distinguishes "no such
   challenge" from "expired" from "locked". */

const GENERIC_FAIL = "Invalid or expired code.";

export async function POST(request: NextRequest) {
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
    return NextResponse.json({ error: "Sign-in is unavailable right now." }, { status: 503 });
  }

  const ip = getClientIp(request);
  const admin = createAdminClient();

  const { data: row } = await admin
    .from("two_factor_pending")
    .select("id, user_id, code_hash, attempts, sends, last_sent_at, expires_at, consumed_at")
    .eq("id", pendingId)
    .eq("purpose", "login")
    .maybeSingle();
  if (!row || challengeStatus(row) !== "ok") {
    return NextResponse.json({ error: GENERIC_FAIL }, { status: 400 });
  }

  // Spend an attempt first, optimistically locked so parallel guesses
  // can't share one slot.
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
    if (row.attempts + 1 >= MAX_CODE_ATTEMPTS) {
      await logSecurityEvent("2fa_challenge_locked", { user_id: row.user_id }, ip);
    }
    return NextResponse.json({ error: "Incorrect code." }, { status: 400 });
  }

  // Correct — consume exactly once.
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

  const { data: userData } = await admin.auth.admin.getUserById(row.user_id);
  const email = userData?.user?.email;
  if (!email || !(await mintSessionCookies(email))) {
    return NextResponse.json({ error: "Couldn't finish signing in. Try again." }, { status: 500 });
  }

  await logSecurityEvent("2fa_login_success", { user_id: row.user_id }, ip);
  return NextResponse.json({ ok: true });
}
