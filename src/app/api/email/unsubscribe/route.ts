import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/* One-click unsubscribe from the footer of every social / digest email.
   GET /api/email/unsubscribe?u=<user id>&t=<hmac token>. Verified by the
   email_unsubscribe(p_user, p_token) RPC (granted to anon — recipients are
   usually logged out) which sets user_settings.email_unsubscribed_at.
   Security emails (sign-in codes, password changes) are unaffected.
   Exempt from the beta gate in proxy.ts. */

export const dynamic = "force-dynamic";

function page(title: string, body: string, status = 200): NextResponse {
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} · AgoraSphere</title>
<style>body{margin:0;background:#0e0e10;color:#f5f5f0;font-family:'Helvetica Neue',Arial,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px;box-sizing:border-box}
main{max-width:420px;background:#17171c;border:0.5px solid #2e2e38;border-radius:14px;padding:28px 30px}
h1{font-size:19px;margin:0 0 12px}p{font-size:14px;line-height:1.6;color:#c8c8d0;margin:0 0 10px}a{color:#4a9eff;text-decoration:none}
.wm{font-weight:700;font-size:17px;margin-bottom:18px;display:block}.wm span{color:#4a9eff}</style></head>
<body><main><span class="wm">Agora<span>Sphere</span></span><h1>${title}</h1>${body}</main></body></html>`;
  return new NextResponse(html, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

export async function GET(request: NextRequest) {
  const u = request.nextUrl.searchParams.get("u") ?? "";
  const t = request.nextUrl.searchParams.get("t") ?? "";
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon || !u || !t) {
    return page("That link didn't work", `<p>The unsubscribe link is incomplete. You can manage email from <a href="/settings">Settings</a>.</p>`, 400);
  }
  try {
    const supabase = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await supabase.rpc("email_unsubscribe", { p_user: u, p_token: t });
    if (error || data !== true) {
      return page("That link didn't work", `<p>The unsubscribe link is invalid or expired. You can manage email from <a href="/settings">Settings</a>.</p>`, 400);
    }
    return page(
      "You're unsubscribed",
      `<p>You're unsubscribed from AgoraSphere emails. Security emails (sign-in codes) still arrive.</p>
       <p>Changed your mind? Re-enable email any time from <a href="/settings">Settings</a>.</p>`,
    );
  } catch {
    return page("Something went wrong", `<p>Please try again later, or manage email from <a href="/settings">Settings</a>.</p>`, 500);
  }
}
