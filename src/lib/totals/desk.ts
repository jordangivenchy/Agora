/* The totals desk's server side: who may open it, and what it shows.

   The gate is the database's (is_totals_staff, on the caller's own
   session). Everything after it is read with the service role, because
   the counts come back with small groups in them (totals_cells): they
   are blanked here, by buildTable, before they go anywhere. No function
   in this file returns a count that hasn't been through it. */

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient, hasAdminCredentials } from "@/lib/supabase-admin";
import { TAXONOMY } from "./kinds";
import { buildTable, monthOf, periodDates, readCells, type Period, type TotalsTable } from "./table";

export type DeskGate = { status: "login" } | { status: "denied" } | { status: "ok"; userId: string };

/** Signed in, and on the desk's list? */
export async function deskGate(supabase: SupabaseClient): Promise<DeskGate> {
  const { data: claims } = await supabase.auth.getClaims();
  const uid = claims?.claims.sub;
  if (!uid) return { status: "login" };
  const { data, error } = await supabase.rpc("is_totals_staff");
  if (error || data !== true) return { status: "denied" };
  return { status: "ok", userId: uid };
}

/** How many accounts could be counted and why the rest are not; how far the reading has got. */
export interface Overview {
  accounts: number;
  countable: number;
  not_agreed: number;
  switched_off: number;
  not_told: number;
  left_out: number;
  rooms: number;
  transcribed: number;
  read: number;
  waiting: number;
  readings: number;
  first_agreed: string | null;
}

export interface ExportLine {
  id: string;
  made_at: string;
  made_for: string;
  note: string | null;
  period_from: string;
  period_to: string;
  lines: number;
  blanked: number;
  by: string | null;
}

export interface DeskData {
  period: Period;
  overview: Overview;
  table: TotalsTable;
  log: ExportLine[];
}

export type DeskLoad = { ready: true; data: DeskData } | { ready: false; why: "not_configured" | "failed" };

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

type Admin = ReturnType<typeof createAdminClient>;

export async function loadOverview(admin: Admin): Promise<Overview> {
  const { data, error } = await admin.rpc("totals_overview", { p_taxonomy: TAXONOMY });
  if (error) throw new Error(`totals_overview: ${error.message}`);
  const o = (data ?? {}) as Record<string, unknown>;
  return {
    accounts: num(o.accounts),
    countable: num(o.countable),
    not_agreed: num(o.not_agreed),
    switched_off: num(o.switched_off),
    not_told: num(o.not_told),
    left_out: num(o.left_out),
    rooms: num(o.rooms),
    transcribed: num(o.transcribed),
    read: num(o.read),
    waiting: num(o.waiting),
    readings: num(o.readings),
    first_agreed: typeof o.first_agreed === "string" ? o.first_agreed : null,
  };
}

/** The table for these months, small groups already out. */
export async function loadTable(admin: Admin, period: Period): Promise<TotalsTable> {
  const dates = periodDates(period);
  const { data, error } = await admin.rpc("totals_cells", { p_from: dates.from, p_to: dates.to });
  if (error) throw new Error(`totals_cells: ${error.message}`);
  return buildTable(readCells(data));
}

export async function loadLog(admin: Admin, limit = 30): Promise<ExportLine[]> {
  const { data, error } = await admin
    .from("totals_exports")
    .select("id, made_by, made_at, made_for, note, period_from, period_to, lines, blanked")
    .order("made_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`totals_exports: ${error.message}`);
  const rows = (data ?? []) as Array<Omit<ExportLine, "by"> & { made_by: string | null }>;
  const ids = [...new Set(rows.map((r) => r.made_by).filter((x): x is string => !!x))];
  const names = new Map<string, string>();
  if (ids.length) {
    const { data: people } = await admin.from("users").select("id, username").in("id", ids);
    for (const p of (people ?? []) as Array<{ id: string; username: string }>) names.set(p.id, p.username);
  }
  return rows.map(({ made_by, ...r }) => ({ ...r, by: made_by ? names.get(made_by) ?? null : null }));
}

export const thisMonth = (now: Date): Period => ({ from: monthOf(now), to: monthOf(now) });

/** Everything the desk shows for a stretch of months. */
export async function loadDesk(period: Period): Promise<DeskLoad> {
  if (!hasAdminCredentials()) return { ready: false, why: "not_configured" };
  try {
    const admin = createAdminClient();
    const [overview, table, log] = await Promise.all([loadOverview(admin), loadTable(admin, period), loadLog(admin)]);
    return { ready: true, data: { period, overview, table, log } };
  } catch (e) {
    console.error("[totals] desk failed to load:", e instanceof Error ? e.message : e);
    return { ready: false, why: "failed" };
  }
}
