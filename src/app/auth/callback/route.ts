import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
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
  }

  // Auth error — redirect to home with error
  return NextResponse.redirect(`${origin}/?error=auth`);
}
