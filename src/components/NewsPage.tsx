"use client";

/* News tab — the day's world headlines, each one a discussion waiting to
   happen. The gold-framed Today's Motion (a real news_topics row) sits on
   top; below it the live ranked feed from /api/news: major stories as
   image cards, the rest as a list. Every story has a real "Read article"
   link to the outlet and a one-click "Start a discussion" that prefills
   the create modal with the headline as the motion. Curated news_topics
   rows (suggested motions) render as their own section when present. */

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { Icon } from "@/components/icons";
import useEscapeClose from "@/lib/useEscapeClose";
import { setPresenceQueued } from "@/lib/presence";
import type { SeedNewsItem } from "@/lib/seed-content";

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

type Source = { name: string; domain: string };
type Story = {
  id: string;
  headline: string;
  url: string | null;
  publishedAt: string | null;
  sources: Source[];
  imageUrl?: string | null;
  summary?: string | null;
  category?: string | null;
  major?: boolean;
};

/* NewsData categories → our topic keys (world desk → Foreign Policy). */
export function topicFor(category: string | null | undefined): string {
  switch (category) {
    case "politics": return "politics-law";
    case "business": return "economics";
    case "science":
    case "technology": return "science-tech";
    case "sports": return "sports";
    case "entertainment": return "culture";
    default: return "foreign-policy";
  }
}

/* NewsData timestamps arrive as "YYYY-MM-DD HH:MM:SS" in UTC. */
function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = Date.parse(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z");
  if (!Number.isFinite(t)) return "";
  const m = Math.max(1, Math.round((Date.now() - t) / 60000));
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function Outlets({ sources, max = 3 }: { sources: Source[]; max?: number }) {
  return (
    <span className="inline-flex items-center gap-2 flex-wrap">
      {sources.slice(0, max).map((src) => (
        <span key={src.name} className="inline-flex items-center gap-1">
          {src.domain && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(src.domain)}&sz=32`}
              alt=""
              width={12}
              height={12}
              style={{ borderRadius: 3, opacity: 0.85 }}
            />
          )}
          <span className="text-[10.5px]" style={{ color: "#8b8b94" }}>{src.name}</span>
        </span>
      ))}
      {sources.length > max && <span className="text-[10.5px]" style={{ color: "#6b6b74" }}>+{sources.length - max}</span>}
    </span>
  );
}

/* Solid pill language, matching the queue board's Join buttons: outline
   pill for the outbound link, solid blue for the primary action, solid
   purple for queueing. */
const readBtn: React.CSSProperties = {
  border: "0.5px solid #3f3f48", background: "transparent", color: "#e5e5ec",
  borderRadius: 999, padding: "8px 14px", fontSize: 12, fontWeight: 500,
  cursor: "pointer", fontFamily: "inherit",
  textDecoration: "none", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
  textAlign: "center", display: "block",
};
const queueBtn: React.CSSProperties = {
  border: "none", background: "#6d55c8", color: "#fff",
  borderRadius: 999, padding: "9px 14px", fontSize: 12, fontWeight: 600,
  cursor: "pointer", fontFamily: "inherit",
  whiteSpace: "nowrap", textAlign: "center", display: "block", width: "100%",
};
const discussBtn: React.CSSProperties = {
  border: "none", background: "#2f7fe0", color: "#fff",
  borderRadius: 999, padding: "9px 14px", fontSize: 12, fontWeight: 600,
  cursor: "pointer", fontFamily: "inherit",
  whiteSpace: "nowrap", textAlign: "center", display: "block", width: "100%",
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
  // Empty until real news_topics rows exist — no fabricated headlines.
  const [items, setItems] = useState<SeedNewsItem[]>([]);
  const [daily, setDaily] = useState<{ motion: string; proVotes: number; conVotes: number } | null>(null);
  const [dailyId, setDailyId] = useState<string | null>(null);
  const [voted, setVoted] = useState<"pro" | "con" | null>(null);
  const [liveNow, setLiveNow] = useState(0);
  const [stories, setStories] = useState<Story[] | null>(null); // null = loading

  /* Live ranked feed — never renders sample data. */
  useEffect(() => {
    if (!open) return;
    let alive = true;
    fetch("/api/news")
      .then((r) => r.json())
      .then((j) => { if (alive) setStories(j.sample ? [] : (j.stories ?? [])); })
      .catch(() => { if (alive) setStories([]); });
    return () => { alive = false; };
  }, [open]);
  const majors = useMemo(() => (stories ?? []).filter((s) => s.major), [stories]);
  const rest = useMemo(() => (stories ?? []).filter((s) => !s.major), [stories]);

  /* ── Queue a conversation a headline ──
     queue_for_headline turns the headline into a debate_topics question
     and joins its matchmaking queue; while anything is queued we poll
     check_topic_match exactly like the Browse board and jump into the
     room on a match. */
  const [userId, setUserId] = useState<string | null>(null);
  const [queued, setQueued] = useState<Record<string, { topicId: string }>>({});
  const [queueBusy, setQueueBusy] = useState<string | null>(null);
  const [queueError, setQueueError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, [open, supabase]);

  /* Stanceless: the server pairs you with whoever is waiting on this
     headline; seats are assigned invisibly (p_stance is only a default). */
  const queueUp = async (st: Story) => {
    if (!userId) { window.location.href = "/login"; return; }
    setQueueBusy(st.id);
    setQueueError(null);
    const { data, error } = await supabase.rpc("queue_for_headline", {
      p_question: st.headline,
      p_topic_key: topicFor(st.category),
      p_stance: "PRO",
      p_source_url: st.url,
    });
    setQueueBusy(null);
    if (error) {
      setQueueError(error.message.replace(/^[a-z_]+:\s*/, ""));
      return;
    }
    const res = data as { status: string; room_id?: string; topic_id?: string };
    if (res?.status === "matched" && res.room_id) { window.location.href = `/agora/${res.room_id}`; return; }
    if (res?.topic_id) setQueued((q) => ({ ...q, [st.id]: { topicId: res.topic_id! } }));
  };

  const leaveQueue = async (st: Story) => {
    const entry = queued[st.id];
    if (!entry) return;
    setQueueBusy(st.id);
    await supabase.rpc("leave_topic_queue", { p_topic: entry.topicId });
    setQueueBusy(null);
    setQueued((q) => { const n = { ...q }; delete n[st.id]; return n; });
  };

  const anyQueued = Object.keys(queued).length > 0;

  /* Friends lists show "In queue" while we wait — clear it on unmount. */
  useEffect(() => { setPresenceQueued(anyQueued); }, [anyQueued]);
  useEffect(() => () => setPresenceQueued(false), []);
  useEffect(() => {
    if (!anyQueued || !userId) return;
    const t = setInterval(async () => {
      const { data: roomId } = await supabase.rpc("check_topic_match");
      if (roomId) { clearInterval(t); window.location.href = `/agora/${roomId}`; }
    }, 2500);
    return () => clearInterval(t);
  }, [anyQueued, userId, supabase]);

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

  useEscapeClose(open, onClose);

  const pct = useMemo(() => {
    if (!daily) return { pro: 50, total: 0 };
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
      {/* Inline spacing on purpose: this renders inside the MVP shell,
          whose CSS reset out-cascades Tailwind spacing utilities (and
          arbitrary ones like max-w-[1280px] silently fail there). */}
      <div style={{ maxWidth: 1280, margin: "0 auto", padding: "20px 32px 40px", boxSizing: "border-box" }}>
        <div className="flex items-center gap-3.5 mb-4">
          <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 800, fontSize: 24, color: "#f5f5f0" }}>News</span>
          <span className="text-[12px]" style={{ color: "#8b8b94" }}>Today's headlines, turned into topics</span>
          <span className="text-[12px] ml-auto whitespace-nowrap" style={{ color: "#8b8b94" }}>
            {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
          </span>
        </div>

        {/* Today's Motion — only when a real news_topics daily row exists */}
        {daily && (
        <div style={{ background: "linear-gradient(135deg,#c9a44a,#5b4a86 50%,#2c5382)", padding: 1, borderRadius: 15, marginBottom: 16 }}>
          <div style={{ background: "linear-gradient(135deg,#1a1200 0%,#12101a 60%,#0d0d12 100%)", borderRadius: 14, padding: 18 }}>
            <div className="flex justify-between items-start mb-2.5">
              <span
                className="text-[10px] font-medium px-2.5 py-0.5 rounded-full"
                style={{ background: "linear-gradient(135deg,#f7e3a0,#d9a238)", color: "#412402", letterSpacing: 1 }}
              >
                <Icon name="sun" size={11} /> TODAY'S MOTION · {today}
              </span>
              <span className="text-[11px]" style={{ color: "#8b8b94" }}>resets in {resetCountdown()}</span>
            </div>
            <p className="m-0 mb-2.5" style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 21, color: "#f7f3e8" }}>
              "{daily?.motion}"
            </p>
            <div className="flex items-center gap-3 mb-3 flex-wrap">
              <div style={{ flex: 1, maxWidth: 300 }}>
                <div className="flex justify-between text-[10px] mb-1">
                  <span style={{ color: "#f4d47c" }}>Agree {pct.pro}%</span>
                  <span style={{ color: "#85b7eb" }}>Disagree {100 - pct.pro}%</span>
                </div>
                <div className="flex overflow-hidden" style={{ height: 5, borderRadius: 3 }}>
                  <div style={{ width: `${pct.pro}%`, background: "linear-gradient(90deg,#f7e3a0,#d9a238)" }} />
                  <div style={{ width: `${100 - pct.pro}%`, background: "linear-gradient(90deg,#2563eb,#60a5fa)" }} />
                </div>
              </div>
              <span className="text-[11px]" style={{ color: "#9a9aa2" }}>
                {pct.total.toLocaleString()} votes
                {liveNow > 0 && <> · <span style={{ color: "#f09595" }}>● {liveNow} discussion{liveNow === 1 ? "" : "s"} live</span></>}
              </span>
            </div>
            <div className="flex gap-2.5 flex-wrap">
              <button
                onClick={() => daily && onStartDebate(daily.motion, "politics-ethics")}
                className="cursor-pointer text-[12px] font-medium px-4 py-1.5 rounded-lg border-none"
                style={{ background: "linear-gradient(135deg,#f7e3a0,#d9a238)", color: "#412402" }}
              >
                <Icon name="sparkles" size={12} /> Discuss this now
              </button>
              <button
                onClick={() => castVote("pro")}
                className="cursor-pointer text-[12px] px-4 py-1.5 rounded-lg"
                style={{ border: voted === "pro" ? "0.5px solid #d9a238" : "0.5px solid #3a3a42", color: voted === "pro" ? "#f4d47c" : "#e5e5ec", background: "transparent" }}
              >
                Agree
              </button>
              <button
                onClick={() => castVote("con")}
                className="cursor-pointer text-[12px] px-4 py-1.5 rounded-lg"
                style={{ border: voted === "con" ? "0.5px solid #2c5382" : "0.5px solid #3a3a42", color: voted === "con" ? "#85b7eb" : "#e5e5ec", background: "transparent" }}
              >
                Disagree
              </button>
              {liveNow > 0 && (
                <button
                  onClick={watchLive}
                  className="cursor-pointer text-[12px] px-4 py-1.5 rounded-lg"
                  style={{ border: "0.5px solid #3a3a42", color: "#e5e5ec", background: "transparent" }}
                >
                  <Icon name="play" size={11} style={{ fill: "currentColor" }} /> Watch live
                </button>
              )}
            </div>
          </div>
        </div>
        )}

        {/* ── Major stories: image cards ── */}
        {stories === null ? (
          <p className="text-[12px] px-1" style={{ color: "#6b6b74" }}>Loading headlines…</p>
        ) : stories.length === 0 ? (
          <div className="px-4 py-8 text-center" style={card}>
            <p className="m-0 mb-1 text-[13px]" style={{ color: "#f5f5f0" }}>No headlines right now</p>
            <p className="m-0 text-[11px]" style={{ color: "#8b8b94" }}>
              The news feed is off until a provider is configured.
            </p>
          </div>
        ) : (
          <>
            {majors.length > 0 && (
              <>
                <p className="m-0 mb-2 text-[10px] font-semibold" style={{ color: "#8b8b94", letterSpacing: "0.08em" }}>MAJOR STORIES</p>
                <div className="grid gap-3 mb-5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
                  {majors.map((st) => (
                    <div key={st.id} className="flex flex-col overflow-hidden" style={card}>
                      <div style={{ aspectRatio: "16 / 9", background: "linear-gradient(135deg,#0d1b3e,#1e0533)", position: "relative", overflow: "hidden" }}>
                        {st.imageUrl && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={st.imageUrl}
                            alt=""
                            loading="lazy"
                            onError={(e) => { e.currentTarget.style.display = "none"; }}
                            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", objectPosition: "center 30%" }}
                          />
                        )}
                      </div>
                      <div className="flex flex-col gap-2 px-4 py-3 flex-1">
                        <p className="m-0 text-[14px]" style={{ color: "#f5f5f0", fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, lineHeight: 1.3 }}>
                          {st.headline}
                        </p>
                        {st.summary && (
                          <p className="m-0 text-[11.5px]" style={{ color: "#a9a9b4", lineHeight: 1.45, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                            {st.summary}
                          </p>
                        )}
                        <div className="flex items-center gap-2 flex-wrap mt-auto">
                          <Outlets sources={st.sources} />
                          {st.publishedAt && <span className="text-[10.5px]" style={{ color: "#6b6b74" }}>· {timeAgo(st.publishedAt)}</span>}
                        </div>
                        <div className="flex flex-col items-stretch gap-2 mt-1">
                          {st.url && (
                            <a href={st.url} target="_blank" rel="noopener noreferrer" style={readBtn}>Read at {st.sources[0]?.name ?? "source"} ↗</a>
                          )}
                          <button onClick={() => onStartDebate(st.headline, topicFor(st.category))} style={discussBtn}>
                            Start a discussion
                          </button>
                          {queued[st.id] ? (
                            <div className="flex flex-col gap-1.5">
                              <p className="m-0 text-[11px] text-center" style={{ color: "#c9b8f2" }}>
                                <span className="inline-block animate-pulse">●</span> In queue — waiting for a partner
                              </p>
                              <button onClick={() => leaveQueue(st)} disabled={queueBusy === st.id} style={{ ...readBtn, width: "100%" }}>
                                Leave queue
                              </button>
                            </div>
                          ) : (
                            <div className="flex flex-col gap-1.5">
                              <button onClick={() => queueUp(st)} disabled={queueBusy === st.id} style={queueBtn}>
                                {queueBusy === st.id ? "…" : "Queue a conversation"}
                              </button>
                              {queueError && <p className="m-0 text-[10.5px] text-center" style={{ color: "#fca5a5" }}>{queueError}</p>}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* ── More headlines: compact rows ── */}
            {rest.length > 0 && (
              <>
                <p className="m-0 mb-2 text-[10px] font-semibold" style={{ color: "#8b8b94", letterSpacing: "0.08em" }}>MORE HEADLINES</p>
                <div className="flex flex-col gap-2 mb-5">
                  {rest.map((st) => (
                    <div key={st.id} className="flex items-center gap-3.5 px-4 py-3 flex-wrap" style={card}>
                      {st.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={st.imageUrl}
                          alt=""
                          className="shrink-0"
                          loading="lazy"
                          onError={(e) => { e.currentTarget.style.display = "none"; }}
                          style={{ width: 56, height: 56, borderRadius: 8, objectFit: "cover" }}
                        />
                      ) : (
                        <span className="shrink-0" style={{ width: 9, height: 9, borderRadius: "50%", background: "#4a9eff" }} />
                      )}
                      <div className="flex-1" style={{ minWidth: 220 }}>
                        <p className="m-0 text-[13px]" style={{ color: "#f5f5f0", lineHeight: 1.35 }}>{st.headline}</p>
                        <p className="m-0 mt-0.5 flex items-center gap-2 flex-wrap">
                          <Outlets sources={st.sources} max={2} />
                          {st.publishedAt && <span className="text-[10.5px]" style={{ color: "#6b6b74" }}>· {timeAgo(st.publishedAt)}</span>}
                        </p>
                      </div>
                      <div className="flex flex-col items-stretch gap-2 shrink-0" style={{ width: 190 }}>
                        {st.url && (
                          <a href={st.url} target="_blank" rel="noopener noreferrer" style={readBtn}>Read at {st.sources[0]?.name ?? "source"} ↗</a>
                        )}
                        <button onClick={() => onStartDebate(st.headline, topicFor(st.category))} style={discussBtn}>
                          Start a discussion
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}

        {/* ── Curated topics (news_topics rows with suggested motions) ── */}
        {items.length > 0 && (
          <>
            <p className="m-0 mb-2 text-[10px] font-semibold" style={{ color: "#8b8b94", letterSpacing: "0.08em" }}>DISCUSSION TOPICS</p>
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
                  <button onClick={() => onStartDebate(n.suggestedMotion, n.topicKey)} style={discussBtn}>
                    Start a discussion
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
