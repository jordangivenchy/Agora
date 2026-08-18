import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { emailConfigured, passwordChangedEmail, sendEmail } from "@/lib/email";

/* Fires the "your password was changed" notification to the signed-in
   user's own email. Identity comes from the cookie session — the client
   can't aim this at anyone else. No-ops (200) until Resend is configured
   so callers never need to care. */
export async function POST() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user?.email) {
      return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
    }
    if (!emailConfigured()) {
      return NextResponse.json({ ok: true, sent: false, reason: "email_not_configured" });
    }
    const { subject, html } = passwordChangedEmail();
    const sent = await sendEmail({ to: user.email, subject, html });
    return NextResponse.json({ ok: true, sent });
  } catch {
    return NextResponse.json({ error: "notify_failed" }, { status: 500 });
  }
}
