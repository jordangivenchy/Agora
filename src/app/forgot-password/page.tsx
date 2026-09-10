"use client";

import { useState, useRef } from "react";
import { Icon } from "@/components/icons";
import AuthShell from "@/components/auth/AuthShell";

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

  return (
    <AuthShell footer={<a href="/login" className="auth-link">Back to sign in</a>}>
      {!submitted ? (
        <>
          <h1 className="auth-title">Forgot your password?</h1>
          <p className="auth-sub">Enter the email on your account and we&apos;ll send you a link to reset it.</p>
          {error && <div className="auth-error">{error}</div>}
          <form onSubmit={(e) => { e.preventDefault(); submitReset(); }} className="auth-form">
            <div className="auth-field-group">
              <label className="auth-label" htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                autoFocus
                required
                className="auth-field"
              />
            </div>
            <button type="submit" disabled={busy} className="auth-primary">
              {busy ? "Sending…" : "Send reset link"}
            </button>
          </form>
        </>
      ) : (
        <>
          <div className="auth-glyph is-ok"><Icon name="mail" size={24} /></div>
          <h1 className="auth-title">Check your inbox</h1>
          <p className="auth-sub">
            If an account with that email exists, we&apos;ve sent password reset instructions. The link expires in about an hour.
          </p>
          {error && <div className="auth-error">{error}</div>}
          <button onClick={submitReset} disabled={cooldown > 0 || busy} className="auth-secondary">
            {cooldown > 0 ? `Resend in ${cooldown}s` : "Didn't get it? Resend"}
          </button>
        </>
      )}
    </AuthShell>
  );
}
