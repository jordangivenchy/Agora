/* The signed-in person's row, for the header's avatar and the You
   screen. Cached once per account; bumpMe() after a profile edit. */
import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import { useSession } from "./session";
import type { Person } from "./home";

export interface Me extends Person { is_moderator?: boolean | null }

let cached: { id: string; me: Me } | null = null;
const listeners = new Set<() => void>();

/** Forget the cached row; every useMe() reloads. */
export function bumpMe() {
  cached = null;
  listeners.forEach((l) => l());
}

export function useMe(): Me | null {
  const { session } = useSession();
  const id = session?.user.id ?? null;
  const [me, setMe] = useState<Me | null>(cached && cached.id === id ? cached.me : null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const l = () => setTick((t) => t + 1);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  useEffect(() => {
    if (!id) { setMe(null); return; }
    if (cached && cached.id === id) { setMe(cached.me); return; }
    let live = true;
    void supabase.from("users").select("id, username, display_name, avatar_url, is_moderator").eq("id", id).maybeSingle().then(({ data }) => {
      if (!live || !data) return;
      cached = { id, me: data as Me };
      setMe(data as Me);
    });
    return () => { live = false; };
  }, [id, tick]);
  return me;
}
