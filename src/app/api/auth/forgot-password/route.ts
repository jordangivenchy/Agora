import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { isPasswordResetRateLimited } from "@/lib/passwordResetRateLimit";

// Generic response used for EVERY outcome except transport/validation
// failure and rate-limiting — this is what prevents user enumeration.
// Whether the email exists, was just registered, or never existed, the
// caller sees identical text and identical timing-insensitive behavior.
const GENERIC_MESSAGE =
  "If an account with that email exists, we've sent password reset instructions.";

function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") || "unknown";
}

export async function POST(request: NextRequest) {
  let email: string;
  try {
    const body = await request.json();
    email = String(body?.email || "").trim().toLowerCase();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
  }

  const ip = getClientIp(request);
  const supabase = await createClient();

  // Record this attempt and fetch recent history for both scopes. The RPC
  // is security-definer and callable by anon — recording an attempt must
  // not itself require being signed in.
  const { data: attemptRows, error: attemptErr } = await supabase.rpc(
    "record_password_reset_attempt",
    { p_email: email, p_ip: ip }
  );
  if (attemptErr) {
    console.error("record_password_reset_attempt failed", attemptErr);
    // Fail open on our own bookkeeping error — Supabase Auth's own rate
    // limiting is still the backstop, and a broken audit table shouldn't
    // block someone from recovering their account.
  }

  const row = Array.isArray(attemptRows) ? attemptRows[0] : attemptRows;
  const emailAttempts: number[] = (row?.email_attempts ?? []).map((t: string) =>
    new Date(t).getTime()
  );
  const ipAttempts: number[] = (row?.ip_attempts ?? []).map((t: string) => new Date(t).getTime());

  if (isPasswordResetRateLimited({ emailAttempts, ipAttempts })) {
    await supabase.rpc("log_security_event", {
      p_event_type: "password_reset_rate_limited",
      p_metadata: { email },
      p_ip: ip,
    });
    // Rate-limit responses reveal request frequency, never account
    // existence — the message never mentions whether the email is
    // registered, only that this client is going too fast.
    return NextResponse.json(
      { error: "Too many reset requests. Please wait a few minutes and try again." },
      { status: 429 }
    );
  }

  await supabase.rpc("log_security_event", {
    p_event_type: "password_reset_requested",
    p_metadata: { email },
    p_ip: ip,
  });

  // resetPasswordForEmail itself never reveals whether the address is
  // registered — Supabase returns success either way and only sends mail
  // when an account actually matches. redirectTo carries no user data,
  // only where to land after the emailed link's code is exchanged.
  const { origin } = new URL(request.url);
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/callback?next=/reset-password`,
  });

  return NextResponse.json({ message: GENERIC_MESSAGE });
}
