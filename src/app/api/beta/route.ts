import { NextResponse } from "next/server";
import { BETA_COOKIE, BETA_COOKIE_MAX_AGE, issuePass } from "@/lib/betaGate";
import { redeemBetaKey } from "@/lib/betaKeys";

/* Closed-beta pass issuance: POST { code } → sets the pass cookie when the
   code is the master code, or a live one-time key (spent by this call),
   and returns the same pass in the body for the phone app, which keeps it
   and sends it back as the x-agora-beta header (src/proxy.ts).
   See src/lib/betaGate.ts for the scheme. */
export async function POST(req: Request) {
  const expected = process.env.BETA_INVITE_CODE;
  if (!expected) return NextResponse.json({ ok: true }); // gate disarmed

  let supplied = "";
  try {
    const body = await req.json();
    supplied = String(body.code ?? "").trim();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  let who: string | null = null;
  if (supplied && supplied === expected) {
    who = "master";
  } else if (supplied) {
    const key = await redeemBetaKey(supplied).catch((e) => {
      console.error("[beta] redeem failed:", e);
      return null;
    });
    if (key) who = key.id;
  }
  if (!who) return NextResponse.json({ error: "invalid_code" }, { status: 401 });

  const pass = await issuePass(expected, who);
  const res = NextResponse.json({ ok: true, pass });
  res.cookies.set(BETA_COOKIE, pass, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: BETA_COOKIE_MAX_AGE,
    path: "/",
  });
  return res;
}

/* Preflight for the app's web preview (CORS headers come from next.config). */
export async function OPTIONS() {
  return new NextResponse(null, { status: 204 });
}
