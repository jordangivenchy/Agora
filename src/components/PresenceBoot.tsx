"use client";

/* Joins the global presence channel and keeps our tracked state current:
   who we are (auth) and which room page we're on (pathname). Mounted once
   in the root layout; renders nothing. */

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";
import { ensurePresence } from "@/lib/presence";

function roomFromPath(path: string | null): string | null {
  const m = path?.match(/^\/(?:agora|rooms)\/([0-9a-f-]{36})/i);
  return m ? m[1] : null;
}

export default function PresenceBoot() {
  const pathname = usePathname();

  useEffect(() => {
    const supabase = createClient();
    let userId: string | null = null;

    supabase.auth.getUser().then(({ data }) => {
      userId = data.user?.id ?? null;
      ensurePresence(userId, roomFromPath(pathname));
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_e, session) => {
      userId = session?.user?.id ?? null;
      ensurePresence(userId, roomFromPath(pathname));
    });
    return () => subscription.unsubscribe();
  }, [pathname]);

  return null;
}
