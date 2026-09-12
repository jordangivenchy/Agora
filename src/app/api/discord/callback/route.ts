import { type NextRequest, NextResponse } from "next/server";
import { GATE_STATE_COOKIE, completeDiscordJoin } from "@/lib/discordGate";
import { discordWebhook, gateJoinMessage, postDiscord } from "@/lib/discord";
import { callbackUrl, doorOrigin } from "../_shared";

/* Step two of the door: Discord sends the visitor back with a code. If
   the state matches the cookie, the code becomes a token, the token
   shows which servers they are in, and a partner's member is added by
   the bot. The page at /discord tells them how it went. */

export async function GET(req: NextRequest) {
  const origin = await doorOrigin(req);
  const sp = req.nextUrl.searchParams;
  const expected = req.cookies.get(GATE_STATE_COOKIE)?.value ?? null;

  const done = (r: string) => {
    const res = NextResponse.redirect(new URL(`/discord?r=${r}`, origin));
    res.cookies.set(GATE_STATE_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/api/discord", maxAge: 0 });
    return res;
  };

  if (sp.get("error") === "access_denied") return done("denied");
  const code = sp.get("code");
  const state = sp.get("state");
  if (!code || !state || !expected || state !== expected) return done("state");

  const outcome = await completeDiscordJoin(code, callbackUrl(origin));
  if (outcome.kind === "failed") {
    console.warn(`[discord door] ${outcome.reason}`);
  } else if (outcome.kind === "joined") {
    const team = discordWebhook("team");
    if (team) await postDiscord(team, gateJoinMessage({ username: outcome.user.username, name: outcome.user.name, via: outcome.via.label }, origin));
  }
  return done(outcome.kind);
}
