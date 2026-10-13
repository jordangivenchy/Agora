import { NextResponse } from "next/server";
import { BETA_COOKIE, admitPass, passCookieOptions } from "@/lib/betaGate";
import { keyStillStands } from "@/lib/betaKeys";

/* The phone app already holds a beta pass (it sends it as a header), and
   posts it here for two things.

   Keeping it alive: the app asks when it opens, and a pass more than a
   day old comes back renewed in the answer, good for another 30 days;
   the app keeps that one. A pass that no longer opens the door is
   answered 401, and the app drops it and asks for a key again. Before
   this the app could not tell a pass that had run out from a live one,
   and every call it made to the site was turned away without a word.

   The website inside the app: the same pass becomes the browser's
   cookie, httpOnly, so it has to be set by the server.

   Nothing is issued to a stranger: only a pass that verifies is renewed,
   for the same holder, and not once that holder has been revoked. */
export async function POST(req: Request) {
  const expected = process.env.BETA_INVITE_CODE;
  if (!expected) return NextResponse.json({ ok: true }); // gate disarmed
  let pass: unknown;
  try {
    pass = ((await req.json()) as { pass?: unknown }).pass;
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const check = typeof pass === "string" ? await admitPass(pass, expected, { mayRenew: keyStillStands }) : { valid: false, renew: null };
  if (!check.valid) {
    return NextResponse.json({ error: "invalid_pass" }, { status: 401 });
  }
  const kept = check.renew ?? (pass as string);
  const res = NextResponse.json({ ok: true, pass: kept });
  res.cookies.set(BETA_COOKIE, kept, passCookieOptions());
  return res;
}
