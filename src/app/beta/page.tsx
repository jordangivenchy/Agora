"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import AuthShell from "@/components/auth/AuthShell";

/* Closed-beta door: enter the invite code once, get a 30-day pass cookie
   (issued by /api/beta), and continue to wherever you were headed. */

function BetaGateForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Same-origin paths only — never follow an absolute/protocol-relative URL.
  const rawNext = params.get("next") ?? "/";
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim() || busy) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/beta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: code.trim() }),
    }).catch(() => null);
    if (res?.ok) {
      // Full navigation (not router.push) so the proxy re-runs with the cookie.
      window.location.assign(next);
      return;
    }
    setBusy(false);
    setError(res?.status === 401 ? "That key isn't right, or it has been used." : "Something went wrong — try again.");
  }

  return (
    <AuthShell width={380} brandHref={null} footer={<a href="/discord" className="auth-link">No key? Get one on our Discord</a>}>
      <form onSubmit={submit} className="auth-form">
        <h1 className="auth-title">Closed beta</h1>
        <p className="auth-sub" style={{ marginBottom: 6 }}>AgoraSphere is invite-only right now. Enter your beta key to come in.</p>
        <input
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Beta key"
          aria-label="Beta key"
          autoFocus
          autoComplete="off"
          className="auth-field is-centered"
        />
        {error && <p className="auth-error" style={{ margin: 0 }}>{error}</p>}
        <button type="submit" disabled={busy || !code.trim()} className="auth-primary">
          {busy ? "Checking…" : "Enter"}
        </button>
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
