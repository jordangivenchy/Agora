"use client";

/* /agree — a signed-in person agreeing to the terms in force, once.
   TermsBoot sends them here from wherever they were, and they go back
   there afterwards; Settings links here too. What they agree to is
   recorded with its version and the server's time (accept_terms), and
   shown in their settings. The first time they are also asked their
   date of birth and where they live, and that is saved in the same
   step; a date that is under age puts the account on hold instead.
   What they see is AgreeCard. */

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import AgreeCard, { type AgreeState } from "@/components/AgreeCard";
import { createClient } from "@/lib/supabase-browser";
import { sessionUser } from "@/lib/session";
import { legalReady } from "@/components/agora/legal";
import type { AboutYou } from "@/components/agora/aboutYou";
import { acceptTerms, agreement, details, rememberAgreed, safeNext } from "@/lib/terms";

function Agree() {
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const [supabase] = useState(() => createClient());
  const [userId, setUserId] = useState<string | null>(null);
  const [state, setState] = useState<AgreeState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [askAbout, setAskAbout] = useState(false);
  const [held, setHeld] = useState(false);

  useEffect(() => {
    let off = false;
    void (async () => {
      const { data: { user } } = await sessionUser(supabase);
      if (off) return;
      if (!user) {
        window.location.replace("/login");
        return;
      }
      setUserId(user.id);
      if (!legalReady()) {
        setState("ask");
        return;
      }
      const [found, known] = await Promise.all([agreement(supabase, user.id), details(supabase, user.id)]);
      if (off) return;
      if (found.state === "agreed") {
        rememberAgreed(user.id);
        window.location.replace(next);
        return;
      }
      setHeld(known.state === "known" && known.held);
      /* Asked unless their age is already on record. When that couldn't
         be found out they are asked too: the server keeps what it has. */
      setAskAbout(!(known.state === "known" && known.checked));
      setState("ask");
    })();
    return () => {
      off = true;
    };
  }, [supabase, next]);

  async function agree(about: AboutYou | null) {
    if (!userId || state !== "ask") return;
    setState("busy");
    setError(null);
    const done = await acceptTerms(supabase, "web", about);
    if (done.state === "under_age") {
      setHeld(true);
      setState("ask");
      return;
    }
    if (done.state !== "ok") {
      setState("ask");
      setError("That didn't save. Check your connection and try again.");
      return;
    }
    rememberAgreed(userId);
    setState("done");
    window.location.replace(next);
  }

  async function signOut() {
    await supabase.auth.signOut().catch(() => {});
    window.location.replace("/login");
  }

  return <AgreeCard state={state} error={error} ready={legalReady()} next={next} askAbout={askAbout} held={held} onAgree={agree} onSignOut={signOut} />;
}

export default function AgreePage() {
  return (
    <Suspense fallback={null}>
      <Agree />
    </Suspense>
  );
}
