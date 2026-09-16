import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { BETA_COOKIE, verifyPass } from "@/lib/betaGate";

/* The beta is closed to taking part, not to looking. Anything shared —
   a past discussion, a thread, a clip, someone's profile — opens for
   anyone who follows the link, so a link is a page and not a locked
   door; the pass is what it takes to speak, post, host or hold an
   account. Reading only: a GET, and the database's own rules (RLS) still
   decide what a signed-out reader may see. */
const PUBLIC_READ = [
  "/", // the shop window: what's live, the day's topics, the news
  "/agora", // a discussion, live or past — the thing people share
  "/rooms", // its older spelling
  "/replays",
  "/clips",
  "/posts",
  "/communities",
  "/users", // and /@name, which rewrites to it below
  "/news",
  "/explore",
  "/trending",
  "/api/news", // what those pages read
  "/api/recordings",
];

/* Paths that must work without a beta pass: the gate itself, and endpoints
   hit by machines that carry their own auth (Apify webhook, Vercel cron)
   or by auth redirects landing from emails/OAuth. */
const BETA_EXEMPT = [
  "/beta",
  "/api/beta",
  "/api/webhook",
  "/api/cron",
  "/api/internal", // pg_net webhooks (room-ended, transcribe-replay) — Bearer-authed
  "/api/email", // one-click unsubscribe links land logged-out
  "/api/health", // integration status booleans only — needed for machine checks
  "/discord", // the door to the Discord server: visitors have no pass yet
  "/api/discord", // its OAuth round trip

  "/auth",
  "/app/open", // the phone app handing its login to the website inside it
  "/logo.png",
];

export async function proxy(request: NextRequest) {
  /* ── Closed-beta gate (armed only while BETA_INVITE_CODE is set) ── */
  const betaCode = process.env.BETA_INVITE_CODE;
  if (betaCode && request.method !== "OPTIONS") {
    const { pathname } = request.nextUrl;
    const sp = request.nextUrl.searchParams;
    const reading =
      request.method === "GET" &&
      (PUBLIC_READ.includes(pathname) ||
        PUBLIC_READ.some((p) => p !== "/" && pathname.startsWith(p + "/")) ||
        pathname.startsWith("/@"));
    const exempt =
      reading ||
      BETA_EXEMPT.some((p) => pathname === p || pathname.startsWith(p + "/")) ||
      /* LiveKit egress compositor filming a room for restream — it carries
         its own room token in the URL and can't hold a beta cookie. */
      (pathname.startsWith("/agora/") && sp.has("token") && sp.has("url"));
    if (!exempt) {
      /* The browser carries the pass as a cookie; the phone app sends the
         same pass in a header, since it has no cookie jar. */
      const pass = request.cookies.get(BETA_COOKIE)?.value ?? request.headers.get("x-agora-beta") ?? undefined;
      if (!(await verifyPass(pass, betaCode))) {
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

  /* Keep the session cookies fresh: this refreshes the tokens when they
     are about to expire (the only time it goes to the network) and
     otherwise verifies the JWT here, against the project's public
     signing key (cached ten minutes across requests). getUser() asked
     the auth server on every request — half a second of every page. */
  await supabase.auth.getClaims();

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
