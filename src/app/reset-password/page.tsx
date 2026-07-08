"use client";

import { Suspense, useEffect, useState } from "react";
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
    await supabase.auth.signOut({ scope: "others" });

    setBusy(false);
    setStatus("done");
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
  function focusRing(e: React.FocusEvent<HTMLInputElement>) {
    e.currentTarget.style.borderColor = "rgba(59,130,246,0.55)";
  }
  function blurRing(e: React.FocusEvent<HTMLInputElement>) {
    e.currentTarget.style.borderColor = "var(--border)";
  }

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
          {status === "checking" && (
            <div className="flex items-center justify-center py-10">
              <div
                className="animate-spin"
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: "50%",
                  border: "2px solid var(--accent-blue)",
                  borderTopColor: "transparent",
                }}
              />
            </div>
          )}

          {status === "invalid" && (
            <>
              <div
                className="flex items-center justify-center mx-auto mb-5"
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: "50%",
                  background: "rgba(239,68,68,0.1)",
                  border: "1px solid rgba(239,68,68,0.3)",
                }}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fca5a5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
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
                This link is invalid or expired
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
                Reset links expire after about an hour and can only be used once. Request a
                new one to continue.
              </p>
              <a
                href="/forgot-password"
                className="w-full flex items-center justify-center cursor-pointer transition-all no-underline"
                style={{
                  background: "var(--accent-blue)",
                  borderRadius: "100px",
                  color: "#fff",
                  fontFamily: "'DM Sans', sans-serif",
                  fontSize: "14px",
                  fontWeight: 600,
                  padding: "12px 20px",
                }}
              >
                Request a new link
              </a>
            </>
          )}

          {status === "ready" && (
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
                Choose a new password
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
                Make it something you haven&apos;t used here before.
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

              <form onSubmit={handleSubmit} className="flex flex-col gap-4">
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
                    htmlFor="password"
                  >
                    New password
                  </label>
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
                    style={inputStyle}
                    onFocus={focusRing}
                    onBlur={blurRing}
                  />
                </div>
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
                    htmlFor="confirm"
                  >
                    Confirm password
                  </label>
                  <input
                    id="confirm"
                    type="password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="Type it again"
                    autoComplete="new-password"
                    required
                    minLength={6}
                    style={inputStyle}
                    onFocus={focusRing}
                    onBlur={blurRing}
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
                  {busy ? "Saving…" : "Reset password"}
                </button>
              </form>
            </>
          )}

          {status === "done" && (
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
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6 9 17l-5-5" />
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
                Password updated
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
                We&apos;ve signed out any other devices for your security. You&apos;re still
                signed in here.
              </p>
              <button
                onClick={() => router.replace("/")}
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
                }}
              >
                Continue to AgoraSphere
              </button>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordInner />
    </Suspense>
  );
}
