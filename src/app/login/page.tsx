"use client";

import { useEffect, useState } from "react";
import AuthShell from "@/components/auth/AuthShell";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";

type Mode = "signin" | "signup" | "2fa";

export default function LoginPage() {
  const supabase = createClient();
  const router = useRouter();

  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /* Sign-in refused because the address is unverified — offer to resend. */
  const [unconfirmed, setUnconfirmed] = useState(false);

  // 2FA state — the challenge lives server-side; we only hold its id.
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [twoFactorEmail, setTwoFactorEmail] = useState("");
  const [resendWait, setResendWait] = useState(0);

  useEffect(() => {
    if (resendWait <= 0) return;
    const t = setTimeout(() => setResendWait((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendWait]);

  // Already signed in? Straight to the app — unless the account is
  // suspended, in which case end the session here with an explanation.
  // The DB blocks all writes for suspended accounts regardless; this
  // gate just keeps them from landing in an app that half-works.
  useEffect(() => {
    let cancelled = false;
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session?.user) return;
      (async () => {
        const { data: suspended } = await supabase.rpc("is_suspended");
        if (cancelled) return;
        if (suspended === true) {
          await supabase.auth.signOut();
          setBusy(false);
          setError("This account is suspended. Contact support if you believe this is a mistake.");
          return;
        }
        router.replace("/");
      })();
    });
    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [router, supabase]);

  function friendlyError(message: string): string {
    const m = message.toLowerCase();
    if (m.includes("invalid login credentials")) return "Wrong email or password.";
    if (m.includes("already registered")) return "That email already has an account — try signing in.";
    if (m.includes("password should be")) return "Password must be at least 6 characters.";
    if (m.includes("database error saving new user"))
      return "Couldn't create the account — try a different username or email.";
    if (m.includes("rate limit")) return "Too many attempts — wait a minute and try again.";
    if (m.includes("not confirmed")) return "Verify your email first — open the link we sent you, then sign in.";
    return message;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setUnconfirmed(false);

    if (mode === "signup") {
      const clean = username.trim().toLowerCase();
      if (!/^[a-z0-9_]{3,20}$/.test(clean)) {
        setError("Username must be 3–20 characters: lowercase letters, numbers, or underscores.");
        return;
      }
      setBusy(true);
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: { preferred_username: clean },
        },
      });
      setBusy(false);
      if (error) {
        setError(friendlyError(error.message));
        return;
      }
      // If email confirmation is enabled there's no session yet.
      if (!data.session) {
        setNotice("Account created — check your inbox for a confirmation link, then sign in.");
        setMode("signin");
        return;
      }
      // Redirect happens in the auth listener above, after the
      // suspension check. A direct replace here would race past it.
    } else {
      // Sign-in goes through our API so 2FA accounts never receive a
      // session from the password alone — the server checks the password,
      // emails a code, and only /verify sets auth cookies.
      setBusy(true);
      let json: { error?: string; twoFactor?: boolean; pending?: string; unconfirmed?: boolean } = {};
      try {
        const res = await fetch("/api/auth/2fa/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email.trim(), password }),
        });
        json = await res.json().catch(() => ({}));
        if (!res.ok) {
          setBusy(false);
          setError(json.error ?? "Sign-in failed. Try again.");
          setUnconfirmed(!!json.unconfirmed);
          return;
        }
      } catch {
        setBusy(false);
        setError("Sign-in failed. Check your connection and try again.");
        return;
      }

      if (json.twoFactor && json.pending) {
        setPendingId(json.pending);
        setTwoFactorEmail(email.trim());
        setTwoFactorCode("");
        setResendWait(60);
        setMode("2fa");
        setBusy(false);
        return;
      }

      await finishLogin();
    }
  }

  // Cookies were just set by the server; run the same suspension check the
  // auth listener does for client-side sign-ins, then enter the app with a
  // full navigation so every client picks up the new session.
  async function finishLogin() {
    const { data: suspended } = await supabase.rpc("is_suspended");
    if (suspended === true) {
      await supabase.auth.signOut().catch(() => {});
      setBusy(false);
      setMode("signin");
      setPendingId(null);
      setError("This account is suspended. Contact support if you believe this is a mistake.");
      return;
    }
    window.location.replace("/");
  }

  async function handleTwoFactorSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!pendingId || busy) return;

    setBusy(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/2fa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pending: pendingId, code: twoFactorCode }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBusy(false);
        setTwoFactorCode("");
        setError(json.error ?? "Invalid or expired code.");
        return;
      }
    } catch {
      setBusy(false);
      setError("Verification failed. Check your connection and try again.");
      return;
    }

    await finishLogin();
  }

  async function handleResend() {
    if (!pendingId || resendWait > 0 || busy) return;
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/auth/2fa/resend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pending: pendingId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "Couldn't resend the code.");
        return;
      }
      setTwoFactorCode("");
      setResendWait(60);
      setNotice("A new code is on its way.");
    } catch {
      setError("Couldn't resend the code. Check your connection.");
    }
  }

  async function signInWithGoogle() {
    setError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (error) setError(friendlyError(error.message));
  }

  const title = mode === "2fa" ? "Verify it's you" : mode === "signin" ? "Welcome back" : "Create your account";
  const sub = mode === "2fa"
    ? <>A code was sent to <b>{twoFactorEmail}</b>. Check your inbox.</>
    : mode === "signin"
      ? "Sign in to speak, vote, and follow people."
      : "Join live discussions, share your perspective, and be heard.";

  return (
    <AuthShell
      footer={<>
        <p className="auth-fine">By continuing, you agree to AgoraSphere&apos;s Terms of Service and acknowledge our Privacy Policy.</p>
        <a href="/" className="auth-link">Browse discussions without signing in</a>
      </>}
    >
      {mode !== "2fa" && (
        <div className="auth-tabs" role="tablist">
          {(["signin", "signup"] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              className={mode === m ? "is-active" : undefined}
              onClick={() => { setMode(m); setError(null); setNotice(null); }}
            >
              {m === "signin" ? "Sign in" : "Create account"}
            </button>
          ))}
        </div>
      )}

      <h1 className="auth-title">{title}</h1>
      <p className="auth-sub">{sub}</p>

      {error && (
        <div className="auth-error">
          {error}
          {unconfirmed && (
            <button
              type="button"
              disabled={resendWait > 0 || busy}
              onClick={async () => {
                const { error: err } = await supabase.auth.resend({ type: "signup", email: email.trim() });
                if (err) { setError(friendlyError(err.message)); return; }
                setNotice(`Verification link sent to ${email.trim()}. Check your inbox (and spam).`);
                setResendWait(30);
              }}
              className="auth-secondary is-small"
            >
              {resendWait > 0 ? `Resend in ${resendWait}s` : "Resend the verification link"}
            </button>
          )}
        </div>
      )}
      {notice && <div className="auth-notice">{notice}</div>}

      {mode === "2fa" ? (
        <form onSubmit={handleTwoFactorSubmit} className="auth-form">
          <div className="auth-field-group">
            <label className="auth-label" htmlFor="2fa-code">Verification code</label>
            <input
              id="2fa-code"
              type="text"
              inputMode="numeric"
              value={twoFactorCode}
              onChange={(e) => setTwoFactorCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="000000"
              autoComplete="one-time-code"
              required
              className="auth-field is-code"
            />
          </div>
          <button type="submit" disabled={busy || twoFactorCode.length !== 6} className="auth-primary">
            {busy ? "Verifying…" : "Verify"}
          </button>
          <button type="button" onClick={handleResend} disabled={resendWait > 0 || busy} className="auth-quiet">
            {resendWait > 0 ? `Resend code in ${resendWait}s` : "Didn't get it? Resend code"}
          </button>
          <button
            type="button"
            onClick={() => { setMode("signin"); setTwoFactorCode(""); setPendingId(null); setError(null); setNotice(null); }}
            className="auth-secondary"
          >
            Back to sign in
          </button>
        </form>
      ) : (
        <form onSubmit={handleSubmit} className="auth-form">
          {mode === "signup" && (
            <div className="auth-field-group">
              <label className="auth-label" htmlFor="username">Username</label>
              <div className="auth-handle">
                <span aria-hidden="true">@</span>
                <input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="your_handle"
                  autoComplete="username"
                  required
                  className="auth-field is-mono"
                />
              </div>
            </div>
          )}
          <div className="auth-field-group">
            <label className="auth-label" htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              required
              className="auth-field"
            />
          </div>
          <div className="auth-field-group">
            <label className="auth-label" htmlFor="password">
              Password
              {mode === "signin" && <a href="/forgot-password" className="auth-link" style={{ fontSize: 11.5 }}>Forgot password?</a>}
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === "signup" ? "At least 6 characters" : "Your password"}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              required
              minLength={6}
              className="auth-field"
            />
          </div>
          <button type="submit" disabled={busy} className="auth-primary">
            {busy ? (mode === "signin" ? "Signing in…" : "Creating account…") : (mode === "signin" ? "Sign in" : "Create account")}
          </button>
        </form>
      )}

      {mode !== "2fa" && (
        <>
          <div className="auth-divider">or</div>
          <button type="button" onClick={signInWithGoogle} className="auth-google">
            <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden="true">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
            </svg>
            Continue with Google
          </button>
        </>
      )}
    </AuthShell>
  );
}
