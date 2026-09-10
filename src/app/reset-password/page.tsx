"use client";

import { Suspense, useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import AuthShell from "@/components/auth/AuthShell";
import { LoadingLine } from "@/components/LoadingScreen";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";
import { validateNewPassword } from "@/lib/passwordPolicy";

type Status = "checking" | "ready" | "invalid" | "done";

function ResetPasswordInner() {
  const supabase = createClient();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [status, setStatus] = useState<Status>("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The callback route already exchanged the emailed link's code for a
  // recovery session before redirecting here. If that failed (expired,
  // already-used, or tampered token), it redirects with ?error=invalid_token
  // instead. Either way, getSession() is the real check — it fails closed:
  // no session, no form, regardless of how someone lands on this URL.
  useEffect(() => {
    if (searchParams?.get("error") === "invalid_token") {
      setStatus("invalid");
      return;
    }
    supabase.auth.getSession().then(({ data: { session } }) => {
      setStatus(session ? "ready" : "invalid");
    });
  }, [searchParams, supabase]);

  function friendlyError(message: string): string {
    const m = message.toLowerCase();
    if (m.includes("should be different")) return "That's your current password — choose a new one.";
    if (m.includes("at least")) return message;
    if (m.includes("session")) return "This reset link has expired. Please request a new one.";
    return message;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const validationError = validateNewPassword(password, confirm);
    if (validationError) {
      setError(validationError);
      return;
    }

    setBusy(true);
    const { error: updateErr } = await supabase.auth.updateUser({ password });
    if (updateErr) {
      setError(friendlyError(updateErr.message));
      setBusy(false);
      return;
    }

    // Log the change, then invalidate every OTHER active session (other
    // devices/browsers) — anyone who had a stale session before the
    // password changed gets signed out. scope: 'others' deliberately
    // keeps *this* session alive so the user lands in the app already
    // signed in with their new password, rather than having to log in
    // again immediately after proving they own the account.
    await supabase.rpc("log_security_event", { p_event_type: "password_changed" });
    // Security notification email (no-op until Resend is configured).
    fetch("/api/notify/password-changed", { method: "POST" }).catch(() => {});
    await supabase.auth.signOut({ scope: "others" });

    setBusy(false);
    setStatus("done");
  }

  return (
    <AuthShell brandHref={null}>
      {status === "checking" && (
        <div className="auth-wait"><LoadingLine label="Checking your link" /></div>
      )}

      {status === "invalid" && (
        <>
          <div className="auth-glyph is-bad"><Icon name="alert-circle" size={24} /></div>
          <h1 className="auth-title">This link is invalid or expired</h1>
          <p className="auth-sub">
            Reset links expire after about an hour and can only be used once. Request a new one to continue.
          </p>
          <a href="/forgot-password" className="auth-primary" style={{ display: "flex", alignItems: "center", justifyContent: "center", textDecoration: "none" }}>
            Request a new link
          </a>
        </>
      )}

      {status === "ready" && (
        <>
          <h1 className="auth-title">Choose a new password</h1>
          <p className="auth-sub">Make it something you haven&apos;t used here before.</p>
          {error && <div className="auth-error">{error}</div>}
          <form onSubmit={handleSubmit} className="auth-form">
            <div className="auth-field-group">
              <label className="auth-label" htmlFor="password">New password</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 6 characters"
                autoComplete="new-password"
                autoFocus
                required
                minLength={6}
                className="auth-field"
              />
            </div>
            <div className="auth-field-group">
              <label className="auth-label" htmlFor="confirm">Confirm password</label>
              <input
                id="confirm"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Type it again"
                autoComplete="new-password"
                required
                minLength={6}
                className="auth-field"
              />
            </div>
            <button type="submit" disabled={busy} className="auth-primary">
              {busy ? "Saving…" : "Reset password"}
            </button>
          </form>
        </>
      )}

      {status === "done" && (
        <>
          <div className="auth-glyph is-ok"><Icon name="check" size={24} /></div>
          <h1 className="auth-title">Password updated</h1>
          <p className="auth-sub">
            We&apos;ve signed out any other devices for your security. You&apos;re still signed in here.
          </p>
          <button onClick={() => router.replace("/")} className="auth-primary">Continue to AgoraSphere</button>
        </>
      )}
    </AuthShell>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordInner />
    </Suspense>
  );
}
