import { NextResponse } from "next/server";
import { BETA_COOKIE, BETA_COOKIE_MAX_AGE, verifyPass } from "@/lib/betaGate";

/* The phone app already holds a beta pass (it sends it as a header). For
   the website inside the app to be past the gate too, the app posts the
   pass here and it becomes the browser's cookie — httpOnly, so it has to
   be set by the server. Nothing is issued: a pass that doesn't verify
   gets nothing. */
export async function POST(req: Request) {
  const expected = process.env.BETA_INVITE_CODE;
  if (!expected) return NextResponse.json({ ok: true }); // gate disarmed
  let pass: unknown;
  try {
    pass = ((await req.json()) as { pass?: unknown }).pass;
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  if (typeof pass !== "string" || !(await verifyPass(pass, expected))) {
    return NextResponse.json({ error: "invalid_pass" }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(BETA_COOKIE, pass, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: BETA_COOKIE_MAX_AGE,
    path: "/",
  });
  return res;
}
