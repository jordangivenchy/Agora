"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import BetaStarfield from "@/components/BetaStarfield";
import Wordmark from "@/components/Wordmark";

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
    setError(res?.status === 401 ? "That code isn't right." : "Something went wrong — try again.");
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center p-6"
      style={{ background: "#050508" }}
    >
      <BetaStarfield />
      <form
        onSubmit={submit}
        className="w-full"
        style={{
          position: "relative",
          zIndex: 1,
          maxWidth: 380,
          borderRadius: 20,
          padding: "36px 32px",
          background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.09)",
          boxShadow: "0 24px 80px rgba(0,0,0,0.5)",
          textAlign: "center",
        }}
      >
        <div style={{ marginBottom: 18 }}>
          <Wordmark size={27} />
        </div>
        <h1
          style={{
            fontFamily: "'Space Grotesk', sans-serif",
            fontSize: 20,
            fontWeight: 700,
            color: "rgba(255,255,255,0.92)",
            marginBottom: 6,
          }}
        >
          Closed beta
        </h1>
        <p
          style={{
            fontFamily: "'DM Sans', sans-serif",
            fontSize: 13,
            color: "rgba(255,255,255,0.45)",
            marginBottom: 22,
          }}
        >
          AgoraSphere is invite-only right now. Enter your invite code to come in.
        </p>
        <input
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Invite code"
          autoFocus
          autoComplete="off"
          style={{
            width: "100%",
            height: 44,
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.12)",
            background: "rgba(255,255,255,0.05)",
            color: "white",
            fontFamily: "'DM Sans', sans-serif",
            fontSize: 14,
            textAlign: "center",
            outline: "none",
            marginBottom: 12,
          }}
        />
        {error && (
          <p
            style={{
              fontFamily: "'DM Sans', sans-serif",
              fontSize: 12.5,
              color: "#ff7b72",
              marginBottom: 12,
            }}
          >
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={busy || !code.trim()}
          className="cursor-pointer"
          style={{
            width: "100%",
            height: 44,
            borderRadius: 12,
            border: "none",
            background: busy ? "rgba(124,110,247,0.5)" : "#7c6ef7",
            color: "white",
            fontFamily: "'DM Sans', sans-serif",
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          {busy ? "Checking…" : "Enter"}
        </button>
      </form>
    </div>
  );
}

export default function BetaGatePage() {
  return (
    <Suspense fallback={null}>
      <BetaGateForm />
    </Suspense>
  );
}
