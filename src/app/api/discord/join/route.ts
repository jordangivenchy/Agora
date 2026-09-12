import { type NextRequest, NextResponse } from "next/server";
import { GATE_STATE_COOKIE, GATE_STATE_TTL_S, authorizeUrl, gateConfigured, newGateState } from "@/lib/discordGate";
import { callbackUrl, doorOrigin } from "../_shared";

/* Step one of the door: a fresh state in a short cookie, then off to
   Discord's consent screen. The callback checks the state came back. */

export async function GET(req: NextRequest) {
  const origin = await doorOrigin(req);
  if (!gateConfigured()) {
    return NextResponse.redirect(new URL("/discord?r=off", origin));
  }
  const state = newGateState();
  const res = NextResponse.redirect(authorizeUrl(process.env.DISCORD_CLIENT_ID!, callbackUrl(origin), state));
  res.cookies.set(GATE_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: origin.startsWith("https://"),
    path: "/api/discord",
    maxAge: GATE_STATE_TTL_S,
  });
  return res;
}
