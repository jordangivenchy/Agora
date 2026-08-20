import { NextRequest, NextResponse } from "next/server";
import { createAdminClient, hasAdminCredentials } from "@/lib/supabase-admin";
import { emailConfigured, sendEmail, twoFactorCodeEmail } from "@/lib/email";
import { CODE_TTL_MS, generateCode, hashCode, resendStatus, twoFactorSecret } from "@/lib/twoFactor";
import { getClientIp, logSecurityEvent } from "@/lib/twoFactorServer";

/* Re-issue the code for a live challenge (login or enroll). A resend is a
   fresh code — guess attempts reset with it — but total sends per
   challenge are capped, and each is cooldown-gated. */

const GENERIC_FAIL = "Invalid or expired code.";

export async function POST(request: NextRequest) {
  let pendingId: string;
  try {
    const body = await request.json();
    pendingId = String(body?.pending || "");
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  if (!/^[0-9a-f-]{36}$/.test(pendingId)) {
    return NextResponse.json({ error: GENERIC_FAIL }, { status: 400 });
  }
  if (!hasAdminCredentials() || !emailConfigured()) {
    return NextResponse.json({ error: "Code delivery is unavailable right now." }, { status: 503 });
  }

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("two_factor_pending")
    .select("id, user_id, attempts, sends, last_sent_at, expires_at, consumed_at")
    .eq("id", pendingId)
    .maybeSingle();
  if (!row) {
    return NextResponse.json({ error: GENERIC_FAIL }, { status: 400 });
  }

  const status = resendStatus(row);
  if (status === "cooldown") {
    return NextResponse.json({ error: "A code was just sent — wait a minute before asking for another." }, { status: 429 });
  }
  if (status === "exhausted") {
    return NextResponse.json({ error: "Code limit reached. Start the sign-in again." }, { status: 429 });
  }
  if (status !== "ok") {
    return NextResponse.json({ error: GENERIC_FAIL }, { status: 400 });
  }

  const { data: userData } = await admin.auth.admin.getUserById(row.user_id);
  const email = userData?.user?.email;
  if (!email) {
    return NextResponse.json({ error: GENERIC_FAIL }, { status: 400 });
  }

  const code = generateCode();
  const { data: updated } = await admin
    .from("two_factor_pending")
    .update({
      code_hash: hashCode(code, twoFactorSecret()),
      attempts: 0,
      sends: row.sends + 1,
      last_sent_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
    })
    .eq("id", row.id)
    .eq("sends", row.sends)
    .is("consumed_at", null)
    .select("id")
    .maybeSingle();
  if (!updated) {
    return NextResponse.json({ error: GENERIC_FAIL }, { status: 400 });
  }

  const sent = await sendEmail({ to: email, ...twoFactorCodeEmail(code) });
  if (!sent) {
    return NextResponse.json({ error: "Couldn't send the code. Try again in a moment." }, { status: 503 });
  }

  await logSecurityEvent("2fa_code_resent", { user_id: row.user_id }, getClientIp(request));
  return NextResponse.json({ ok: true });
}
