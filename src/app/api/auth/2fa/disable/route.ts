import { NextRequest, NextResponse } from "next/server";
import { createAdminClient, hasAdminCredentials } from "@/lib/supabase-admin";
import { createClient } from "@/lib/supabase-server";
import {
  getClientIp,
  logSecurityEvent,
  revokeSession,
  verifyPasswordServerSide,
} from "@/lib/twoFactorServer";

/* Turn 2FA off. Password accounts must re-enter their password so a
   hijacked cookie alone can't strip the second factor; OAuth-only
   accounts (no password identity) disable with just their session. */

export async function POST(request: NextRequest) {
  const server = await createClient();
  const {
    data: { user },
  } = await server.auth.getUser();
  if (!user?.email) {
    return NextResponse.json({ error: "Sign in to manage two-factor authentication." }, { status: 401 });
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

  const hasPasswordIdentity = (user.identities ?? []).some((i) => i.provider === "email");
  if (hasPasswordIdentity) {
    if (!password) {
      return NextResponse.json({ error: "Enter your password to disable 2FA." }, { status: 400 });
    }
    const check = await verifyPasswordServerSide(user.id, user.email, password);
    if (!check.ok || !check.accessToken) {
      await logSecurityEvent("2fa_disable_bad_password", { user_id: user.id }, getClientIp(request));
      return NextResponse.json({ error: "Incorrect password." }, { status: 403 });
    }
    await revokeSession(check.accessToken);
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("user_2fa")
    .update({ enabled: false })
    .eq("user_id", user.id);
  if (error) {
    return NextResponse.json({ error: "Couldn't disable two-factor authentication." }, { status: 500 });
  }
  await admin.from("two_factor_pending").delete().eq("user_id", user.id);

  await logSecurityEvent("2fa_disabled", { user_id: user.id }, getClientIp(request));
  return NextResponse.json({ ok: true });
}
