"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";

interface Props {
  open: boolean;
  onClose: () => void;
}

type JoinChoice =
  | { role: "debater"; stance: "PRO" | "CON" }
  | { role: "spectator"; stance: null };

export default function JoinPrivateRoomModal({ open, onClose }: Props) {
  const router = useRouter();
  const supabase = createClient();

  const [code, setCode] = useState("");
  const [choice, setChoice] = useState<JoinChoice>({ role: "debater", stance: "PRO" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [navigating, setNavigating] = useState(false);

  if (!open && !navigating) return null;

  if (navigating) {
    return (
      <div
        className="fixed inset-0 z-[1000] flex items-center justify-center"
        style={{ background: "#0a0a0a" }}
      >
        <div
          className="animate-spin"
          style={{
            width: 32,
            height: 32,
            borderRadius: "50%",
            border: "2px solid var(--accent-blue)",
            borderTopColor: "transparent",
          }}
        />
      </div>
    );
  }

  function close() {
    setCode("");
    setError("");
    setChoice({ role: "debater", stance: "PRO" });
    onClose();
  }

  async function handleJoin() {
    const normalized = code.trim().toUpperCase();
    if (!normalized) {
      setError("Enter a 6-character code");
      return;
    }
    setLoading(true);
    setError("");

    try {
      // New v3 RPC returns a setof record (room_id uuid, queued boolean).
      // Supabase surfaces that as an array of rows; take the first.
      const { data, error: rpcErr } = await supabase.rpc("join_private_room", {
        p_code: normalized,
        p_role: choice.role,
        // Force stance=null when joining as spectator so legacy callers can't
        // accidentally promote a spectator to debater.
        p_stance: choice.role === "spectator" ? null : choice.stance,
      });

      if (rpcErr) {
        const msg = rpcErr.message || "";
        if (msg.includes("debate_live")) {
          // Debate already started — spectator is the only way in. Flip the
          // selection so their next click on Join goes through.
          setChoice({ role: "spectator", stance: null });
          setError("This debate is already live — you can join as a spectator. Press Join again.");
        } else if (msg.includes("not_authenticated")) {
          setError("Please sign in first, then try the code again.");
        } else if (msg.includes("invalid_or_expired_code")) {
          setError("No active private room matches that code.");
        } else if (msg.includes("invite_code_required")) {
          setError("Enter the 6-character code.");
        } else if (msg.includes("stance_slot_taken")) {
          setError(`That ${choice.role === "debater" ? choice.stance : ""} slot is already taken — pick the other side or Spectator.`);
        } else if (msg.includes("stance_required")) {
          setError("Pick PRO or CON to join as a debater.");
        } else {
          setError("Could not join — " + msg);
        }
        setLoading(false);
        return;
      }

      // data shape: [{ room_id: uuid, queued: boolean }] | null | uuid (legacy)
      let roomId: string | null = null;
      if (Array.isArray(data) && data.length > 0) {
        const row = data[0] as { room_id?: string; queued?: boolean };
        roomId = row.room_id ?? null;
      } else if (typeof data === "string") {
        // Legacy RPC shape (returned a bare uuid) — still supported.
        roomId = data;
      }

      if (!roomId) {
        setError("No active private room matches that code.");
        setLoading(false);
        return;
      }

      // Note: the new RPC queues non-host debaters (queued=true). The room
      // page handles the "waiting for host" UX, so we just navigate there.
      setNavigating(true);
      router.push(`/rooms/${roomId}?via=invite`);
    } catch (err: unknown) {
      const m = err instanceof Error ? err.message : "Something went wrong";
      setError(m);
      setLoading(false);
    }
  }

  const isPro = choice.role === "debater" && choice.stance === "PRO";
  const isCon = choice.role === "debater" && choice.stance === "CON";
  const isSpec = choice.role === "spectator";

  return (
    <div
      className="fixed inset-0 z-[500] flex items-center justify-center p-5"
      style={{
        background: "rgba(0,0,0,0.78)",
        backdropFilter: "blur(4px)",
        animation: "modalIn 0.2s ease",
      }}
      onClick={close}
    >
      <div
        className="w-full"
        style={{
          maxWidth: "440px",
          background: "rgba(18,18,21,0.95)",
          backdropFilter: "blur(24px)",
          border: "1px solid var(--border)",
          borderRadius: "20px",
          boxShadow: "0 24px 80px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.04)",
          padding: "24px 24px 22px",
          animation: "modalPanelIn 0.25s cubic-bezier(0.25, 0.46, 0.45, 0.94)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-1">
          <h2
            style={{
              fontFamily: "'DM Sans', sans-serif",
              fontSize: "17px",
              fontWeight: 700,
              letterSpacing: "-0.02em",
              color: "var(--text-primary)",
            }}
          >
            Join a Private Room
          </h2>
          <button
            onClick={close}
            className="flex items-center justify-center cursor-pointer transition-all"
            style={{
              width: 28,
              height: 28,
              borderRadius: "8px",
              color: "var(--text-muted)",
              background: "rgba(255,255,255,0.04)",
              border: "1px solid var(--border)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "var(--text-primary)";
              e.currentTarget.style.background = "rgba(255,255,255,0.08)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "var(--text-muted)";
              e.currentTarget.style.background = "rgba(255,255,255,0.04)";
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <p style={{ fontSize: "12.5px", color: "var(--text-muted)", marginBottom: "18px", lineHeight: 1.5 }}>
          Enter the 6-character invite code and pick your side.
        </p>

        {error && (
          <div
            className="text-sm rounded-lg px-3 py-2 mb-3"
            style={{
              background: "rgba(239,68,68,0.08)",
              border: "1px solid rgba(239,68,68,0.3)",
              color: "#fca5a5",
              fontSize: "12px",
            }}
          >
            {error}
          </div>
        )}

        {/* Code input */}
        <input
          type="text"
          value={code}
          onChange={(e) =>
            setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6))
          }
          onKeyDown={(e) => { if (e.key === "Enter") handleJoin(); }}
          placeholder="ABC123"
          className="w-full outline-none transition-all text-center"
          autoFocus
          style={{
            padding: "14px 16px",
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: "12px",
            color: "var(--text-primary)",
            fontFamily: "'DM Mono', monospace",
            fontSize: "22px",
            fontWeight: 600,
            letterSpacing: "0.34em",
            marginBottom: "16px",
          }}
          maxLength={6}
        />

        {/* Role selector */}
        <div
          className="block mb-2"
          style={{
            fontSize: "11px",
            fontWeight: 600,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "rgba(255,255,255,0.4)",
          }}
        >
          Join as
        </div>
        <div className="grid grid-cols-3 gap-2 mb-5">
          <RoleButton
            label="PRO"
            active={isPro}
            color="var(--pro-color)"
            onClick={() => setChoice({ role: "debater", stance: "PRO" })}
          />
          <RoleButton
            label="CON"
            active={isCon}
            color="var(--con-color)"
            onClick={() => setChoice({ role: "debater", stance: "CON" })}
          />
          <RoleButton
            label="Spectator"
            active={isSpec}
            color="var(--accent-blue)"
            onClick={() => setChoice({ role: "spectator", stance: null })}
          />
        </div>

        <button
          onClick={handleJoin}
          disabled={loading || code.trim().length === 0}
          className="w-full cursor-pointer transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          style={{
            background: "var(--accent-blue)",
            border: "none",
            color: "#fff",
            fontFamily: "'DM Sans', sans-serif",
            fontSize: "14px",
            fontWeight: 600,
            padding: "12px 20px",
            borderRadius: "100px",
          }}
          onMouseEnter={(e) => {
            if (!e.currentTarget.disabled)
              e.currentTarget.style.background = "var(--accent-purple-light)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "var(--accent-blue)";
          }}
        >
          {loading ? "Joining…" : "Join room"}
        </button>
      </div>
    </div>
  );
}

function RoleButton({
  label,
  active,
  color,
  onClick,
}: {
  label: string;
  active: boolean;
  color: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="cursor-pointer transition-all"
      style={{
        padding: "10px 0",
        borderRadius: "10px",
        background: active ? `${color}` : "rgba(255,255,255,0.04)",
        border: active ? `1px solid ${color}` : "1px solid var(--border)",
        color: active ? "white" : "var(--text-muted)",
        fontFamily: "'DM Sans', sans-serif",
        fontSize: "12.5px",
        fontWeight: 600,
        letterSpacing: "0.03em",
      }}
    >
      {label}
    </button>
  );
}
