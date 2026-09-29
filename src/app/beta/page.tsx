"use client";

import { Suspense, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import AuthShell from "@/components/auth/AuthShell";
import { Icon } from "@/components/icons";
import { DISCORD_INVITE } from "@/lib/urls";

/* Closed-beta door: enter a key once, get a 30-day pass cookie (issued
   by /api/beta), and continue to wherever you were headed. What's typed
   goes to the server as typed: the one-time keys forgive case and
   dashes there, and the master code has to match exactly, so the field
   never reformats it. The styles are the beta-* classes in app/auth.css. */

function BetaGateForm() {
  const params = useSearchParams();
  const [code, setCode] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "in">("idle");
  const [error, setError] = useState<string | null>(null);
  const fieldRef = useRef<HTMLLabelElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Same-origin paths only — never follow an absolute/protocol-relative URL.
  const rawNext = params.get("next") ?? "/";
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/";
  const ready = code.trim().length > 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready || state !== "idle") return;
    setState("busy");
    setError(null);
    const res = await fetch("/api/beta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: code.trim() }),
    }).catch(() => null);
    if (res?.ok) {
      setState("in");
      // Full navigation (not router.push) so the proxy re-runs with the cookie.
      window.location.assign(next);
      return;
    }
    setState("idle");
    setError(
      res?.status === 401
        ? "That key didn't work. Check for typos — keys work once and expire after 48 hours."
        : "Something went wrong on our end. Try again.",
    );
    // A small shake, restarted each time, and the key selected to retype.
    const field = fieldRef.current;
    if (field) {
      field.classList.remove("is-shake");
      void field.offsetWidth;
      field.classList.add("is-shake");
    }
    inputRef.current?.select();
  }

  return (
    <AuthShell
      width={400}
      brandHref={null}
      footer={<p className="beta-fine">Each key lets one device in for 30 days.</p>}
    >
      <form onSubmit={submit} className="beta-form" noValidate>
        <span className="beta-pill"><i aria-hidden="true" />Closed beta</span>
        <h1 className="beta-title">Enter your beta key</h1>
        <p className="beta-sub">AgoraSphere is invite-only for now. We&rsquo;re letting people in a few at a time.</p>

        <label ref={fieldRef} className={`beta-key${error ? " is-bad" : ""}`} onAnimationEnd={(e) => e.currentTarget.classList.remove("is-shake")}>
          <Icon name="key-round" size={17} />
          <input
            ref={inputRef}
            type="text"
            value={code}
            onChange={(e) => { setCode(e.target.value); if (error) setError(null); }}
            placeholder="AGORA-XXXX-XXXX"
            aria-label="Beta key"
            aria-invalid={!!error}
            aria-describedby={error ? "beta-error" : undefined}
            autoFocus
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
          />
        </label>
        {error && (
          <p id="beta-error" className="beta-error" role="alert">
            <Icon name="alert-circle" size={14} />
            {error}
          </p>
        )}

        <button type="submit" disabled={!ready} className={`beta-go${state !== "idle" ? " is-working" : ""}`}>
          {state === "busy" ? (
            <><span className="beta-spin" aria-hidden="true" />Checking</>
          ) : state === "in" ? (
            <><Icon name="check" size={16} />You&rsquo;re in</>
          ) : (
            <>Continue<Icon name="arrow-right" size={16} /></>
          )}
        </button>

        <p className="beta-how">
          No key yet? Get one on our <a href={DISCORD_INVITE} target="_blank" rel="noreferrer">Discord</a>.
        </p>
      </form>
    </AuthShell>
  );
}

export default function BetaGatePage() {
  return (
    <Suspense fallback={null}>
      <BetaGateForm />
    </Suspense>
  );
}
