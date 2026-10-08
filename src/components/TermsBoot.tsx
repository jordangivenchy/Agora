"use client";

/* Asks a signed-in person to agree to the terms in force, once
   (lib/terms, /agree). Mounted in the root layout: on each page it
   checks what this browser already knows, asks the server only when it
   doesn't, and sends the person to /agree if they haven't agreed.

   A full page load, not an in-app move: a live room stays mounted
   across in-app moves (app/@call), and nobody should be left in a call
   they haven't agreed to the terms of. Dormant while the documents are
   still a draft (legalReady). */

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";
import { sessionUser } from "@/lib/session";
import { legalReady } from "@/components/agora/legal";
import { agreement, knownAgreed, needsNoAgreement, rememberAgreed } from "@/lib/terms";

export default function TermsBoot() {
  const pathname = usePathname();

  useEffect(() => {
    if (!legalReady() || !pathname || needsNoAgreement(pathname)) return;
    /* The recorder's page, and a host's own stream link, carry a room
       token and no account. */
    const sp = new URLSearchParams(window.location.search);
    if (pathname.startsWith("/agora/") && sp.has("token") && sp.has("url")) return;

    let off = false;
    void (async () => {
      const supabase = createClient();
      const { data: { user } } = await sessionUser(supabase);
      if (off || !user || knownAgreed(user.id)) return;
      const found = await agreement(supabase, user.id);
      if (off) return;
      if (found.state === "agreed") rememberAgreed(user.id);
      else if (found.state === "not") {
        window.location.replace(`/agree?next=${encodeURIComponent(pathname + window.location.search)}`);
      }
    })();
    return () => {
      off = true;
    };
  }, [pathname]);

  return null;
}
