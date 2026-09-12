/* The key desk: one-time beta keys, minted per Discord account and
   redeemed once at /beta. Server-only (service role); the pure parts
   live in lib/betaGate so the proxy and the tests can share them.

   A tester may redeem keysPerTester() keys in all (one per device).
   Pressing the button again before redeeming replaces the unused key,
   so a double press burns nothing. Revoking a person is one row update:
     update beta_keys set revoked_at = now() where discord_user_id = '…';
   after which they can neither mint nor redeem. Passes already on their
   devices run out on their own within 30 days; a real ban is the
   account's suspension, which is immediate. */

import { createAdminClient, hasAdminCredentials } from "@/lib/supabase-admin";
import { BETA_KEY_TTL_MS, hashBetaKey, keysPerTester, looksLikeBetaKey, newBetaKey } from "@/lib/betaGate";

export type MintResult =
  | { kind: "key"; key: string; used: number; total: number; expiresAt: string }
  | { kind: "none-left"; total: number }
  | { kind: "revoked" };

interface KeyRow {
  id: string;
  redeemed_at: string | null;
  revoked_at: string | null;
  expires_at: string;
}

/** A fresh one-time key for this Discord account, or why not. */
export async function mintBetaKey(user: { id: string; name: string | null }): Promise<MintResult> {
  const admin = createAdminClient();
  const total = keysPerTester();
  const { data, error } = await admin
    .from("beta_keys")
    .select("id, redeemed_at, revoked_at, expires_at")
    .eq("discord_user_id", user.id);
  if (error) throw error;
  const rows = (data ?? []) as KeyRow[];
  if (rows.some((r) => r.revoked_at)) return { kind: "revoked" };
  const used = rows.filter((r) => r.redeemed_at).length;
  if (used >= total) return { kind: "none-left", total };

  const now = new Date();
  /* Only the newest unused key works: an earlier one is retired. */
  await admin
    .from("beta_keys")
    .update({ expires_at: now.toISOString() })
    .eq("discord_user_id", user.id)
    .is("redeemed_at", null)
    .gt("expires_at", now.toISOString());

  const key = newBetaKey();
  const expiresAt = new Date(now.getTime() + BETA_KEY_TTL_MS).toISOString();
  const { error: insertError } = await admin.from("beta_keys").insert({
    key_hash: await hashBetaKey(key),
    discord_user_id: user.id,
    discord_username: user.name,
    expires_at: expiresAt,
  });
  if (insertError) throw insertError;
  return { kind: "key", key, used, total, expiresAt };
}

/** Spends the key if it is live: exactly one caller ever gets the row back. */
export async function redeemBetaKey(plain: string): Promise<{ id: string } | null> {
  if (!hasAdminCredentials() || !looksLikeBetaKey(plain)) return null;
  const now = new Date().toISOString();
  const { data } = await createAdminClient()
    .from("beta_keys")
    .update({ redeemed_at: now })
    .eq("key_hash", await hashBetaKey(plain))
    .is("redeemed_at", null)
    .is("revoked_at", null)
    .gt("expires_at", now)
    .select("id")
    .maybeSingle();
  return data?.id ? { id: data.id as string } : null;
}

/** For the morning digest: keys handed out and used since `sinceIso`. */
export async function betaKeyCounts(sinceIso: string): Promise<{ minted: number; redeemed: number; testers: number }> {
  const admin = createAdminClient();
  const [{ count: minted }, { count: redeemed }, { data: testers }] = await Promise.all([
    admin.from("beta_keys").select("id", { count: "exact", head: true }).gte("created_at", sinceIso),
    admin.from("beta_keys").select("id", { count: "exact", head: true }).gte("redeemed_at", sinceIso),
    admin.from("beta_keys").select("discord_user_id").not("redeemed_at", "is", null),
  ]);
  return { minted: minted ?? 0, redeemed: redeemed ?? 0, testers: new Set((testers ?? []).map((t) => t.discord_user_id as string)).size };
}
