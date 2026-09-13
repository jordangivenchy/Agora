/* The signed-in person's row, for the header's avatar and the You screen. */
import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import { useSession } from "./session";
import type { Person } from "./home";

let cached: { id: string; me: Person } | null = null;

export function useMe(): Person | null {
  const { session } = useSession();
  const id = session?.user.id ?? null;
  const [me, setMe] = useState<Person | null>(cached && cached.id === id ? cached.me : null);
  useEffect(() => {
    if (!id) { setMe(null); return; }
    if (cached && cached.id === id) { setMe(cached.me); return; }
    let live = true;
    void supabase.from("users").select("id, username, display_name, avatar_url").eq("id", id).maybeSingle().then(({ data }) => {
      if (!live || !data) return;
      cached = { id, me: data as Person };
      setMe(data as Person);
    });
    return () => { live = false; };
  }, [id]);
  return me;
}
