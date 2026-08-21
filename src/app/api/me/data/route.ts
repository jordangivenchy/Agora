import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

/* The user's own data-rights endpoint, backing the "What Agora knows about
   me" page. GET returns everything Agora has derived about the caller
   (export_user_data, hard-scoped to auth.uid() in SQL). DELETE erases all of
   it (erase_user_data). Both run under the caller's session — a user can only
   ever see or delete their OWN data. */

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { data, error } = await supabase.rpc("export_user_data");
  if (error) {
    console.error("[me/data] export failed:", error.message);
    return NextResponse.json({ error: "export_failed" }, { status: 500 });
  }
  return NextResponse.json({ data });
}

export async function DELETE() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { error } = await supabase.rpc("erase_user_data");
  if (error) {
    console.error("[me/data] erase failed:", error.message);
    return NextResponse.json({ error: "erase_failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
