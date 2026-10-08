import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { deskGate, loadDesk, thisMonth } from "@/lib/totals/desk";
import { readPeriod } from "@/lib/totals/table";

/* The totals desk's view for a stretch of months (?from=2026-07&to=2026-10):
   who is counted, how far the reading has got, the table with small
   groups already out, and the downloads so far. Only for people on the
   desk's list; to anyone else this address does not exist. */

export async function GET(request: Request) {
  const gate = await deskGate(await createClient(request));
  if (gate.status === "login") return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (gate.status === "denied") return NextResponse.json({ error: "not_found" }, { status: 404 });

  const url = new URL(request.url);
  const now = new Date();
  const asked = url.searchParams.has("from") || url.searchParams.has("to");
  const period = asked ? readPeriod(url.searchParams.get("from"), url.searchParams.get("to"), now) : thisMonth(now);
  if (!period) return NextResponse.json({ error: "bad_months" }, { status: 400 });

  const desk = await loadDesk(period);
  if (!desk.ready) return NextResponse.json({ error: desk.why }, { status: 503 });
  return NextResponse.json(desk.data, { headers: { "Cache-Control": "no-store" } });
}
