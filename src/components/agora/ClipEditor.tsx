"use client";

/* Twitch-style clip editor: pressing ✂ on the replay player opens this
   panel over the video. It pre-selects the last 30 seconds, shows a
   zoomed timeline strip around the capture point, and the viewer drags
   the in/out handles (or slides the whole window) while the video loops
   the selection live. Title it, save, and the success card offers the
   clip link straight away.

   The editor drives the HOST player's <video> element (no second
   decoder): while open it owns playback — seeking to the window start,
   looping at the end — and hands control back on close. */

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { Icon } from "@/components/icons";

const GOLD = "#e2b96b";
const MIN_LEN = 3;
const MAX_LEN = 90;
/** The strip shows this much VOD around the capture point. */
const ZOOM_SPAN = 150;

function fmt(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60).toString().padStart(2, "0");
  return `${m}:${sec}`;
}

export default function ClipEditor({
  videoRef,
  duration,
  captureAt,
  roomId,
  onClose,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  duration: number;
  /** currentTime when ✂ was pressed — the moment worth keeping. */
  captureAt: number;
  roomId: string;
  onClose: () => void;
}) {
  /* Zoom region centered on the capture point, clamped to the VOD. */
  const z0 = Math.max(0, Math.min(captureAt - ZOOM_SPAN * 0.7, duration - ZOOM_SPAN));
  const z1 = Math.min(duration, z0 + ZOOM_SPAN);
  const zSpan = Math.max(1, z1 - z0);

  const [selStart, setSelStart] = useState(() => Math.max(z0, captureAt - 30));
  const [selEnd, setSelEnd] = useState(() => Math.min(z1, Math.max(z0 + MIN_LEN, captureAt)));
  const [playhead, setPlayhead] = useState(captureAt);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const selRef = useRef({ start: selStart, end: selEnd });
  selRef.current = { start: selStart, end: selEnd };

  /* While open, the editor owns playback: loop the selection. */
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = selRef.current.start;
    v.play().catch(() => {});
    const onTime = () => {
      const { start, end } = selRef.current;
      if (v.currentTime >= end - 0.05 || v.currentTime < start - 1) {
        v.currentTime = start;
        if (v.paused) v.play().catch(() => {});
      }
      setPlayhead(v.currentTime);
    };
    v.addEventListener("timeupdate", onTime);
    return () => {
      v.removeEventListener("timeupdate", onTime);
      v.pause();
    };
  }, [videoRef]);

  /* Restart the loop from the new start whenever the window moves. */
  const jumpTo = useCallback((t: number) => {
    const v = videoRef.current;
    if (v) {
      v.currentTime = t;
      if (v.paused) v.play().catch(() => {});
    }
  }, [videoRef]);

  const timeAtClientX = useCallback((clientX: number) => {
    const el = stripRef.current;
    if (!el) return z0;
    const r = el.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    return z0 + pct * zSpan;
  }, [z0, zSpan]);

  /* One drag handler for the three grips: 'start' | 'end' | 'move'. */
  const beginDrag = useCallback((mode: "start" | "end" | "move") => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const grabT = timeAtClientX(e.clientX);
    const orig = { ...selRef.current };
    const move = (ev: PointerEvent) => {
      const t = timeAtClientX(ev.clientX);
      if (mode === "start") {
        const ns = Math.max(z0, Math.min(t, orig.end - MIN_LEN));
        setSelStart(Math.max(ns, orig.end - MAX_LEN));
      } else if (mode === "end") {
        const ne = Math.min(z1, Math.max(t, orig.start + MIN_LEN));
        setSelEnd(Math.min(ne, orig.start + MAX_LEN));
      } else {
        const span = orig.end - orig.start;
        let ns = orig.start + (t - grabT);
        ns = Math.max(z0, Math.min(ns, z1 - span));
        setSelStart(ns);
        setSelEnd(ns + span);
      }
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      void ev;
      jumpTo(selRef.current.start);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }, [timeAtClientX, z0, z1, jumpTo]);

  const save = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const supabase = createClient();
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) {
        window.location.href = "/login";
        return;
      }
      const start = Math.floor(selStart);
      const end = Math.ceil(selEnd);
      const { data, error } = await supabase
        .from("clips")
        .insert({
          uploader_id: auth.user.id,
          title: title.trim() || "Clip",
          room_id: roomId,
          start_seconds: start,
          end_seconds: end,
          duration_seconds: Math.max(1, end - start),
        })
        .select("id")
        .single();
      if (error) throw error;
      setSavedId((data as { id: string }).id);
    } catch (e) {
      console.warn("clip save failed", e);
      setErr("Couldn't save the clip — try again.");
    } finally {
      setBusy(false);
    }
  }, [busy, selStart, selEnd, title, roomId]);

  const pctOf = (t: number) => ((t - z0) / zSpan) * 100;
  const selLen = selEnd - selStart;

  const label: React.CSSProperties = {
    fontSize: 11, color: "#a8a8b2", fontFamily: "'DM Mono', monospace", whiteSpace: "nowrap",
  };

  /* ── Saved: hand over the link ── */
  if (savedId) {
    const link = `${window.location.origin}/clips/${savedId}`;
    return (
      <div className="rp-clip-panel" style={panelStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, color: "#f4d47c", fontWeight: 600 }}>Clip saved ✓</span>
          <span style={{ fontSize: 12, color: "#c0c0c8", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 300 }}>{link}</span>
          <span style={{ flex: 1 }} />
          <button
            onClick={() => {
              navigator.clipboard.writeText(link).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }).catch(() => {});
            }}
            style={pillBtn("#2f7fe0", "#fff")}
          >
            {copied ? "Copied ✓" : "Copy link"}
          </button>
          <a href={`/clips/${savedId}`} style={{ ...pillBtn("#d9a238", "#2b1a02"), textDecoration: "none" }}>
            View clip →
          </a>
          <button onClick={onClose} aria-label="Close" style={ghostBtn}>✕</button>
        </div>
      </div>
    );
  }

  return (
    <div className="rp-clip-panel" style={panelStyle} onPointerDown={(e) => e.stopPropagation()}>
      {/* Timeline strip */}
      <div
        ref={stripRef}
        onPointerDown={(e) => {
          // click outside the band: recenter the window there
          const t = timeAtClientX(e.clientX);
          const span = selLen;
          let ns = t - span / 2;
          ns = Math.max(z0, Math.min(ns, z1 - span));
          setSelStart(ns);
          setSelEnd(ns + span);
          jumpTo(ns);
        }}
        style={{ position: "relative", height: 44, borderRadius: 8, background: "rgba(255,255,255,0.08)", cursor: "pointer", touchAction: "none" }}
      >
        {/* selection band */}
        <div
          onPointerDown={beginDrag("move")}
          style={{
            position: "absolute", top: 0, bottom: 0,
            left: `${pctOf(selStart)}%`, width: `${((selLen) / zSpan) * 100}%`,
            background: "rgba(226,185,107,0.28)",
            border: `1.5px solid ${GOLD}`, borderRadius: 8, cursor: "grab",
          }}
        />
        {/* in/out grips */}
        {(["start", "end"] as const).map((m) => (
          <div
            key={m}
            onPointerDown={beginDrag(m)}
            style={{
              position: "absolute", top: -4, bottom: -4,
              left: `calc(${pctOf(m === "start" ? selStart : selEnd)}% - 6px)`,
              width: 12, borderRadius: 6, background: GOLD, cursor: "ew-resize",
              boxShadow: "0 0 8px rgba(226,185,107,0.5)",
            }}
          />
        ))}
        {/* playhead */}
        <div style={{
          position: "absolute", top: 0, bottom: 0, width: 2, background: "#fff",
          left: `${pctOf(Math.max(z0, Math.min(z1, playhead)))}%`, pointerEvents: "none", opacity: 0.9,
        }} />
      </div>

      {/* Readouts + title + actions */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
        <span style={label}>{fmt(selStart)} → {fmt(selEnd)}</span>
        <span style={{ ...label, color: selLen >= MAX_LEN - 0.5 ? "#f4d47c" : "#a8a8b2" }}>
          {selLen.toFixed(0)}s{selLen >= MAX_LEN - 0.5 ? " (max)" : ""}
        </span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title your clip…"
          maxLength={120}
          className="outline-none"
          style={{
            flex: 1, minWidth: 160, padding: "8px 12px",
            background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.14)",
            borderRadius: 10, color: "#f5f5f0", fontSize: 13, fontFamily: "'DM Sans', sans-serif",
          }}
        />
        {err && <span style={{ fontSize: 11.5, color: "#fca5a5" }}>{err}</span>}
        <button onClick={onClose} style={ghostBtn}>Cancel</button>
        <button onClick={save} disabled={busy} style={{ ...pillBtn("#d9a238", "#2b1a02"), opacity: busy ? 0.6 : 1 }}>
          {busy ? "Saving…" : (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Icon name="scissors" size={13} /> Save clip
            </span>
          )}
        </button>
      </div>
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  position: "absolute", left: 10, right: 10, bottom: 10,
  padding: "12px 14px",
  background: "rgba(10,10,14,0.92)",
  border: "0.5px solid rgba(255,255,255,0.14)",
  borderRadius: 14,
  backdropFilter: "blur(14px)",
  zIndex: 5,
};

function pillBtn(bg: string, color: string): React.CSSProperties {
  return {
    background: bg, border: "none", color,
    fontFamily: "'DM Sans', sans-serif", fontSize: 12.5, fontWeight: 600,
    padding: "8px 16px", borderRadius: 100, cursor: "pointer", whiteSpace: "nowrap",
  };
}

const ghostBtn: React.CSSProperties = {
  background: "transparent", border: "none", color: "#8b8b94",
  fontFamily: "'DM Sans', sans-serif", fontSize: 12.5, padding: "8px 6px", cursor: "pointer",
};
