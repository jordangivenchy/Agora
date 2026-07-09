"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";

type Mode = "signin" | "signup";

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

  // Already signed in? Straight to the app.
  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) router.replace("/");
    });
    return () => subscription.unsubscribe();
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
      router.replace("/");
    } else {
      setBusy(true);
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      setBusy(false);
      if (error) {
        setError(friendlyError(error.message));
        return;
      }
      router.replace("/");
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
          <img src="/logo.png" alt="AgoraSphere" className="h-[26px] w-auto" />
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
          {/* Mode tabs */}
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
            {mode === "signin" ? "Welcome back" : "Welcome to the arena"}
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
            {mode === "signin"
              ? "Sign in to debate, vote, and follow debaters."
              : "Join live debates, challenge ideas, and sharpen your arguments."}
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

          {/* Email / password form */}
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

          {/* Divider */}
          <div className="flex items-center gap-3" style={{ margin: "20px 0" }}>
            <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
            <span style={{ fontSize: "11px", color: "var(--text-dim)", fontWeight: 500 }}>OR</span>
            <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
          </div>

          {/* Google sign-in */}
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
          ← Browse debates without signing in
        </a>
      </main>
    </div>
  );
}
