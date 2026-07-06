"use client";

/* Trending tab — desktop-YouTube-style feed of debate videos with a
   Shorts shelf. Real live/ended rooms lead the grid; seeded VODs and
   clips fill in until real recordings exist. */

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { SEED_SHORTS, SEED_VIDEOS, type SeedClip } from "@/lib/seed-content";

interface Props {
  open: boolean;
  onClose: () => void;
}

type LiveRoom = {
  id: string;
  motion: string;
  viewer_count: number;
  status: string;
  host?: { username: string } | null;
};

const CHIP_FILTERS = ["All", "Politics", "Economics", "Science & Tech", "Philosophy", "Culture"];

function fmt(n: number): string {
  return n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, "") + "K" : String(n);
}

const card: React.CSSProperties = {
  background: "rgba(18,18,24,0.92)",
  border: "0.5px solid #2e2e38",
  borderRadius: 12,
};

export default function TrendingPage({ open, onClose }: Props) {
  const [supabase] = useState(() => createClient());
  const [rooms, setRooms] = useState<LiveRoom[]>([]);
  const [activeChip, setActiveChip] = useState("All");
  const [activeShort, setActiveShort] = useState<SeedClip | null>(null);
  const [hearted, setHearted] = useState<Record<string, boolean>>({});
  const [localComments, setLocalComments] = useState<Record<string, { user: string; body: string }[]>>({});
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (!open) return;
    (async () => {
      const { data } = await supabase
        .from("debate_rooms")
        .select("id, motion, viewer_count, status, host:users!debate_rooms_host_id_fkey(username)")
        .in("status", ["live", "created"])
        .order("viewer_count", { ascending: false })
        .limit(6);
      if (data) setRooms(data as unknown as LiveRoom[]);
    })();
  }, [open, supabase]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") (activeShort ? setActiveShort(null) : onClose());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, activeShort, onClose]);

  const toggleHeart = useCallback((id: string) => {
    setHearted((h) => ({ ...h, [id]: !h[id] }));
  }, []);

  const shorts = useMemo(() => SEED_SHORTS, []);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[150] overflow-y-auto"
      style={{
        background: "#040405",
        backgroundImage:
          "radial-gradient(1px 1px at 7% 12%, rgba(255,255,255,0.5) 50%, transparent 50%), radial-gradient(1px 1px at 42% 6%, rgba(255,215,130,0.5) 50%, transparent 50%), radial-gradient(1px 1px at 78% 15%, rgba(160,190,255,0.5) 50%, transparent 50%), radial-gradient(1px 1px at 22% 68%, rgba(255,255,255,0.35) 50%, transparent 50%), radial-gradient(1px 1px at 88% 74%, rgba(255,215,130,0.4) 50%, transparent 50%), radial-gradient(1px 1px at 55% 90%, rgba(160,190,255,0.4) 50%, transparent 50%)",
        fontFamily: "'DM Sans', sans-serif",
      }}
    >
      <div className="max-w-[1200px] mx-auto px-6 py-5">
        {/* Header */}
        <div className="flex items-center gap-4 mb-5">
          <button
            onClick={() => (activeShort ? setActiveShort(null) : onClose())}
            className="text-[13px] cursor-pointer bg-transparent border-none"
            style={{ color: "#9a9aa2" }}
          >
            ← {activeShort ? "Back to Trending" : "Home"}
          </button>
          {!activeShort && (
            <>
              <span style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 24, color: "#f5f5f0" }}>
                Trending
              </span>
              <div className="flex gap-2 flex-1 flex-wrap">
                {CHIP_FILTERS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setActiveChip(c)}
                    className="cursor-pointer text-[12px] px-3.5 py-1 rounded-lg"
                    style={
                      activeChip === c
                        ? { background: "rgba(255,255,255,0.12)", border: "0.5px solid #4a4a54", color: "#f5f5f0" }
                        : { background: "rgba(20,20,26,0.85)", border: "0.5px solid #34343c", color: "#c0c0c8" }
                    }
                  >
                    {c}
                  </button>
                ))}
              </div>
            </>
          )}
          <img src="/logo.png" alt="AgoraSphere" className="h-[20px] w-auto ml-auto" />
        </div>

        {activeShort ? (
          /* ── Shorts player view ── */
          <div className="flex gap-5 justify-center items-stretch py-4">
            <div
              className="relative flex flex-col justify-between p-4 shrink-0"
              style={{ width: 330, height: 586, borderRadius: 18, border: "0.5px solid #3a3a44", background: activeShort.gradient }}
            >
              <div className="flex justify-end">
                <span style={{ background: "rgba(0,0,0,0.55)", color: "#e5e5ec", fontSize: 11, padding: "3px 10px", borderRadius: 99 }}>
                  {activeShort.duration}
                </span>
              </div>
              <div className="text-center">
                <span
                  className="inline-flex items-center justify-center"
                  style={{ width: 56, height: 56, borderRadius: "50%", background: "rgba(255,255,255,0.12)", border: "0.5px solid rgba(255,255,255,0.3)", color: "#fff", fontSize: 20 }}
                >
                  ▶
                </span>
                <p className="mt-3 text-[11px]" style={{ color: "rgba(255,255,255,0.5)" }}>
                  recording playback coming with the clips pipeline
                </p>
              </div>
              <div>
                <div className="flex items-center gap-2.5 mb-2">
                  <span
                    className="flex items-center justify-center"
                    style={{ width: 34, height: 34, borderRadius: "50%", background: activeShort.uploader.color, color: "#0a0a10", fontSize: 13, fontWeight: 500, border: "1.5px solid rgba(255,255,255,0.5)" }}
                  >
                    {activeShort.uploader.initial}
                  </span>
                  <span className="text-[13px] font-medium" style={{ color: "#f5f5f0" }}>
                    @{activeShort.uploader.name}
                  </span>
                  <button
                    className="cursor-pointer text-[11px] px-3 py-0.5 rounded-full"
                    style={{ background: "rgba(255,255,255,0.14)", border: "0.5px solid rgba(255,255,255,0.25)", color: "#f5f5f0" }}
                  >
                    Follow
                  </button>
                </div>
                <p className="text-[13px] mb-1" style={{ color: "#f5f5f0", lineHeight: 1.4 }}>
                  {activeShort.title} — from "{activeShort.motion}"
                </p>
                <p className="text-[11px] mb-2.5" style={{ color: "#c0c0c8" }}>
                  vs {activeShort.opponent} · <span style={{ color: "#9cc4f0" }}>watch full debate ⤢</span>
                </p>
                <div style={{ height: 3, background: "rgba(255,255,255,0.12)", borderRadius: 2 }}>
                  <div style={{ width: "35%", height: "100%", background: "#fff", borderRadius: 2 }} />
                </div>
              </div>
            </div>

            {/* Action rail */}
            <div className="flex flex-col justify-end gap-4 pb-2">
              {[
                {
                  icon: "♥",
                  color: hearted[activeShort.id] ? "#f0605e" : "#d5d5dc",
                  bg: hearted[activeShort.id] ? "rgba(240,96,94,0.15)" : "rgba(255,255,255,0.06)",
                  label: fmt(activeShort.hearts + (hearted[activeShort.id] ? 1 : 0)),
                  onClick: () => toggleHeart(activeShort.id),
                },
                { icon: "💬", color: "#d5d5dc", bg: "rgba(255,255,255,0.06)", label: String(activeShort.comments.length + (localComments[activeShort.id]?.length ?? 0)) },
                { icon: "↗", color: "#d5d5dc", bg: "rgba(255,255,255,0.06)", label: "Share" },
                { icon: "⤢", color: "#9cc4f0", bg: "rgba(24,48,82,0.9)", label: "Debate" },
              ].map((b, i) => (
                <div key={i} className="text-center">
                  <button
                    onClick={b.onClick}
                    className="inline-flex items-center justify-center cursor-pointer"
                    style={{ width: 46, height: 46, borderRadius: "50%", background: b.bg, border: "0.5px solid #3a3a42", color: b.color, fontSize: 18 }}
                  >
                    {b.icon}
                  </button>
                  <p className="text-[10px] mt-1" style={{ color: "#c0c0c8" }}>{b.label}</p>
                </div>
              ))}
            </div>

            {/* Comments panel */}
            <div className="flex flex-col p-4" style={{ ...card, width: 320, borderRadius: 14 }}>
              <p className="mb-3 text-[14px]" style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, color: "#f5f5f0" }}>
                Comments{" "}
                <span className="text-[11px] font-normal" style={{ color: "#8b8b94", fontFamily: "'DM Sans', sans-serif" }}>
                  {activeShort.comments.length + (localComments[activeShort.id]?.length ?? 0)}
                </span>
              </p>
              <div className="flex-1 flex flex-col gap-3 overflow-y-auto">
                {activeShort.comments.map((c, i) => (
                  <div key={i} className="flex gap-2.5">
                    <span
                      className="flex items-center justify-center shrink-0"
                      style={{ width: 28, height: 28, borderRadius: "50%", background: c.color, color: "#0a0a10", fontSize: 10, fontWeight: 500 }}
                    >
                      {c.user.charAt(0).toUpperCase()}
                    </span>
                    <div>
                      <p className="text-[11px] m-0" style={{ color: "#c0c0c8" }}>
                        <span style={{ color: "#f5f5f0", fontWeight: 500 }}>@{c.user}</span> · {c.when}
                      </p>
                      <p className="text-[12px] my-0.5" style={{ color: "#e5e5ec", lineHeight: 1.4 }}>{c.body}</p>
                      <p className="text-[10px] m-0" style={{ color: "#8b8b94" }}>♥ {fmt(c.likes)} · Reply</p>
                    </div>
                  </div>
                ))}
                {(localComments[activeShort.id] ?? []).map((c, i) => (
                  <div key={`local-${i}`} className="flex gap-2.5">
                    <span
                      className="flex items-center justify-center shrink-0"
                      style={{ width: 28, height: 28, borderRadius: "50%", background: "#3b82f6", color: "#eff6ff", fontSize: 10, fontWeight: 500 }}
                    >
                      {c.user.charAt(0).toUpperCase()}
                    </span>
                    <div>
                      <p className="text-[11px] m-0" style={{ color: "#c0c0c8" }}>
                        <span style={{ color: "#f5f5f0", fontWeight: 500 }}>@{c.user}</span> · now
                      </p>
                      <p className="text-[12px] my-0.5" style={{ color: "#e5e5ec", lineHeight: 1.4 }}>{c.body}</p>
                      <p className="text-[10px] m-0" style={{ color: "#8b8b94" }}>♥ 0 · Reply</p>
                    </div>
                  </div>
                ))}
              </div>
              <form
                className="flex gap-2 mt-3 items-center"
                onSubmit={(e) => {
                  e.preventDefault();
                  const body = draft.trim();
                  if (!body) return;
                  setLocalComments((m) => ({
                    ...m,
                    [activeShort.id]: [...(m[activeShort.id] ?? []), { user: "you", body }],
                  }));
                  setDraft("");
                }}
              >
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Add a comment…"
                  className="flex-1 text-[12px] px-3.5 py-2 rounded-full outline-none"
                  style={{ background: "rgba(20,20,26,0.85)", border: "0.5px solid #34343c", color: "#e5e5ec" }}
                />
              </form>
            </div>
          </div>
        ) : (
          <>
            {/* ── Shorts shelf ── */}
            <div className="p-4 mb-5" style={{ ...card, background: "rgba(18,18,24,0.6)" }}>
              <div className="flex items-center gap-2.5 mb-3">
                <span
                  className="inline-flex items-center justify-center"
                  style={{ width: 24, height: 24, borderRadius: 7, background: "linear-gradient(135deg,#f7e3a0,#d9a238)", color: "#412402", fontSize: 12 }}
                >
                  ▶
                </span>
                <span style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 16, color: "#f5f5f0" }}>Shorts</span>
                <span className="text-[11px]" style={{ color: "#8b8b94" }}>the best 60 seconds of every debate</span>
              </div>
              <div className="flex gap-3 overflow-x-auto pb-1">
                {shorts.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setActiveShort(s)}
                    className="flex flex-col justify-between p-2.5 shrink-0 cursor-pointer text-left"
                    style={{ width: 132, height: 224, borderRadius: 12, border: "0.5px solid #3a3a44", background: s.gradient }}
                  >
                    <span
                      className="self-end text-[9px] px-2 py-0.5 rounded-full"
                      style={{ background: "rgba(0,0,0,0.55)", color: "#e5e5ec" }}
                    >
                      {s.duration}
                    </span>
                    <span>
                      <span className="block text-[11px] mb-1" style={{ color: "#f5f5f0", lineHeight: 1.3 }}>{s.title}</span>
                      <span className="block text-[10px]" style={{ color: "#c0c0c8" }}>
                        ♥ {fmt(s.hearts + (hearted[s.id] ? 1 : 0))}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* ── Video grid ── */}
            <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
              {rooms.map((r) => (
                <a key={r.id} href={`/rooms/${r.id}`} className="no-underline">
                  <div
                    className="relative mb-2"
                    style={{ aspectRatio: "16/9", borderRadius: 12, background: "linear-gradient(135deg,#0d1b4b,#2d1b69)", border: "0.5px solid #3a3a44" }}
                  >
                    <span
                      className="absolute top-2 left-2 text-[10px] font-medium px-2.5 py-0.5 rounded-full"
                      style={{ background: "#e24b4a", color: "#fcebeb" }}
                    >
                      ● LIVE
                    </span>
                    <span
                      className="absolute bottom-2 right-2 text-[10px] px-2.5 py-0.5 rounded-full"
                      style={{ background: "rgba(0,0,0,0.55)", color: "#e5e5ec" }}
                    >
                      👁 {fmt(r.viewer_count ?? 0)}
                    </span>
                  </div>
                  <div className="flex gap-2.5">
                    <span
                      className="flex items-center justify-center shrink-0"
                      style={{ width: 32, height: 32, borderRadius: "50%", background: "#00b894", color: "#04342c", fontSize: 12, fontWeight: 500 }}
                    >
                      {(r.host?.username ?? "?").charAt(0).toUpperCase()}
                    </span>
                    <div>
                      <p className="text-[13px] m-0" style={{ color: "#f5f5f0", lineHeight: 1.35 }}>{r.motion}</p>
                      <p className="text-[11px] mt-0.5 m-0" style={{ color: "#8b8b94" }}>
                        {r.host?.username ?? "Unknown"} · watching now
                      </p>
                    </div>
                  </div>
                </a>
              ))}
              {SEED_VIDEOS.map((v) => (
                <div key={v.id} className="cursor-pointer">
                  <div
                    className="relative mb-2"
                    style={{ aspectRatio: "16/9", borderRadius: 12, background: v.gradient, border: "0.5px solid #3a3a44" }}
                  >
                    <span
                      className="absolute bottom-2 right-2 text-[10px] px-2.5 py-0.5 rounded-full"
                      style={{ background: "rgba(0,0,0,0.55)", color: "#e5e5ec" }}
                    >
                      {v.duration}
                    </span>
                  </div>
                  <div className="flex gap-2.5">
                    <span
                      className="flex items-center justify-center shrink-0"
                      style={{ width: 32, height: 32, borderRadius: "50%", background: v.uploader.color, color: "#0a0a10", fontSize: 12, fontWeight: 500 }}
                    >
                      {v.uploader.initial}
                    </span>
                    <div>
                      <p className="text-[13px] m-0" style={{ color: "#f5f5f0", lineHeight: 1.35 }}>{v.title}</p>
                      <p className="text-[11px] mt-0.5 m-0" style={{ color: "#8b8b94" }}>
                        {v.uploader.name} · {v.meta}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
