"use client";

import { useState, useRef } from "react";

// Resend cooldown — purely a UX nicety (disables the button so someone
// can't machine-gun submit); the real enforcement is server-side in
// /api/auth/forgot-password, which rate-limits per email AND per IP.
const RESEND_COOLDOWN_S = 30;

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Once we've shown the generic success message, we never go back to
  // showing the form for this session — resubmitting would just repeat
  // the same non-committal response anyway.
  const [submitted, setSubmitted] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const cooldownTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  function startCooldown() {
    setCooldown(RESEND_COOLDOWN_S);
    if (cooldownTimer.current) clearInterval(cooldownTimer.current);
    cooldownTimer.current = setInterval(() => {
      setCooldown((s) => {
        if (s <= 1) {
          if (cooldownTimer.current) clearInterval(cooldownTimer.current);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
  }

  async function submitReset() {
    setError(null);

    const trimmed = email.trim();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError("Enter a valid email address.");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 429) {
        setError(data.error || "Too many reset requests. Please wait a few minutes.");
        setBusy(false);
        return;
      }
      // Any other outcome — success or an email the API doesn't recognize
      // as valid-looking — still resolves to the same generic screen.
      // (400s from malformed input are the one case we surface as an error
      // so the user can fix an obvious typo, not because the address
      // doesn't exist.)
      if (!res.ok && res.status === 400) {
        setError(data.error || "Something went wrong. Please try again.");
        setBusy(false);
        return;
      }
      setSubmitted(true);
      startCooldown();
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: "100%",
    height: "42px",
    padding: "0 14px",
    background: "rgba(255,255,255,0.04)",
    border: "1px solid var(--border)",
    borderRadius: "10px",
    color: "var(--text-primary)",
    fontFamily: "'DM Sans', sans-serif",
    fontSize: "13.5px",
    outline: "none",
    transition: "border-color 0.15s, background 0.15s",
  };

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center relative overflow-hidden px-4 py-10"
      style={{ background: "var(--bg-primary)" }}
    >
      <div
        className="absolute pointer-events-none"
        style={{
          width: "720px",
          height: "720px",
          top: "-360px",
          left: "50%",
          transform: "translateX(-50%)",
          background:
            "radial-gradient(circle, rgba(59,130,246,0.14) 0%, rgba(59,130,246,0.05) 40%, transparent 70%)",
        }}
      />
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.015) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.015) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
          maskImage: "radial-gradient(ellipse at 50% 0%, black 0%, transparent 70%)",
          WebkitMaskImage: "radial-gradient(ellipse at 50% 0%, black 0%, transparent 70%)",
        }}
      />

      <main className="relative flex flex-col items-center w-full" style={{ maxWidth: "400px" }}>
        <a href="/" className="no-underline mb-8 flex items-center gap-2.5">
          <span
            className="text-[26px] font-bold tracking-tight"
            style={{ fontFamily: "'Syne', sans-serif", color: "var(--text-primary)" }}
          >
            <span style={{ color: "var(--accent-blue)" }}>A</span>goraSphere
          </span>
        </a>

        <div
          className="w-full"
          style={{
            background: "rgba(18,18,21,0.7)",
            border: "1px solid var(--border)",
            borderRadius: "20px",
            padding: "32px 32px 28px",
            boxShadow: "0 24px 80px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.04)",
            backdropFilter: "blur(16px)",
            WebkitBackdropFilter: "blur(16px)",
          }}
        >
          {!submitted ? (
            <>
              <h1
                className="text-center"
                style={{
                  fontFamily: "'DM Sans', sans-serif",
                  fontWeight: 700,
                  fontSize: "21px",
                  letterSpacing: "-0.02em",
                  color: "var(--text-primary)",
                  marginBottom: "6px",
                }}
              >
                Forgot your password?
              </h1>
              <p
                className="text-center"
                style={{
                  color: "var(--text-muted)",
                  fontSize: "13px",
                  lineHeight: 1.55,
                  marginBottom: "26px",
                }}
              >
                Enter the email on your account and we&apos;ll send you a link to reset it.
              </p>

              {error && (
                <div
                  style={{
                    background: "rgba(239,68,68,0.08)",
                    border: "1px solid rgba(239,68,68,0.3)",
                    borderRadius: "10px",
                    color: "#fca5a5",
                    fontSize: "12.5px",
                    lineHeight: 1.5,
                    padding: "10px 14px",
                    marginBottom: "18px",
                  }}
                >
                  {error}
                </div>
              )}

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  submitReset();
                }}
                className="flex flex-col gap-4"
              >
                <div>
                  <label
                    style={{
                      display: "block",
                      fontSize: "11.5px",
                      fontWeight: 600,
                      letterSpacing: "0.02em",
                      color: "var(--text-muted)",
                      marginBottom: "6px",
                    }}
                    htmlFor="email"
                  >
                    Email
                  </label>
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    autoComplete="email"
                    autoFocus
                    required
                    style={inputStyle}
                    onFocus={(e) => {
                      e.currentTarget.style.borderColor = "rgba(59,130,246,0.55)";
                    }}
                    onBlur={(e) => {
                      e.currentTarget.style.borderColor = "var(--border)";
                    }}
                  />
                </div>

                <button
                  type="submit"
                  disabled={busy}
                  className="w-full cursor-pointer transition-all"
                  style={{
                    background: "var(--accent-blue)",
                    border: "none",
                    borderRadius: "100px",
                    color: "#fff",
                    fontFamily: "'DM Sans', sans-serif",
                    fontSize: "14px",
                    fontWeight: 600,
                    padding: "12px 20px",
                    marginTop: "4px",
                    opacity: busy ? 0.7 : 1,
                  }}
                  onMouseEnter={(e) => {
                    if (!busy) e.currentTarget.style.background = "var(--accent-purple-light)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "var(--accent-blue)";
                  }}
                >
                  {busy ? "Sending…" : "Send reset link"}
                </button>
              </form>
            </>
          ) : (
            <>
              <div
                className="flex items-center justify-center mx-auto mb-5"
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: "50%",
                  background: "rgba(34,197,94,0.1)",
                  border: "1px solid rgba(34,197,94,0.3)",
                }}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 4h16v16H4z" opacity="0" />
                  <path d="M22 6 12 13 2 6" />
                  <path d="M2 6h20v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2Z" />
                </svg>
              </div>
              <h1
                className="text-center"
                style={{
                  fontFamily: "'DM Sans', sans-serif",
                  fontWeight: 700,
                  fontSize: "19px",
                  letterSpacing: "-0.02em",
                  color: "var(--text-primary)",
                  marginBottom: "8px",
                }}
              >
                Check your inbox
              </h1>
              <p
                className="text-center"
                style={{
                  color: "var(--text-muted)",
                  fontSize: "13.5px",
                  lineHeight: 1.6,
                  marginBottom: "22px",
                }}
              >
                If an account with that email exists, we&apos;ve sent password reset
                instructions. The link expires in about an hour.
              </p>

              {error && (
                <div
                  style={{
                    background: "rgba(239,68,68,0.08)",
                    border: "1px solid rgba(239,68,68,0.3)",
                    borderRadius: "10px",
                    color: "#fca5a5",
                    fontSize: "12.5px",
                    lineHeight: 1.5,
                    padding: "10px 14px",
                    marginBottom: "16px",
                  }}
                >
                  {error}
                </div>
              )}

              <button
                onClick={submitReset}
                disabled={cooldown > 0 || busy}
                className="w-full cursor-pointer transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid var(--border)",
                  borderRadius: "100px",
                  color: "var(--text-muted)",
                  fontFamily: "'DM Sans', sans-serif",
                  fontSize: "13px",
                  fontWeight: 600,
                  padding: "10px 18px",
                }}
              >
                {cooldown > 0 ? `Resend in ${cooldown}s` : "Didn't get it? Resend"}
              </button>
            </>
          )}
        </div>

        <a
          href="/login"
          className="no-underline transition-colors"
          style={{ marginTop: "16px", fontSize: "12.5px", color: "var(--text-muted)", fontWeight: 500 }}
        >
          ← Back to sign in
        </a>
      </main>
    </div>
  );
}
