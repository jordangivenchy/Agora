import { NextRequest, NextResponse } from "next/server";
import { createAdminClient, hasAdminCredentials } from "@/lib/supabase-admin";
import { createClient } from "@/lib/supabase-server";
import { emailConfigured, sendEmail, twoFactorCodeEmail } from "@/lib/email";
import { CODE_TTL_MS, generateCode, hashCode, twoFactorSecret } from "@/lib/twoFactor";
import { getClientIp, logSecurityEvent } from "@/lib/twoFactorServer";

/* Begin enabling 2FA from Settings: email a code to the signed-in user's
   address. Enrollment only completes at enroll/verify, proving the
   inbox actually receives our mail before the account depends on it. */

export async function POST(request: NextRequest) {
  const server = await createClient();
  const {
    data: { user },
  } = await server.auth.getUser();
  if (!user?.email) {
    return NextResponse.json({ error: "Sign in to manage two-factor authentication." }, { status: 401 });
  }
  if (!hasAdminCredentials() || !emailConfigured()) {
    return NextResponse.json(
      { error: "Email delivery isn't set up yet — two-factor authentication can't be enabled." },
      { status: 503 }
    );
  }

  const admin = createAdminClient();
  await admin.from("two_factor_pending").delete().eq("user_id", user.id).eq("purpose", "enroll");

  const code = generateCode();
  const { data: pending, error } = await admin
    .from("two_factor_pending")
    .insert({
      user_id: user.id,
      purpose: "enroll",
      code_hash: hashCode(code, twoFactorSecret()),
      expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
    })
    .select("id")
    .single();
  if (error || !pending) {
    return NextResponse.json({ error: "Couldn't start enrollment. Try again." }, { status: 500 });
  }

  const sent = await sendEmail({ to: user.email, ...twoFactorCodeEmail(code) });
  if (!sent) {
    await admin.from("two_factor_pending").delete().eq("id", pending.id);
    return NextResponse.json(
      { error: "Couldn't send the verification code. Try again in a moment." },
      { status: 503 }
    );
  }

  await logSecurityEvent("2fa_enroll_started", { user_id: user.id }, getClientIp(request));
  return NextResponse.json({ ok: true, pending: pending.id });
}
