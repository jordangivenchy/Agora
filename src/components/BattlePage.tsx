"use client";

/* Battle — Omegle-style 1v1 debate matchmaking. Pick a topic (and
   optionally a motion), toggle AI rating, and hit Find an opponent:
   the matcher joins an open 1v1 room on your topic, or opens a battle
   room and you go live when a challenger arrives. Agora, the in-debate
   AI assistant, is introduced here with a preview chat. */

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { TOPICS } from "@/types/database";
import type { Stance } from "@/types/database";

interface Props {
  open: boolean;
  onClose: () => void;
}

const AUTO_MOTIONS: Record<string, string[]> = {
  "politics-law": [
    "Supreme Court justices should have 18-year term limits",
    "Hate speech should lose First Amendment protection",
  ],
  ethics: [
    "Lying is justified to protect someone's feelings",
    "Wealthy nations owe open borders to climate refugees",
  ],
  sports: [
    "College athletes should be salaried employees",
    "Performance enhancers should be legal in pro sports",
  ],
  culture: [
    "Cancel culture does more good than harm",
    "Remakes and sequels are killing original storytelling",
  ],
  economics: [
    "A four-day work week should be the legal standard",
    "Billionaires should not exist",
  ],
  "science-tech": [
    "AI development should be paused at human-level capability",
    "Social media does more harm than good",
  ],
  "foreign-policy": [
    "Economic sanctions hurt people more than regimes",
    "The UN Security Council veto should be abolished",
  ],
  philosophy: [
    "Free will is an illusion",
    "It is morally wrong to eat animals",
  ],
};

type Phase = "idle" | "searching" | "creating";

const card: React.CSSProperties = {
  background: "rgba(18,18,24,0.92)",
  border: "0.5px solid #2e2e38",
  borderRadius: 12,
};

export default function BattlePage({ open, onClose }: Props) {
  const [supabase] = useState(() => createClient());
  const [topicKey, setTopicKey] = useState<string | null>(null);
  const [motion, setMotion] = useState("");
  const [stance, setStance] = useState<"PRO" | "CON" | "either">("either");
  const [aiRating, setAiRating] = useState(true);
  const [phase, setPhase] = useState<Phase>("idle");
  const [statusMsg, setStatusMsg] = useState("");
  const [error, setError] = useState("");
  const [agoraLog, setAgoraLog] = useState<{ from: "you" | "agora"; text: string }[]>([]);
  const [agoraDraft, setAgoraDraft] = useState("");
  const cancelled = useRef(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) { setPhase("idle"); setError(""); setStatusMsg(""); cancelled.current = true; }
    else cancelled.current = false;
  }, [open]);

  const findOpponent = useCallback(async () => {
    setError("");
    cancelled.current = false;
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) { window.location.href = "/login"; return; }

    setPhase("searching");
    setStatusMsg("Scanning the agora for a challenger…");

    let query = supabase
      .from("debate_rooms")
      .select("id, motion, topic_key, host_id")
      .eq("status", "created")
      .eq("is_private", false)
      .eq("pro_size", 1)
      .eq("con_size", 1)
      .neq("host_id", auth.user.id)
      .order("created_at", { ascending: false })
      .limit(1);
    if (topicKey) query = query.eq("topic_key", topicKey);
    const { data: matches } = await query;
    if (cancelled.current) return;

    if (matches && matches.length > 0) {
      setStatusMsg(`Opponent found — "${matches[0].motion}". Entering the arena…`);
      setTimeout(() => { window.location.href = `/rooms/${matches[0].id}`; }, 1200);
      return;
    }

    // Nobody waiting: open a battle room and hold the floor.
    setPhase("creating");
    setStatusMsg("No open battles on this topic — opening one for you…");
    const chosenTopic = topicKey ?? TOPICS[Math.floor(Math.random() * TOPICS.length)].key;
    const pool = AUTO_MOTIONS[chosenTopic] ?? AUTO_MOTIONS["culture"];
    const chosenMotion = motion.trim() || pool[Math.floor(Math.random() * pool.length)];
    const chosenStance: Stance = stance === "either" ? (Math.random() < 0.5 ? "PRO" : "CON") : stance;

    const { data: rows, error: rpcError } = await supabase.rpc("create_room", {
      p_motion: chosenMotion,
      p_topic_key: chosenTopic,
      p_language: "en",
      p_stance: chosenStance,
      p_is_private: false,
      p_allow_spectators: true,
      p_pro_size: 1,
      p_con_size: 1,
      p_time_limit_seconds: null,
      p_scheduled_start: null,
    });
    if (cancelled.current) return;
    if (rpcError) {
      setError(rpcError.message || "Couldn't open a battle room. Try again.");
      setPhase("idle");
      return;
    }
    const row = Array.isArray(rows) ? rows[0] : rows;
    const roomId: string | undefined = row?.room_id;
    if (!roomId) { setError("Couldn't open a battle room. Try again."); setPhase("idle"); return; }

    // Best-effort battle metadata (skipped until the migration runs).
    await supabase.from("room_meta").insert({
      room_id: roomId,
      format_variant: "battle",
      curriculum: aiRating ? "agora-general" : null,
    });

    setStatusMsg("Battle room is live — you'll match the moment a challenger joins.");
    setTimeout(() => { window.location.href = `/rooms/${roomId}`; }, 1400);
  }, [supabase, topicKey, motion, stance, aiRating]);

  const askAgora = useCallback((q: string) => {
    const question = q.trim();
    if (!question) return;
    setAgoraLog((log) => [
      ...log,
      { from: "you", text: question },
      {
        from: "agora",
        text:
          "I'm Agora — during a battle I listen for \"Hey, Agora\" and answer both debaters out loud and in chat, with sources. My live knowledge pipeline connects at launch; this lobby is a preview of how I'll respond.",
      },
    ]);
    setAgoraDraft("");
  }, []);

  if (!open) return null;

  const searching = phase !== "idle";

  return (
    <div
      className="fixed overflow-y-auto"
      style={{
        top: "var(--nav-height)",
        left: "calc(var(--sidebar-width) + 12px)",
        right: 0,
        bottom: 0,
        zIndex: 50,
        fontFamily: "'DM Sans', sans-serif",
      }}
    >
      <div className="max-w-[860px] mx-auto px-6 py-5">
        <div className="flex items-center gap-3.5 mb-4">
          <span style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 24, color: "#f5f5f0" }}>Battle</span>
          <span className="text-[12px]" style={{ color: "#8b8b94" }}>
            1v1 debate roulette — pick a topic, get matched, argue live
          </span>
          <span className="text-[11px] ml-auto whitespace-nowrap" style={{ color: "#6b6b74" }}>
            <span style={{ color: "#f09595" }}>●</span> matchmaking live
          </span>
        </div>

        {/* Arena card */}
        <div style={{ background: "linear-gradient(135deg,#c9a44a,#5b4a86 50%,#2c5382)", padding: 1, borderRadius: 15, marginBottom: 14 }}>
          <div style={{ background: "linear-gradient(160deg,#14101c 0%,#0e0e14 70%)", borderRadius: 14, padding: 18 }}>
            {searching ? (
              <div className="text-center py-4">
                <div className="relative mx-auto mb-4" style={{ width: 96, height: 96 }}>
                  <span className="absolute inset-0 rounded-full" style={{ border: "1px solid rgba(217,162,56,0.5)", animation: "battlePing 1.6s ease-out infinite" }} />
                  <span className="absolute inset-0 rounded-full" style={{ border: "1px solid rgba(96,165,250,0.4)", animation: "battlePing 1.6s ease-out 0.5s infinite" }} />
                  <span className="absolute inset-0 flex items-center justify-center text-[34px]">⚔</span>
                </div>
                <p className="m-0 mb-2 text-[15px]" style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, color: "#f5f5f0" }}>
                  {statusMsg}
                </p>
                <button
                  onClick={() => { cancelled.current = true; setPhase("idle"); }}
                  className="cursor-pointer text-[12px] px-4 py-1.5 rounded-lg mt-1"
                  style={{ border: "0.5px solid #3a3a42", color: "#c0c0c8", background: "transparent" }}
                >
                  Cancel
                </button>
                <style>{`@keyframes battlePing { 0% { transform: scale(0.6); opacity: 1; } 100% { transform: scale(1.5); opacity: 0; } }`}</style>
              </div>
            ) : (
              <>
                <p className="m-0 mb-2 text-[10px]" style={{ letterSpacing: 1.5, color: "#8b8b94" }}>CHOOSE YOUR ARENA</p>
                <div className="flex gap-2 flex-wrap mb-4">
                  <button
                    onClick={() => setTopicKey(null)}
                    className="cursor-pointer text-[11px] px-3.5 py-1.5 rounded-full"
                    style={
                      topicKey === null
                        ? { background: "linear-gradient(135deg,#f7e3a0,#d9a238)", border: "0.5px solid #d9a238", color: "#412402", fontWeight: 500 }
                        : { background: "rgba(20,20,26,0.85)", border: "0.5px solid #34343c", color: "#c0c0c8" }
                    }
                  >
                    🎲 Any topic
                  </button>
                  {TOPICS.map((t) => (
                    <button
                      key={t.key}
                      onClick={() => setTopicKey(t.key)}
                      className="cursor-pointer text-[11px] px-3.5 py-1.5 rounded-full"
                      style={
                        topicKey === t.key
                          ? { background: "rgba(74,158,255,0.15)", border: `0.5px solid ${t.color}`, color: "#f5f5f0" }
                          : { background: "rgba(20,20,26,0.85)", border: "0.5px solid #34343c", color: "#c0c0c8" }
                      }
                    >
                      {t.emoji}{t.label}
                    </button>
                  ))}
                </div>

                <input
                  value={motion}
                  onChange={(e) => setMotion(e.target.value)}
                  placeholder="Motion (optional) — leave blank and we'll pick a good one"
                  className="w-full text-[13px] px-4 py-2 rounded-lg outline-none mb-4"
                  style={{ background: "rgba(20,20,26,0.85)", border: "0.5px solid #34343c", color: "#e5e5ec" }}
                />

                <div className="flex gap-4 flex-wrap items-center mb-4">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px]" style={{ color: "#8b8b94" }}>Your side</span>
                    {(["PRO", "CON", "either"] as const).map((s) => (
                      <button
                        key={s}
                        onClick={() => setStance(s)}
                        className="cursor-pointer text-[11px] px-3 py-1 rounded-full"
                        style={
                          stance === s
                            ? {
                                background: s === "PRO" ? "rgba(29,158,117,0.2)" : s === "CON" ? "rgba(216,90,48,0.2)" : "rgba(255,255,255,0.1)",
                                border: `0.5px solid ${s === "PRO" ? "#1d9e75" : s === "CON" ? "#d85a30" : "#4a4a54"}`,
                                color: s === "PRO" ? "#7fe3bd" : s === "CON" ? "#f7b699" : "#f5f5f0",
                              }
                            : { background: "rgba(20,20,26,0.85)", border: "0.5px solid #34343c", color: "#c0c0c8" }
                        }
                      >
                        {s === "either" ? "🎲 Either" : s}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => setAiRating((v) => !v)}
                    className="cursor-pointer flex items-center gap-2 text-[11px] px-3 py-1 rounded-full"
                    style={
                      aiRating
                        ? { background: "rgba(29,158,117,0.15)", border: "0.5px solid #1d9e75", color: "#7fe3bd" }
                        : { background: "rgba(20,20,26,0.85)", border: "0.5px solid #34343c", color: "#8b8b94" }
                    }
                  >
                    <span style={{ width: 22, height: 12, borderRadius: 99, position: "relative", background: aiRating ? "#1d9e75" : "#3a3a42", display: "inline-block" }}>
                      <span style={{ position: "absolute", top: 2, left: aiRating ? 12 : 2, width: 8, height: 8, borderRadius: "50%", background: "#fff", transition: "left 0.15s" }} />
                    </span>
                    AI rating {aiRating ? "on — this battle counts toward your AR" : "off — casual, unrated"}
                  </button>
                </div>

                {error && (
                  <p className="m-0 mb-3 text-[12px] px-4 py-2 rounded-lg" style={{ background: "rgba(239,68,68,0.08)", border: "0.5px solid rgba(239,68,68,0.3)", color: "#fca5a5" }}>
                    {error}
                  </p>
                )}

                <button
                  onClick={findOpponent}
                  className="cursor-pointer w-full text-[14px] font-medium py-3 rounded-lg border-none"
                  style={{ background: "linear-gradient(135deg,#f7e3a0,#e0b04a 55%,#c07f22)", color: "#412402", boxShadow: "0 0 22px rgba(232,163,61,0.3)", fontFamily: "'Syne', sans-serif", fontWeight: 700 }}
                >
                  ⚔ Find an opponent
                </button>
                <p className="m-0 mt-2 text-center text-[10px]" style={{ color: "#6b6b74" }}>
                  Joins an open battle on your topic — or opens one and matches you when a challenger arrives
                </p>
              </>
            )}
          </div>
        </div>

        {/* Agora assistant */}
        <div className="p-4" style={card}>
          <div className="flex items-center gap-2.5 mb-2">
            <span
              className="flex items-center justify-center"
              style={{ width: 34, height: 34, borderRadius: "50%", background: "linear-gradient(135deg,#60a5fa,#2563eb)", color: "#eff6ff", fontSize: 14, fontFamily: "'Syne', sans-serif", fontWeight: 700 }}
            >
              A
            </span>
            <div>
              <p className="m-0 text-[13px]" style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, color: "#f5f5f0" }}>
                Agora — your in-battle AI
              </p>
              <p className="m-0 text-[10px]" style={{ color: "#8b8b94" }}>
                Say <span style={{ color: "#9cc4f0" }}>"Hey, Agora"</span> out loud or type in chat — both sides get spoken and written answers, with sources
              </p>
            </div>
            <span className="ml-auto text-[10px] px-2.5 py-0.5 rounded-full" style={{ background: "rgba(24,48,82,0.9)", border: "0.5px solid #2c5382", color: "#9cc4f0" }}>
              🎙 voice + 💬 text
            </span>
          </div>
          <div className="flex flex-col gap-2 mb-2">
            {agoraLog.map((m, i) => (
              <div key={i} className="flex gap-2" style={{ justifyContent: m.from === "you" ? "flex-end" : "flex-start" }}>
                <p
                  className="m-0 text-[12px] px-3.5 py-2 rounded-xl"
                  style={
                    m.from === "you"
                      ? { background: "rgba(24,48,82,0.9)", border: "0.5px solid #2c5382", color: "#dbeafe", maxWidth: "75%" }
                      : { background: "rgba(20,20,26,0.9)", border: "0.5px solid #34343c", color: "#e5e5ec", maxWidth: "75%", lineHeight: 1.5 }
                  }
                >
                  {m.text}
                </p>
              </div>
            ))}
          </div>
          <form
            className="flex gap-2 items-center"
            onSubmit={(e) => { e.preventDefault(); askAgora(agoraDraft); }}
          >
            <span
              className="flex items-center justify-center shrink-0 cursor-pointer"
              title="Voice activation works in the battle room"
              style={{ width: 32, height: 32, borderRadius: "50%", background: "rgba(20,20,26,0.85)", border: "0.5px solid #34343c", color: "#8b8b94", fontSize: 13 }}
            >
              🎙
            </span>
            <input
              value={agoraDraft}
              onChange={(e) => setAgoraDraft(e.target.value)}
              placeholder='Try it — ask Agora anything, e.g. "What did the Finland UBI pilot find?"'
              className="flex-1 text-[12px] px-4 py-2 rounded-full outline-none"
              style={{ background: "rgba(20,20,26,0.85)", border: "0.5px solid #34343c", color: "#e5e5ec" }}
            />
          </form>
        </div>
      </div>
    </div>
  );
}
