import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

/* Store / remove this browser's push subscription. Runs as the signed-in
   user, so RLS pins rows to their own account. */

export async function POST(request: NextRequest) {
  try {
    const { endpoint, keys } = await request.json();
    if (typeof endpoint !== "string" || !keys?.p256dh || !keys?.auth) {
      return NextResponse.json({ error: "Invalid subscription" }, { status: 400 });
    }
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });

    const { error } = await supabase.from("push_subscriptions").upsert(
      { user_id: user.id, endpoint, p256dh: keys.p256dh, auth: keys.auth },
      { onConflict: "endpoint" }
    );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "subscribe_failed" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { endpoint } = await request.json();
    if (typeof endpoint !== "string") {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });

    await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "unsubscribe_failed" }, { status: 500 });
  }
}
