"use client";

/* The Explore page (/explore): the banner with live platform figures,
   the search box, the category / status / language pills and the
   results as the homepage's RoomCard blocks, in the home shell's look
   (mvp-home.css: the #explorePage entrance fade, the .main column its
   route wraps it in). The rooms are fetched here and filtered in React;
   the figures come with the route (app/explore/page.tsx). */

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { TOPICS } from "@/types/database";
import { Icon, type IconName } from "@/components/icons";
import RoomCard, { type RoomCardRoom } from "./RoomCard";

export type ShellStats = { activeRooms: number; members: number; watching: number };

type Room = RoomCardRoom & { language?: string | null };
type StatusKey = "all" | "live" | "created" | "scheduled";

const STATUS_PILLS: { key: StatusKey; label: string; cls?: string }[] = [
  { key: "all", label: "All" },
  { key: "live", label: "● Live", cls: "live-pill" },
  { key: "created", label: "Queue" },
  { key: "scheduled", label: "Scheduled" },
];
const LANGS = ["Any", "EN", "ES", "FR", "ZH", "AR"];

/* Light pill colours take dark ink. */
function darkInkOn(hex: string): boolean {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.62;
}

/* A figure that counts up to its value and pops when it lands (the
   .is-pop class in mvp-home.css); held still under reduced motion. */
function CountUp({ value }: { value: number }) {
  const [shown, setShown] = useState(0);
  const [pop, setPop] = useState(false);
  const fromRef = useRef(0);
  useEffect(() => {
    const to = Math.max(0, Number(value) || 0);
    const from = fromRef.current;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (still || from === to) { fromRef.current = to; setShown(to); return; }
    const t0 = performance.now(), dur = 700;
    let raf = 0;
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      setShown(Math.round(from + (to - from) * e));
      if (k < 1) raf = requestAnimationFrame(tick);
      else { fromRef.current = to; setPop(true); }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return (
    <span className={`explore-stat-val${pop ? " is-pop" : ""}`} onAnimationEnd={() => setPop(false)}>
      {shown}
    </span>
  );
}

export default function ExplorePage({ stats }: { stats: ShellStats | null }) {
  const [supabase] = useState(() => createClient());
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState("all");
  const [status, setStatus] = useState<StatusKey>("all");
  const [lang, setLang] = useState("Any");
  const inputRef = useRef<HTMLInputElement>(null);

  /* The same room shape the homepage blocks use. */
  useEffect(() => {
    let alive = true;
    supabase
      .from("debate_rooms")
      .select("id, motion, topic_key, status, format, language, scheduled_start, viewer_count, thumbnail_url, host:users!host_id(id, username, display_name, avatar_url), community:communities!community_id(id, name, color)")
      .in("status", ["live", "created", "scheduled"])
      .limit(200)
      .then(({ data }) => { if (alive) setRooms((data ?? []) as unknown as Room[]); });
    const t = window.setTimeout(() => inputRef.current?.focus(), 60);
    return () => { alive = false; clearTimeout(t); };
  }, [supabase]);

  const topicLabel = useMemo(() => new Map<string, string>(TOPICS.map((t) => [t.key, t.label])), []);
  const list = useMemo(() => {
    if (!rooms) return null;
    const q = query.trim().toLowerCase();
    return rooms.filter((r) => {
      if (cat !== "all" && r.topic_key !== cat) return false;
      if (status !== "all" && r.status !== status) return false;
      if (lang !== "Any" && (r.language || "EN").toUpperCase() !== lang) return false;
      if (q) {
        const host = r.host as { username?: string; display_name?: string | null } | null;
        const hay = `${r.motion ?? ""} ${topicLabel.get(r.topic_key ?? "") ?? ""} ${host?.username ?? ""} ${host?.display_name ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rooms, query, cat, status, lang, topicLabel]);

  const pill = (key: string, active: boolean, onClick: () => void, label: React.ReactNode, style?: React.CSSProperties, extra = "") => (
    <button key={key} type="button" className={`explore-pill${active ? " active" : ""}${extra ? ` ${extra}` : ""}`} style={style} onClick={onClick}>
      {label}
    </button>
  );

  return (
    <div id="explorePage">
      <div className="explore-banner">
        <div className="explore-banner-text">
          <h1 className="explore-title">Explore discussions</h1>
          <p className="explore-subtitle">Find a live room, join a queue, or sign up for one coming up</p>
        </div>
        <div className="explore-banner-stats">
          <div className="explore-stat">
            {stats ? <CountUp value={stats.activeRooms} /> : <span className="explore-stat-val">—</span>}
            <span className="explore-stat-label">Active rooms</span>
          </div>
          <div className="explore-stat">
            {stats ? <CountUp value={stats.members} /> : <span className="explore-stat-val">—</span>}
            <span className="explore-stat-label">Members</span>
          </div>
          <div className="explore-stat">
            {stats ? <CountUp value={stats.watching} /> : <span className="explore-stat-val">—</span>}
            <span className="explore-stat-label">Watching now</span>
          </div>
        </div>
      </div>

      <div className="explore-search-wrap">
        <span className="explore-search-icon"><Icon name="search" size={15} /></span>
        <input
          ref={inputRef}
          id="exploreSearchInput"
          className="explore-search-input"
          type="text"
          placeholder="Search topics, people, or keywords…"
          autoComplete="off"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="explore-filter-bar">
        <div className="explore-filter-group">
          <span className="explore-filter-group-label">Category</span>
          <div className="explore-filter-pills" id="epCategoryFilter">
            {pill("all", cat === "all", () => setCat("all"), "All")}
            {TOPICS.map((t) => pill(
              t.key,
              cat === t.key,
              () => setCat(t.key),
              <><Icon name={`topic-${t.key}` as IconName} size={14} />{t.label}</>,
              { "--tc": t.color, ...(darkInkOn(t.color) ? { "--ink": "#1a0e00" } : {}) } as React.CSSProperties,
            ))}
          </div>
        </div>

        <div className="explore-filter-divider" />

        <div className="explore-filter-row">
          <div className="explore-filter-group-inline">
            <span className="explore-filter-group-label">Status</span>
            <div className="explore-filter-pills" id="epStatusFilter">
              {STATUS_PILLS.map((p) => pill(p.key, status === p.key, () => setStatus(p.key), p.label, undefined, p.cls ?? ""))}
            </div>
          </div>
          <div className="explore-filter-group-inline">
            <span className="explore-filter-group-label">Language</span>
            <div className="explore-filter-pills" id="epLangFilter">
              {LANGS.map((l) => pill(l, lang === l, () => setLang(l), l))}
            </div>
          </div>
        </div>
      </div>

      <div className="explore-results-wrap">
        <div className="explore-results-meta" id="epResultsMeta">
          {list === null ? "Loading…" : `Showing ${list.length} discussion${list.length !== 1 ? "s" : ""}`}
        </div>
        <div className="explore-results-grid" id="epResultsGrid">
          {list && (list.length === 0 ? (
            <div className="explore-empty">Nothing matches your filters</div>
          ) : (
            <div className="flex flex-wrap gap-3">
              {list.map((r) => <RoomCard key={r.id} room={r} />)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
