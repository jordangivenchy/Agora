import { NextRequest, NextResponse } from "next/server";
import { createAdminClient, hasAdminCredentials } from "@/lib/supabase-admin";
import { createClient } from "@/lib/supabase-server";
import { emailConfigured, sendEmail, twoFactorCodeEmail } from "@/lib/email";
import { isRateLimited } from "@/lib/passwordResetRateLimit";
import {
  CODE_TTL_MS,
  LOGIN_EMAIL_MAX_ATTEMPTS,
  LOGIN_EMAIL_WINDOW_MS,
  LOGIN_IP_MAX_ATTEMPTS,
  LOGIN_IP_WINDOW_MS,
  generateCode,
  hashCode,
  twoFactorSecret,
} from "@/lib/twoFactor";
import {
  getClientIp,
  logSecurityEvent,
  revokeSession,
  verifyPasswordServerSide,
} from "@/lib/twoFactorServer";

/* Password sign-in, server-side. The browser never receives a session
   from a password alone when 2FA is enabled: this route checks the
   password with a throwaway client, revokes that session, emails a code,
   and only /api/auth/2fa/verify sets auth cookies. Accounts without 2FA
   get their cookies set here directly. */

const WRONG_CREDENTIALS = "Wrong email or password.";

export async function POST(request: NextRequest) {
  let email: string;
  let password: string;
  try {
    const body = await request.json();
    email = String(body?.email || "").trim().toLowerCase();
    password = String(body?.password || "");
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
  }
  if (!hasAdminCredentials()) {
    return NextResponse.json({ error: "Sign-in is unavailable right now." }, { status: 503 });
  }

  const ip = getClientIp(request);
  const admin = createAdminClient();

  // Rate limit before touching auth: two windows, either blocks.
  await admin.from("two_factor_attempts").insert({ email, ip });
  const since = new Date(Date.now() - Math.max(LOGIN_EMAIL_WINDOW_MS, LOGIN_IP_WINDOW_MS));
  const [{ data: emailRows }, { data: ipRows }] = await Promise.all([
    admin.from("two_factor_attempts").select("created_at").eq("email", email).gte("created_at", since.toISOString()),
    admin.from("two_factor_attempts").select("created_at").eq("ip", ip).gte("created_at", since.toISOString()),
  ]);
  const toTimes = (rows: { created_at: string }[] | null) =>
    (rows ?? []).map((r) => new Date(r.created_at).getTime());
  if (
    isRateLimited(toTimes(emailRows), LOGIN_EMAIL_WINDOW_MS, LOGIN_EMAIL_MAX_ATTEMPTS) ||
    isRateLimited(toTimes(ipRows), LOGIN_IP_WINDOW_MS, LOGIN_IP_MAX_ATTEMPTS)
  ) {
    await logSecurityEvent("2fa_login_rate_limited", { email }, ip);
    return NextResponse.json(
      { error: "Too many sign-in attempts. Wait a few minutes and try again." },
      { status: 429 }
    );
  }

  // The gate needs the user id before sign-in; missing row just means the
  // password check runs ungated (it will fail for unknown emails anyway).
  const { data: userRow } = await admin.from("users").select("id").eq("email", email).maybeSingle();

  const check = await verifyPasswordServerSide(userRow?.id ?? null, email, password);
  if (!check.ok || !check.userId || !check.accessToken || !check.refreshToken) {
    await logSecurityEvent("2fa_login_bad_password", { email }, ip);
    return NextResponse.json({ error: WRONG_CREDENTIALS }, { status: 401 });
  }

  const { data: twoFa } = await admin
    .from("user_2fa")
    .select("enabled")
    .eq("user_id", check.userId)
    .maybeSingle();

  if (!twoFa?.enabled) {
    // No second factor — hand the session straight to the browser.
    const server = await createClient();
    const { error } = await server.auth.setSession({
      access_token: check.accessToken,
      refresh_token: check.refreshToken,
    });
    if (error) {
      await revokeSession(check.accessToken);
      return NextResponse.json({ error: "Sign-in failed. Try again." }, { status: 500 });
    }
    return NextResponse.json({ ok: true, twoFactor: false });
  }

  // 2FA path: the password-check session must never reach the browser.
  await revokeSession(check.accessToken);

  if (!emailConfigured()) {
    // Fail closed — a 2FA account must not fall back to password-only.
    await logSecurityEvent("2fa_email_unconfigured", { email }, ip);
    return NextResponse.json(
      { error: "Two-factor codes can't be delivered right now. Try again later." },
      { status: 503 }
    );
  }

  // One live login challenge per user; stale ones die here.
  await admin.from("two_factor_pending").delete().eq("user_id", check.userId).eq("purpose", "login");

  const code = generateCode();
  const { data: pending, error: pendErr } = await admin
    .from("two_factor_pending")
    .insert({
      user_id: check.userId,
      purpose: "login",
      code_hash: hashCode(code, twoFactorSecret()),
      expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
    })
    .select("id")
    .single();
  if (pendErr || !pending) {
    return NextResponse.json({ error: "Sign-in failed. Try again." }, { status: 500 });
  }

  const sent = await sendEmail({ to: email, ...twoFactorCodeEmail(code) });
  if (!sent) {
    await admin.from("two_factor_pending").delete().eq("id", pending.id);
    return NextResponse.json(
      { error: "Couldn't send your verification code. Try again in a moment." },
      { status: 503 }
    );
  }

  await logSecurityEvent("2fa_challenge_sent", { email }, ip);
  return NextResponse.json({ ok: true, twoFactor: true, pending: pending.id });
}
