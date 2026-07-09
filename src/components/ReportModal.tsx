"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";

export interface ReportTarget {
  userId: string;
  username: string;
  context: "room" | "profile" | "chat" | "history";
  roomId?: string | null;
  messageId?: string | null;
  /** Shown to the reporter as a quote so they can confirm what they're reporting. */
  messagePreview?: string | null;
}

const REASONS: { value: string; label: string }[] = [
  { value: "harassment", label: "Harassment" },
  { value: "hate_speech", label: "Hate speech" },
  { value: "threats_violence", label: "Threats / violence" },
  { value: "spam", label: "Spam" },
  { value: "sexual_content", label: "Sexual content" },
  { value: "misinformation", label: "Misinformation" },
  { value: "impersonation", label: "Impersonation" },
  { value: "inappropriate_username", label: "Inappropriate username" },
  { value: "other", label: "Other" },
];

export default function ReportModal({
  target,
  onClose,
}: {
  target: ReportTarget | null;
  onClose: () => void;
}) {
  const supabase = createClient();
  const [reason, setReason] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Fresh form every time a new target opens.
  useEffect(() => {
    if (target) {
      setReason(null);
      setDescription("");
      setError(null);
      setDone(false);
    }
  }, [target]);

  if (!target) return null;

  async function handleSubmit() {
    if (!target) return;
    setError(null);
    if (!reason) {
      setError("Pick a reason first.");
      return;
    }
    if (reason === "other" && !description.trim()) {
      setError("Please describe the problem when choosing Other.");
      return;
    }
    setBusy(true);
    const { error: rpcErr } = await supabase.rpc("submit_report", {
      p_reported: target.userId,
      p_reason: reason,
      p_description: description.trim() || null,
      p_context: target.context,
      p_room: target.roomId ?? null,
      p_message: target.messageId ?? null,
    });
    setBusy(false);
    if (rpcErr) {
      const m = rpcErr.message || "";
      if (m.includes("not_authenticated")) setError("Sign in to report users.");
      else if (m.includes("cannot_report_self")) setError("You can't report yourself.");
      else if (m.includes("description_required"))
        setError("Please describe the problem when choosing Other.");
      else setError("Could not submit report — " + m);
      return;
    }
    setDone(true);
  }

  return (
    <div
      className="fixed inset-0 z-[1200] flex items-center justify-center p-5"
      style={{
        background: "rgba(0,0,0,0.8)",
        backdropFilter: "blur(4px)",
        animation: "modalIn 0.2s ease",
      }}
      onClick={onClose}
    >
      <div
        className="w-full"
        style={{
          maxWidth: 420,
          background: "rgba(18,18,21,0.97)",
          border: "1px solid var(--border)",
          borderRadius: 20,
          boxShadow: "0 24px 80px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.04)",
          padding: "22px 22px 20px",
          animation: "modalPanelIn 0.25s cubic-bezier(0.25, 0.46, 0.45, 0.94)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {done ? (
          <>
            <div
              className="flex items-center justify-center mx-auto mb-4"
              style={{
                width: 52,
                height: 52,
                borderRadius: "50%",
                background: "rgba(34,197,94,0.1)",
                border: "1px solid rgba(34,197,94,0.3)",
              }}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </div>
            <h2
              className="text-center"
              style={{
                fontFamily: "'DM Sans', sans-serif",
                fontSize: 17,
                fontWeight: 700,
                letterSpacing: "-0.02em",
                color: "var(--text-primary)",
                marginBottom: 6,
              }}
            >
              Report submitted
            </h2>
            <p
              className="text-center"
              style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.55, marginBottom: 18 }}
            >
              Thanks for helping keep AgoraSphere safe. Our team will review this report.
            </p>
            <button
              onClick={onClose}
              className="w-full cursor-pointer transition-all"
              style={{
                background: "rgba(255,255,255,0.05)",
                border: "1px solid var(--border)",
                borderRadius: 100,
                color: "var(--text-primary)",
                fontFamily: "'DM Sans', sans-serif",
                fontSize: 13.5,
                fontWeight: 600,
                padding: "11px 18px",
              }}
            >
              Done
            </button>
          </>
        ) : (
          <>
            <div className="flex items-start justify-between mb-1">
              <h2
                style={{
                  fontFamily: "'DM Sans', sans-serif",
                  fontSize: 17,
                  fontWeight: 700,
                  letterSpacing: "-0.02em",
                  color: "var(--text-primary)",
                }}
              >
                Report @{target.username}
              </h2>
              <button
                onClick={onClose}
                className="flex items-center justify-center cursor-pointer transition-all"
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 8,
                  color: "var(--text-muted)",
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid var(--border)",
                }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
            <p style={{ color: "var(--text-muted)", fontSize: 12.5, lineHeight: 1.5, marginBottom: 16 }}>
              Your report is confidential — @{target.username} won&apos;t know who reported them.
            </p>

            {target.messagePreview && (
              <div
                style={{
                  padding: "9px 12px",
                  borderRadius: 10,
                  background: "rgba(255,255,255,0.03)",
                  borderLeft: "2px solid rgba(239,68,68,0.5)",
                  color: "var(--text-muted)",
                  fontSize: 12.5,
                  lineHeight: 1.5,
                  marginBottom: 14,
                  maxHeight: 72,
                  overflow: "hidden",
                }}
              >
                &ldquo;{target.messagePreview}&rdquo;
              </div>
            )}

            {error && (
              <div
                style={{
                  background: "rgba(239,68,68,0.08)",
                  border: "1px solid rgba(239,68,68,0.3)",
                  borderRadius: 10,
                  color: "#fca5a5",
                  fontSize: 12.5,
                  lineHeight: 1.5,
                  padding: "9px 12px",
                  marginBottom: 14,
                }}
              >
                {error}
              </div>
            )}

            <div
              className="grid gap-1.5 mb-4"
              style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}
            >
              {REASONS.map((r) => {
                const active = reason === r.value;
                return (
                  <button
                    key={r.value}
                    onClick={() => setReason(r.value)}
                    className="cursor-pointer transition-all text-left"
                    style={{
                      padding: "9px 12px",
                      borderRadius: 10,
                      fontSize: 12.5,
                      fontWeight: active ? 600 : 500,
                      fontFamily: "'DM Sans', sans-serif",
                      background: active ? "rgba(239,68,68,0.1)" : "rgba(255,255,255,0.03)",
                      border: active
                        ? "1px solid rgba(239,68,68,0.45)"
                        : "1px solid var(--border)",
                      color: active ? "#fca5a5" : "var(--text-muted)",
                    }}
                  >
                    {r.label}
                  </button>
                );
              })}
            </div>

            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value.slice(0, 1000))}
              placeholder={
                reason === "other"
                  ? "Describe the problem (required)…"
                  : "Add details (optional)…"
              }
              rows={3}
              className="w-full outline-none transition-all"
              style={{
                padding: "10px 13px",
                background: "rgba(255,255,255,0.04)",
                border: "1px solid var(--border)",
                borderRadius: 10,
                color: "var(--text-primary)",
                fontFamily: "'DM Sans', sans-serif",
                fontSize: 13,
                resize: "none",
                marginBottom: 16,
              }}
              onFocus={(e) => { e.currentTarget.style.borderColor = "rgba(239,68,68,0.45)"; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = "var(--border)"; }}
            />

            <div className="flex gap-2">
              <button
                onClick={onClose}
                disabled={busy}
                className="flex-1 cursor-pointer transition-all"
                style={{
                  padding: "11px 16px",
                  borderRadius: 100,
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid var(--border)",
                  color: "var(--text-muted)",
                  fontFamily: "'DM Sans', sans-serif",
                  fontSize: 13.5,
                  fontWeight: 600,
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={busy || !reason}
                className="flex-1 cursor-pointer transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  padding: "11px 16px",
                  borderRadius: 100,
                  background: "#ef4444",
                  border: "none",
                  color: "#fff",
                  fontFamily: "'DM Sans', sans-serif",
                  fontSize: 13.5,
                  fontWeight: 600,
                }}
              >
                {busy ? "Submitting…" : "Submit report"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
