"use client";

import { useEffect, useState } from "react";
import Wordmark from "@/components/Wordmark";
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
      return "That username may already be taken — try another.";
    if (m.includes("rate limit")) return "Too many attempts — wait a minute and try again.";
    return message;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);

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
      let json: { error?: string; twoFactor?: boolean; pending?: string } = {};
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

  const inputStyle: React.CSSProperties = {
    width: "100%",
    height: "42px",
    background: "rgba(255,255,255,0.04)",
    border: "1px solid var(--border)",
    borderRadius: "10px",
    color: "var(--text-primary)",
    fontFamily: "'DM Sans', sans-serif",
    fontSize: "13.5px",
    padding: "0 14px",
    outline: "none",
    transition: "border-color 0.15s, background 0.15s",
  };

  function focusRing(e: React.FocusEvent<HTMLInputElement>) {
    e.currentTarget.style.borderColor = "rgba(59,130,246,0.55)";
    e.currentTarget.style.background = "rgba(255,255,255,0.06)";
  }
  function blurRing(e: React.FocusEvent<HTMLInputElement>) {
    e.currentTarget.style.borderColor = "var(--border)";
    e.currentTarget.style.background = "rgba(255,255,255,0.04)";
  }

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: "11.5px",
    fontWeight: 600,
    letterSpacing: "0.02em",
    color: "var(--text-muted)",
    marginBottom: "6px",
  };

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center relative overflow-hidden px-4 py-10"
      style={{ background: "var(--bg-primary)" }}
    >
      {/* Ambient glow */}
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
      {/* Faint grid backdrop */}
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
        {/* Brand */}
        <a href="/" className="no-underline mb-8 flex items-center gap-2.5">
          <Wordmark size={26} />
        </a>

        {/* Card */}
        <div
          className="w-full"
          style={{
            background: "rgba(18,18,21,0.7)",
            border: "1px solid var(--border)",
            borderRadius: "20px",
            padding: "28px 32px",
            boxShadow: "0 24px 80px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.04)",
            backdropFilter: "blur(16px)",
            WebkitBackdropFilter: "blur(16px)",
          }}
        >
          {/* Mode tabs (hidden in 2FA mode) */}
          {mode !== "2fa" && (
            <div
              className="flex w-full mb-6"
              style={{
                background: "rgba(255,255,255,0.04)",
                border: "1px solid var(--border)",
                borderRadius: "100px",
                padding: "3px",
              }}
            >
              {(["signin", "signup"] as Mode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => {
                    setMode(m);
                    setError(null);
                    setNotice(null);
                  }}
                  className="flex-1 cursor-pointer transition-all"
                  style={{
                    border: "none",
                    borderRadius: "100px",
                    padding: "8px 0",
                    fontFamily: "'DM Sans', sans-serif",
                    fontSize: "13px",
                    fontWeight: 600,
                    background: mode === m ? "var(--accent-blue)" : "transparent",
                    color: mode === m ? "#fff" : "var(--text-muted)",
                  }}
                >
                  {m === "signin" ? "Sign in" : "Create account"}
                </button>
              ))}
            </div>
          )}

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
            {mode === "2fa" ? "Verify your identity" : mode === "signin" ? "Welcome back" : "Create your account"}
          </h1>
          <p
            className="text-center"
            style={{
              color: "var(--text-muted)",
              fontSize: "13px",
              lineHeight: 1.5,
              marginBottom: "22px",
            }}
          >
            {mode === "2fa"
              ? `A code was sent to ${twoFactorEmail}. Check your inbox.`
              : mode === "signin"
                ? "Sign in to speak, vote, and follow people."
                : "Join live discussions, share your perspective, and be heard."}
          </p>

          {/* Error / notice banners */}
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
          {notice && (
            <div
              style={{
                background: "rgba(16,185,129,0.08)",
                border: "1px solid rgba(16,185,129,0.3)",
                borderRadius: "10px",
                color: "#6ee7b7",
                fontSize: "12.5px",
                lineHeight: 1.5,
                padding: "10px 14px",
                marginBottom: "16px",
              }}
            >
              {notice}
            </div>
          )}

          {/* Email / password form or 2FA form */}
          {mode === "2fa" ? (
            <form onSubmit={handleTwoFactorSubmit} className="flex flex-col gap-4">
              <div>
                <label style={labelStyle} htmlFor="2fa-code">
                  Verification code
                </label>
                <input
                  id="2fa-code"
                  type="text"
                  inputMode="numeric"
                  value={twoFactorCode}
                  onChange={(e) => setTwoFactorCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  onFocus={focusRing}
                  onBlur={blurRing}
                  placeholder="000000"
                  autoComplete="off"
                  required
                  style={{ ...inputStyle, letterSpacing: "0.2em", textAlign: "center", fontSize: "18px" }}
                />
              </div>

              <button
                type="submit"
                disabled={busy || twoFactorCode.length !== 6}
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
                  opacity: busy || twoFactorCode.length !== 6 ? 0.7 : 1,
                }}
                onMouseEnter={(e) => {
                  if (!busy && twoFactorCode.length === 6) e.currentTarget.style.background = "var(--accent-purple-light)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "var(--accent-blue)";
                }}
              >
                {busy ? "Verifying…" : "Verify"}
              </button>

              <button
                type="button"
                onClick={handleResend}
                disabled={resendWait > 0 || busy}
                className="w-full cursor-pointer transition-colors"
                style={{
                  background: "transparent",
                  border: "none",
                  color: resendWait > 0 ? "var(--text-dim)" : "var(--text-muted)",
                  fontFamily: "'DM Sans', sans-serif",
                  fontSize: "12.5px",
                  fontWeight: 500,
                  padding: "2px 0 0",
                }}
              >
                {resendWait > 0 ? `Resend code in ${resendWait}s` : "Didn't get it? Resend code"}
              </button>

              <button
                type="button"
                onClick={() => {
                  setMode("signin");
                  setTwoFactorCode("");
                  setPendingId(null);
                  setError(null);
                  setNotice(null);
                }}
                className="w-full cursor-pointer transition-all"
                style={{
                  background: "transparent",
                  border: "1px solid var(--border)",
                  borderRadius: "100px",
                  color: "var(--text-muted)",
                  fontFamily: "'DM Sans', sans-serif",
                  fontSize: "14px",
                  fontWeight: 600,
                  padding: "12px 20px",
                }}
              >
                Back to sign in
              </button>
            </form>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {mode === "signup" && (
              <div>
                <label style={labelStyle} htmlFor="username">
                  Username
                </label>
                <input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  onFocus={focusRing}
                  onBlur={blurRing}
                  placeholder="your_handle"
                  autoComplete="username"
                  required
                  style={inputStyle}
                />
              </div>
            )}

            <div>
              <label style={labelStyle} htmlFor="email">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onFocus={focusRing}
                onBlur={blurRing}
                placeholder="you@example.com"
                autoComplete="email"
                required
                style={inputStyle}
              />
            </div>

            <div>
              <div className="flex items-center justify-between" style={{ marginBottom: 6 }}>
                <label style={{ ...labelStyle, marginBottom: 0 }} htmlFor="password">
                  Password
                </label>
                {mode === "signin" && (
                  <a
                    href="/forgot-password"
                    className="no-underline transition-colors"
                    style={{ fontSize: "11.5px", color: "var(--text-muted)", fontWeight: 500 }}
                  >
                    Forgot password?
                  </a>
                )}
              </div>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onFocus={focusRing}
                onBlur={blurRing}
                placeholder={mode === "signup" ? "At least 6 characters" : "Your password"}
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                required
                minLength={6}
                style={inputStyle}
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
              {busy
                ? mode === "signin"
                  ? "Signing in…"
                  : "Creating account…"
                : mode === "signin"
                  ? "Sign in"
                  : "Create account"}
            </button>
          </form>
          )}

          {/* Divider (hidden in 2FA mode) */}
          {mode !== "2fa" && (
          <div className="flex items-center gap-3" style={{ margin: "20px 0" }}>
            <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
            <span style={{ fontSize: "11px", color: "var(--text-dim)", fontWeight: 500 }}>OR</span>
            <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
          </div>
          )}

          {/* Google sign-in (hidden in 2FA mode) */}
          {mode !== "2fa" && (
          <button
            onClick={signInWithGoogle}
            className="w-full flex items-center justify-center gap-3 cursor-pointer transition-all"
            style={{
              background: "#fff",
              border: "none",
              borderRadius: "100px",
              color: "#1f1f1f",
              fontFamily: "'DM Sans', sans-serif",
              fontSize: "14px",
              fontWeight: 600,
              padding: "11px 20px",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "#f1f1f1";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "#fff";
            }}
          >
            <svg width="17" height="17" viewBox="0 0 48 48">
              <path
                fill="#EA4335"
                d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
              />
              <path
                fill="#4285F4"
                d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
              />
              <path
                fill="#FBBC05"
                d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
              />
              <path
                fill="#34A853"
                d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
              />
            </svg>
            Continue with Google
          </button>
          )}
        </div>

        {/* Terms */}
        <p
          className="text-center"
          style={{
            marginTop: "20px",
            fontSize: "11.5px",
            color: "var(--text-dim)",
            lineHeight: 1.6,
            maxWidth: "320px",
          }}
        >
          By continuing, you agree to AgoraSphere&apos;s Terms of Service and acknowledge our
          Privacy Policy.
        </p>

        {/* Back link */}
        <a
          href="/"
          className="no-underline transition-colors"
          style={{ marginTop: "14px", fontSize: "12.5px", color: "var(--text-muted)", fontWeight: 500 }}
        >
          ← Browse discussions without signing in
        </a>
      </main>
    </div>
  );
}
