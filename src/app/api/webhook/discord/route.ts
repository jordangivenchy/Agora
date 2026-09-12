import { NextRequest, NextResponse } from "next/server";
import { getAppConfig } from "@/lib/appConfig";
import { betaKeyEmbed } from "@/lib/discord";
import { EPHEMERAL, INTERACTION, RESPONSE, asksForBetaKey, verifyDiscordRequest, type Interaction } from "@/lib/discordInteractions";

/* Discord's Interactions Endpoint: the "Get my beta key" button on the
   welcome card and the /beta command land here (Developer Portal →
   General Information → Interactions Endpoint URL →
   https://agorasphere.net/api/webhook/discord). Every request is
   signed with the application's Ed25519 key (DISCORD_PUBLIC_KEY);
   Discord also sends a PING to validate the URL. The answer is an
   ephemeral message: only the person who asked sees the key.
   /api/webhook/* is beta-gate exempt (src/proxy.ts). */

const ORIGIN_FALLBACK = "https://agorasphere.net";

function reply(embedsOrText: { embeds?: object[]; content?: string }) {
  return NextResponse.json({ type: RESPONSE.CHANNEL_MESSAGE, data: { flags: EPHEMERAL, ...embedsOrText } });
}

export async function POST(request: NextRequest) {
  const publicKey = process.env.DISCORD_PUBLIC_KEY;
  if (!publicKey) return NextResponse.json({ error: "not_configured" }, { status: 503 });

  const body = await request.text();
  const ok = verifyDiscordRequest(
    publicKey,
    request.headers.get("x-signature-ed25519"),
    request.headers.get("x-signature-timestamp"),
    body
  );
  if (!ok) return NextResponse.json({ error: "invalid_signature" }, { status: 401 });

  let it: Interaction;
  try {
    it = JSON.parse(body) as Interaction;
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  if (it.type === INTERACTION.PING) return NextResponse.json({ type: RESPONSE.PONG });

  if (!asksForBetaKey(it)) return reply({ content: "Nothing to do here." });

  const guild = process.env.DISCORD_GUILD_ID;
  if (guild && it.guild_id !== guild) return reply({ content: "This only works inside the AgoraSphere server." });

  const cfg = await getAppConfig().catch(() => ({}) as Record<string, string>);
  const origin = cfg.app_origin ?? ORIGIN_FALLBACK;
  const code = process.env.BETA_INVITE_CODE?.trim() || null;
  const who = it.member?.user ?? it.user;
  console.log(`[discord] beta key given to ${who?.username ?? "?"} (${who?.id ?? "?"})`);
  return reply({ embeds: [betaKeyEmbed(code, origin)] });
}
