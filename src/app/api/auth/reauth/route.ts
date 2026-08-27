import { NextRequest, NextResponse } from "next/server";
import { hasAdminCredentials } from "@/lib/supabase-admin";
import { createClient } from "@/lib/supabase-server";
import {
  getClientIp,
  logSecurityEvent,
  revokeSession,
  verifyPasswordServerSide,
} from "@/lib/twoFactorServer";

/* Confirm the signed-in user's current password (e.g. before a password
   change). Runs through verifyPasswordServerSide so the check passes the
   GoTrue password-verification hook for 2FA-enrolled accounts — a plain
   client-side signInWithPassword would be rejected for them. */

export async function POST(request: NextRequest) {
  const server = await createClient();
  const {
    data: { user },
  } = await server.auth.getUser();
  if (!user?.email) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }
  if (!hasAdminCredentials()) {
    return NextResponse.json({ error: "Unavailable right now." }, { status: 503 });
  }

  let password: string;
  try {
    const body = await request.json();
    password = String(body?.password || "");
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  if (!password) {
    return NextResponse.json({ error: "Enter your current password." }, { status: 400 });
  }

  const check = await verifyPasswordServerSide(user.id, user.email, password);
  if (!check.ok || !check.accessToken) {
    await logSecurityEvent("reauth_bad_password", { user_id: user.id }, getClientIp(request));
    return NextResponse.json({ error: "Incorrect password." }, { status: 403 });
  }
  await revokeSession(check.accessToken);

  return NextResponse.json({ ok: true });
}
