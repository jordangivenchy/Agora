"use client";

/* News tab — today's headlines turned into debate motions. The gold-framed
   Today's Motion sits on top; each headline carries a suggested motion and
   a one-click Start-debate that prefills the create modal. Real rows from
   `news_topics` take priority over the seeded examples. */

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { SEED_NEWS, SEED_DAILY_MOTION, type SeedNewsItem } from "@/lib/seed-content";

interface Props {
  open: boolean;
  onClose: () => void;
  onStartDebate: (motion: string, topicKey: string) => void;
}

const card: React.CSSProperties = {
  background: "rgba(18,18,24,0.92)",
  border: "0.5px solid #2e2e38",
  borderRadius: 12,
};

function resetCountdown(): string {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  const mins = Math.floor((midnight.getTime() - now.getTime()) / 60000);
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

export default function NewsPage({ open, onClose, onStartDebate }: Props) {
  const [supabase] = useState(() => createClient());
  const [items, setItems] = useState<SeedNewsItem[]>(SEED_NEWS);
  const [daily, setDaily] = useState(SEED_DAILY_MOTION);
  const [dailyId, setDailyId] = useState<string | null>(null);
  const [voted, setVoted] = useState<"pro" | "con" | null>(null);
  const [liveNow, setLiveNow] = useState(0);

  /* Vote is local immediately; persisted via RPC when the daily motion is a
     real news_topics row (i.e. after the migration seeds one). */
  const castVote = (side: "pro" | "con") => {
    if (voted) return;
    setVoted(side);
    if (dailyId) supabase.rpc("vote_news_topic", { p_topic_id: dailyId, p_side: side });
  };

  /* Live debates on the platform right now → jump to the Explore live list. */
  const watchLive = () => {
    onClose();
    (document.querySelector('[data-nav-id="explore"]') as HTMLElement | null)?.click();
  };

  useEffect(() => {
    if (!open) return;
    (async () => {
      const { count } = await supabase
        .from("debate_rooms")
        .select("*", { count: "exact", head: true })
        .eq("status", "live");
      setLiveNow(count ?? 0);
    })();
  }, [open, supabase]);

  useEffect(() => {
    if (!open) return;
    (async () => {
      const { data, error } = await supabase
        .from("news_topics")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(12);
      if (error || !data?.length) return; // migration not run or table empty — keep seeds
      const dailyRow = data.find((d) => d.is_daily_motion);
      if (dailyRow) {
        setDailyId(dailyRow.id);
        setDaily({
          motion: dailyRow.suggested_motion,
          proVotes: dailyRow.pro_votes,
          conVotes: dailyRow.con_votes,
          liveCount: 0,
        });
      }
      const rest = data.filter((d) => !d.is_daily_motion);
      if (rest.length) {
        setItems(
          rest.map((d) => ({
            id: d.id,
            headline: d.headline,
            topicKey: d.topic_key,
            topicLabel: d.topic_key,
            dotColor: "#4a9eff",
            when: new Date(d.created_at).toLocaleDateString(),
            suggestedMotion: d.suggested_motion,
            liveCount: 0,
          }))
        );
      }
    })();
  }, [open, supabase]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const pct = useMemo(() => {
    const pro = daily.proVotes + (voted === "pro" ? 1 : 0);
    const con = daily.conVotes + (voted === "con" ? 1 : 0);
    const total = pro + con || 1;
    return { pro: Math.round((pro / total) * 100), total };
  }, [daily, voted]);

  const today = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric" }).toUpperCase();

  if (!open) return null;

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
      <div className="max-w-[900px] mx-auto px-6 py-5">
        <div className="flex items-center gap-3.5 mb-4">
          <span style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 24, color: "#f5f5f0" }}>News</span>
          <span className="text-[12px]" style={{ color: "#8b8b94" }}>Today's headlines, turned into motions</span>
          <span className="text-[12px] ml-auto whitespace-nowrap" style={{ color: "#8b8b94" }}>
            {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
          </span>
        </div>

        {/* Today's Motion */}
        <div style={{ background: "linear-gradient(135deg,#c9a44a,#5b4a86 50%,#2c5382)", padding: 1, borderRadius: 15, marginBottom: 16 }}>
          <div style={{ background: "linear-gradient(135deg,#1a1200 0%,#12101a 60%,#0d0d12 100%)", borderRadius: 14, padding: 18 }}>
            <div className="flex justify-between items-start mb-2.5">
              <span
                className="text-[10px] font-medium px-2.5 py-0.5 rounded-full"
                style={{ background: "linear-gradient(135deg,#f7e3a0,#d9a238)", color: "#412402", letterSpacing: 1 }}
              >
                ☀ TODAY'S MOTION · {today}
              </span>
              <span className="text-[11px]" style={{ color: "#8b8b94" }}>resets in {resetCountdown()}</span>
            </div>
            <p className="m-0 mb-2.5" style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 21, color: "#f7f3e8" }}>
              "{daily.motion}"
            </p>
            <div className="flex items-center gap-3 mb-3 flex-wrap">
              <div style={{ flex: 1, maxWidth: 300 }}>
                <div className="flex justify-between text-[10px] mb-1">
                  <span style={{ color: "#f4d47c" }}>PRO {pct.pro}%</span>
                  <span style={{ color: "#85b7eb" }}>CON {100 - pct.pro}%</span>
                </div>
                <div className="flex overflow-hidden" style={{ height: 5, borderRadius: 3 }}>
                  <div style={{ width: `${pct.pro}%`, background: "linear-gradient(90deg,#f7e3a0,#d9a238)" }} />
                  <div style={{ width: `${100 - pct.pro}%`, background: "linear-gradient(90deg,#2563eb,#60a5fa)" }} />
                </div>
              </div>
              <span className="text-[11px]" style={{ color: "#9a9aa2" }}>
                {pct.total.toLocaleString()} votes
                {liveNow > 0 && <> · <span style={{ color: "#f09595" }}>● {liveNow} debate{liveNow === 1 ? "" : "s"} live</span></>}
              </span>
            </div>
            <div className="flex gap-2.5 flex-wrap">
              <button
                onClick={() => onStartDebate(daily.motion, "politics-ethics")}
                className="cursor-pointer text-[12px] font-medium px-4 py-1.5 rounded-lg border-none"
                style={{ background: "linear-gradient(135deg,#f7e3a0,#d9a238)", color: "#412402" }}
              >
                ⚔ Debate this now
              </button>
              <button
                onClick={() => castVote("pro")}
                className="cursor-pointer text-[12px] px-4 py-1.5 rounded-lg"
                style={{ border: voted === "pro" ? "0.5px solid #d9a238" : "0.5px solid #3a3a42", color: voted === "pro" ? "#f4d47c" : "#e5e5ec", background: "transparent" }}
              >
                Vote PRO
              </button>
              <button
                onClick={() => castVote("con")}
                className="cursor-pointer text-[12px] px-4 py-1.5 rounded-lg"
                style={{ border: voted === "con" ? "0.5px solid #2c5382" : "0.5px solid #3a3a42", color: voted === "con" ? "#85b7eb" : "#e5e5ec", background: "transparent" }}
              >
                Vote CON
              </button>
              {liveNow > 0 && (
                <button
                  onClick={watchLive}
                  className="cursor-pointer text-[12px] px-4 py-1.5 rounded-lg"
                  style={{ border: "0.5px solid #3a3a42", color: "#e5e5ec", background: "transparent" }}
                >
                  ▶ Watch live
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Headlines */}
        <div className="flex flex-col gap-2.5">
          {items.map((n) => (
            <div key={n.id} className="flex items-center gap-3.5 px-4 py-3" style={card}>
              <span className="shrink-0" style={{ width: 9, height: 9, borderRadius: "50%", background: n.dotColor }} />
              <div className="flex-1 min-w-0">
                <p className="m-0 text-[13px]" style={{ color: "#f5f5f0" }}>{n.headline}</p>
                <p className="m-0 text-[10px]" style={{ color: "#8b8b94" }}>
                  {n.topicLabel} · {n.when} · suggested motion:{" "}
                  <span style={{ color: "#c9b06a" }}>"{n.suggestedMotion}"</span>
                </p>
              </div>
              <span className="text-[11px] whitespace-nowrap" style={{ color: n.liveCount ? "#f09595" : "#8b8b94" }}>
                {n.liveCount ? `● ${n.liveCount} live` : "no live"}
              </span>
              <button
                onClick={() => onStartDebate(n.suggestedMotion, n.topicKey)}
                className="cursor-pointer text-[11px] px-3.5 py-1.5 rounded-lg whitespace-nowrap"
                style={{ border: "0.5px solid #2c5382", background: "rgba(24,48,82,0.9)", color: "#9cc4f0" }}
              >
                Start debate
              </button>
            </div>
          ))}
        </div>

        <p className="text-[11px] mt-4" style={{ color: "#6b6b74" }}>
          Headlines are curated daily. A live news feed integration lands with the content pipeline.
        </p>
      </div>
    </div>
  );
}
