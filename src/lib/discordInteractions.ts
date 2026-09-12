/* Discord interactions over HTTP (no gateway, nothing running). Discord
   POSTs every button press and slash command to the Interactions
   Endpoint URL, signed with the application's Ed25519 key; the site
   verifies the signature and answers in the same request. The public
   key is on the application's General Information page:
   DISCORD_PUBLIC_KEY in Vercel. Node-only (node:crypto). */

import { createPublicKey, verify } from "node:crypto";

/* An Ed25519 public key wrapped as SubjectPublicKeyInfo: this DER
   prefix says "Ed25519, 32 raw bytes follow". */
const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

/** True when `signature` (hex) signs `timestamp + body` under the application's public key (hex). */
export function verifyDiscordRequest(
  publicKeyHex: string,
  signatureHex: string | null | undefined,
  timestamp: string | null | undefined,
  body: string
): boolean {
  if (!signatureHex || !timestamp || !/^[0-9a-f]{64}$/i.test(publicKeyHex) || !/^[0-9a-f]{128}$/i.test(signatureHex)) return false;
  try {
    const key = createPublicKey({
      key: Buffer.concat([SPKI_PREFIX, Buffer.from(publicKeyHex, "hex")]),
      format: "der",
      type: "spki",
    });
    return verify(null, Buffer.from(timestamp + body), key, Buffer.from(signatureHex, "hex"));
  } catch {
    return false;
  }
}

/* Interaction types and the bits of the payload the site reads. */
export const INTERACTION = { PING: 1, APPLICATION_COMMAND: 2, MESSAGE_COMPONENT: 3 } as const;
export const RESPONSE = { PONG: 1, CHANNEL_MESSAGE: 4 } as const;
export const EPHEMERAL = 1 << 6;

export interface Interaction {
  type: number;
  guild_id?: string;
  data?: { name?: string; custom_id?: string };
  member?: { user?: { id?: string; username?: string } };
  user?: { id?: string; username?: string };
}

/** The name of the beta-key button and command; the setup script registers both. */
export const BETA_KEY_ID = "beta-key";
export const BETA_COMMAND = "beta";

/** Does this interaction ask for the beta key? */
export function asksForBetaKey(it: Interaction): boolean {
  return (
    (it.type === INTERACTION.APPLICATION_COMMAND && it.data?.name === BETA_COMMAND) ||
    (it.type === INTERACTION.MESSAGE_COMPONENT && it.data?.custom_id === BETA_KEY_ID)
  );
}
