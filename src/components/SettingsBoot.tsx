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
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from("user_settings")
        .select("reduce_motion")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!data) return;
      document.documentElement.classList.toggle("reduce-motion", data.reduce_motion);
      try {
        localStorage.setItem("agora-reduce-motion", data.reduce_motion ? "1" : "0");
      } catch {}
    })();
  }, []);

  return null;
}
