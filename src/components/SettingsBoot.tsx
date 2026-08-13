"use client";

/* Applies persisted user settings that affect the whole app shell.
   Mounted once in the root layout.

   reduce_motion: the localStorage mirror applies instantly on boot (no
   flash of animation), then the DB value — the source of truth, synced
   across devices — reconciles once auth resolves. */

import { useEffect } from "react";
import { createClient } from "@/lib/supabase-browser";

export default function SettingsBoot() {
  useEffect(() => {
    try {
      if (localStorage.getItem("agora-reduce-motion") === "1") {
        document.documentElement.classList.add("reduce-motion");
      }
    } catch {}

    const supabase = createClient();
    (async () => {
      const apply = (on: boolean) => {
        document.documentElement.classList.toggle("reduce-motion", on);
        try {
          if (on) localStorage.setItem("agora-reduce-motion", "1");
          else localStorage.removeItem("agora-reduce-motion");
        } catch {}
      };

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        // Signed out: never inherit a previous user's cached setting.
        apply(false);
        return;
      }
      const { data } = await supabase
        .from("user_settings")
        .select("reduce_motion")
        .eq("user_id", user.id)
        .maybeSingle();
      // No row means defaults — reduce_motion off.
      apply(!!data?.reduce_motion);
    })();
  }, []);

  return null;
}
