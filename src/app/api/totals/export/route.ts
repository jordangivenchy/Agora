import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient, hasAdminCredentials } from "@/lib/supabase-admin";
import { deskGate, loadTable } from "@/lib/totals/desk";
import { periodDates, readPeriod, toCsv } from "@/lib/totals/table";

/* A download from the totals desk: the table for a stretch of months as
   a spreadsheet file. The table is built again here, on the server, from
   the counts (small groups out: lib/totals/table.ts), never from what
   the page was showing; and the download is written down (who made it,
   who it is for, a fingerprint of the file) before the file is handed
   over, so there is no file without a line in the log. */

export async function POST(request: Request) {
  const gate = await deskGate(await createClient(request));
  if (gate.status === "login") return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (gate.status === "denied") return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!hasAdminCredentials()) return NextResponse.json({ error: "not_configured" }, { status: 503 });

  const body = (await request.json().catch(() => null)) as { from?: unknown; to?: unknown; madeFor?: unknown; note?: unknown } | null;
  const period = readPeriod(body?.from, body?.to, new Date());
  if (!period) return NextResponse.json({ error: "bad_months" }, { status: 400 });
  const madeFor = typeof body?.madeFor === "string" ? body.madeFor.trim().replace(/\s+/g, " ") : "";
  if (madeFor.length < 2 || madeFor.length > 120) return NextResponse.json({ error: "say_who_for" }, { status: 400 });
  const note = typeof body?.note === "string" && body.note.trim() ? body.note.trim().slice(0, 500) : null;

  try {
    const admin = createAdminClient();
    const table = await loadTable(admin, period);
    if (table.lines.length === 0) return NextResponse.json({ error: "nothing_to_export" }, { status: 409 });

    // the mark at the front lets a spreadsheet read the accents and the dashes
    const file = `﻿${toCsv(table, period)}`;
    const dates = periodDates(period);
    const { error } = await admin.from("totals_exports").insert({
      made_by: gate.userId,
      period_from: dates.from,
      period_to: dates.to,
      made_for: madeFor,
      note,
      lines: table.lines.length,
      blanked: table.blanked,
      floor: table.floor,
      file_sha256: createHash("sha256").update(file, "utf8").digest("hex"),
    });
    if (error) {
      console.error("[totals] a download could not be logged, so it was refused:", error.message);
      return NextResponse.json({ error: "not_logged" }, { status: 500 });
    }

    const name = `agorasphere-totals-${period.from}${period.to === period.from ? "" : `-to-${period.to}`}.csv`;
    return new Response(file, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${name}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error("[totals] export failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
