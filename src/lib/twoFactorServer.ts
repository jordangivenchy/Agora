/**
 * Server-side plumbing shared by the /api/auth/2fa/* routes. Everything
 * here assumes the service role — never import from client components.
 */
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { createClient as createServerClient } from "@/lib/supabase-server";

export function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") || "unknown";
}

/** Anon-key client with no cookie/session persistence — used to check a
    password without the browser ever holding the resulting session. */
export function throwawayAuthClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

/** Best-effort security-event log (the RPC already exists for the
    password-reset flow). */
export async function logSecurityEvent(
  eventType: string,
  metadata: Record<string, unknown>,
  ip: string
): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin.rpc("log_security_event", {
      p_event_type: eventType,
      p_metadata: metadata,
      p_ip: ip,
    });
  } catch {
    // auditing must never break the auth flow
  }
}

/** Open the short-lived gate that lets OUR server-side password check
    through the (optional) GoTrue password-verification hook, run the
    check, then close the gate. */
export async function verifyPasswordServerSide(
  userId: string | null,
  email: string,
  password: string
): Promise<{ ok: boolean; accessToken?: string; refreshToken?: string; userId?: string }> {
  const admin = createAdminClient();
  if (userId) {
    await admin.from("two_factor_gate").upsert({
      user_id: userId,
      expires_at: new Date(Date.now() + 30_000).toISOString(),
    });
  }
  try {
    const auth = throwawayAuthClient();
    const { data, error } = await auth.auth.signInWithPassword({ email, password });
    if (error || !data.session || !data.user) return { ok: false };
    return {
      ok: true,
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
      userId: data.user.id,
    };
  } finally {
    if (userId) {
      await admin.from("two_factor_gate").delete().eq("user_id", userId);
    }
  }
}

/** Revoke a session we created only to check a password. */
export async function revokeSession(accessToken: string): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin.auth.admin.signOut(accessToken, "local");
  } catch {
    // the session dies at token expiry regardless
  }
}

/** Mint a real browser session (cookies) for a user who just passed 2FA,
    without ever having stored their tokens: generate a magic-link token
    server-side and immediately verify it through the cookie-writing
    client. The password hook doesn't fire on this path. */
export async function mintSessionCookies(email: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const tokenHash = data?.properties?.hashed_token;
  if (error || !tokenHash) return false;
  const server = await createServerClient();
  const { error: verifyErr } = await server.auth.verifyOtp({
    type: "email",
    token_hash: tokenHash,
  });
  return !verifyErr;
}
