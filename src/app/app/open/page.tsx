"use client";

/* The phone app's way onto the website as the same person. The app opens
   /app/open?to=/settings&pass=<beta pass>#access_token=…&refresh_token=…
   The pass becomes the beta cookie (through a POST, since the cookie is
   httpOnly), the session lands in the browser client — cookies, so the
   server sees it on the next page — and the browser goes on to `to`.
   The tokens ride in the fragment, which never reaches a server or a
   log. `to` is a path on this site only. */
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";

export default function AppOpen() {
  const [note, setNote] = useState("Signing you in…");
  useEffect(() => {
    void (async () => {
      const q = new URLSearchParams(window.location.search);
      const h = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const wanted = q.get("to") ?? "/";
      const to = /^\/(?!\/)/.test(wanted) ? wanted : "/";
      const pass = q.get("pass");
      if (pass) {
        await fetch("/api/beta/pass", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pass }) }).catch(() => undefined);
      }
      const access_token = h.get("access_token");
      const refresh_token = h.get("refresh_token");
      if (access_token && refresh_token) {
        const { error } = await createClient().auth.setSession({ access_token, refresh_token });
        if (error) setNote("Couldn't sign you in here. Carrying on signed out.");
      }
      window.history.replaceState(null, "", "/app/open");
      window.location.replace(to);
    })();
  }, []);
  return (
    <main style={{ minHeight: "70vh", display: "grid", placeItems: "center", color: "#8c8c98", fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 14 }}>
      {note}
    </main>
  );
}
