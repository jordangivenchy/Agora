import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { BETA_COOKIE, sha256Hex } from "@/lib/betaGate";

/* Paths that must work without a beta pass: the gate itself, and endpoints
   hit by machines that carry their own auth (Apify webhook, Vercel cron)
   or by auth redirects landing from emails/OAuth. */
const BETA_EXEMPT = [
  "/beta",
  "/api/beta",
  "/api/webhook",
  "/api/cron",
  "/api/health", // integration status booleans only — needed for machine checks

  "/auth",
  "/logo.png",
];

export async function proxy(request: NextRequest) {
  /* ── Closed-beta gate (armed only while BETA_INVITE_CODE is set) ── */
  const betaCode = process.env.BETA_INVITE_CODE;
  if (betaCode) {
    const { pathname } = request.nextUrl;
    const sp = request.nextUrl.searchParams;
    const exempt =
      BETA_EXEMPT.some((p) => pathname === p || pathname.startsWith(p + "/")) ||
      /* LiveKit egress compositor filming a room for restream — it carries
         its own room token in the URL and can't hold a beta cookie. */
      (pathname.startsWith("/agora/") && sp.has("token") && sp.has("url"));
    if (!exempt) {
      const pass = request.cookies.get(BETA_COOKIE)?.value;
      if (!pass || pass !== (await sha256Hex(betaCode))) {
        const url = request.nextUrl.clone();
        url.pathname = "/beta";
        url.search = "";
        if (pathname !== "/") {
          url.searchParams.set("next", pathname + request.nextUrl.search);
        }
        return NextResponse.redirect(url);
      }
    }
  }

  /* Handle style: /@username is the public spelling of /users/username. */
  if (request.nextUrl.pathname.startsWith("/@")) {
    const url = request.nextUrl.clone();
    url.pathname = "/users/" + request.nextUrl.pathname.slice(2);
    return NextResponse.rewrite(url);
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Refresh the auth token
  await supabase.auth.getUser();

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
