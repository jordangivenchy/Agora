import { NextResponse } from "next/server";
import { BETA_COOKIE, BETA_COOKIE_MAX_AGE, sha256Hex } from "@/lib/betaGate";

/* Closed-beta pass issuance: POST { code } → sets the pass cookie when the
   code matches BETA_INVITE_CODE. See src/lib/betaGate.ts for the scheme. */
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

  if (!supplied || supplied !== expected) {
    return NextResponse.json({ error: "invalid_code" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(BETA_COOKIE, await sha256Hex(expected), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: BETA_COOKIE_MAX_AGE,
    path: "/",
  });
  return res;
}
