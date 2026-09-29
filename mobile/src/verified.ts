/* Who is verified, for the mark beside a name anywhere in the app, kept
   the way the site keeps it (src/lib/verified.ts). Moderators grant it
   (users.verified, set_user_verified) and it is public, so rather than
   every query that shows a person also carrying the flag, the list is
   read whole: it is a handful of people, a sliver of everyone. Read once
   per launch; the last list is kept in AsyncStorage, so on the next
   launch the marks are there as soon as it is read back, and the fresh
   read corrects it. Anything that shows a person asks by id or
   username, whichever it has. */
import { useSyncExternalStore } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "./supabase";

type Row = { id: string; username: string | null };
type Verified = { ids: Set<string>; names: Set<string> };

const KEY = "agora:verified";
let list: Verified | null = null;
let fetched = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((f) => f());

function build(rows: Row[]): Verified {
  return {
    ids: new Set(rows.map((r) => r.id)),
    names: new Set(rows.map((r) => (r.username ?? "").toLowerCase()).filter(Boolean)),
  };
}

/* The last list, read back as the app starts; the fresh read wins if it
   lands first. */
AsyncStorage.getItem(KEY).then((raw) => {
  if (list || !raw) return;
  try {
    const rows = JSON.parse(raw) as Row[];
    if (Array.isArray(rows)) { list = build(rows); emit(); }
  } catch { /* garbled: wait for the read */ }
}, () => undefined);

function fetchList() {
  if (fetched) return;
  fetched = true;
  supabase
    .from("users")
    .select("id, username")
    .eq("verified", true)
    .limit(5000)
    .then(({ data, error }) => {
      if (error || !data) { fetched = false; return; }
      list = build(data as Row[]);
      AsyncStorage.setItem(KEY, JSON.stringify(data)).catch(() => undefined);
      emit();
    }, () => { fetched = false; });
}

/** Read the list again: a moderator just verified someone, or took it back. */
export function refreshVerified() {
  fetched = false;
  fetchList();
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  fetchList();
  return () => { listeners.delete(onChange); };
}

const getSnapshot = (): Verified | null => list;
const getServerSnapshot = (): Verified | null => null;

/** Whether this person is verified, by id or username ("@name" works too). */
export function useVerified(who: { id?: string | null; username?: string | null } | null | undefined): boolean {
  const v = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  if (!v || !who) return false;
  if (who.id && v.ids.has(who.id)) return true;
  const name = who.username?.replace(/^@/, "").toLowerCase();
  return !!name && v.names.has(name);
}
