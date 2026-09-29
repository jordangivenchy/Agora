"use client";

/* Who is verified, for the mark beside a name anywhere on the site.
   Moderators grant it (users.verified, set_user_verified) and it is
   public, so rather than every query that shows a person also carrying
   the flag, the list is read whole: it is a handful of people, a sliver
   of everyone. Read once per page load; the last list is kept in
   localStorage, so on a later visit the marks are there as soon as the
   page hydrates, and the fresh read corrects it. Anything that shows a
   person asks by id or username, whichever it has. */

import { useSyncExternalStore } from "react";
import { createClient } from "@/lib/supabase-browser";

type Row = { id: string; username: string | null };
type Verified = { ids: Set<string>; names: Set<string> };

const KEY = "agora:verified";
let list: Verified | null = null;
let primed = false;
let fetched = false;
const listeners = new Set<() => void>();

function build(rows: Row[]): Verified {
  return {
    ids: new Set(rows.map((r) => r.id)),
    names: new Set(rows.map((r) => (r.username ?? "").toLowerCase()).filter(Boolean)),
  };
}

function prime() {
  if (primed) return;
  primed = true;
  try {
    const raw = localStorage.getItem(KEY);
    const rows = raw ? (JSON.parse(raw) as Row[]) : null;
    if (Array.isArray(rows)) list = build(rows);
  } catch { /* storage blocked or garbled: wait for the read */ }
}

function fetchList() {
  if (fetched) return;
  fetched = true;
  createClient()
    .from("users")
    .select("id, username")
    .eq("verified", true)
    .limit(5000)
    .then(({ data, error }) => {
      if (error || !data) { fetched = false; return; }
      list = build(data as Row[]);
      try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* memory only */ }
      listeners.forEach((f) => f());
    });
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  fetchList();
  return () => { listeners.delete(onChange); };
}

function getSnapshot(): Verified | null {
  prime();
  return list;
}

const getServerSnapshot = (): Verified | null => null;

/** Whether this person is verified, by id or username. */
export function useVerified(who: { id?: string | null; username?: string | null } | null | undefined): boolean {
  const v = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  if (!v || !who) return false;
  if (who.id && v.ids.has(who.id)) return true;
  const name = who.username?.replace(/^@/, "").toLowerCase();
  return !!name && v.names.has(name);
}
