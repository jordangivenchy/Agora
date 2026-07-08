import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  // Where to land after a successful exchange — password-reset links set
  // this to /reset-password; every other flow (OAuth, email confirm)
  // omits it and falls back to the normal new-user/home routing.
  const next = searchParams.get("next");

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      if (next === "/reset-password") {
        // Recovery session established — the reset page itself verifies it
        // via getSession() before showing the new-password form.
        return NextResponse.redirect(`${origin}/reset-password`);
      }
      // Brand-new accounts get routed to profile setup. "New" = the auth user
      // was created within the last 5 minutes; returning sign-ins skip it.
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const isNewUser =
        !!user?.created_at &&
        Date.now() - new Date(user.created_at).getTime() < 5 * 60 * 1000;
      return NextResponse.redirect(`${origin}${isNewUser ? "/welcome" : "/"}`);
    }
    // Exchange failed: the code was invalid, expired, or already used
    // (Supabase's PKCE codes are single-use — a replayed reset link lands
    // here too). Route recovery attempts to a page that explains that,
    // rather than the generic home-page error.
    if (next === "/reset-password") {
      return NextResponse.redirect(`${origin}/reset-password?error=invalid_token`);
    }
  }

  // Auth error — redirect to home with error
  return NextResponse.redirect(`${origin}/?error=auth`);
}
