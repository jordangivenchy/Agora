"use client";

/* Navbar search suggestions inside the MVP discovery overlay (portal into
   #discoverySocial, above the engine-owned room-card grid). The engine
   broadcasts the query via the 'agora:discovery-search' event from
   _dsFilterResults in mvp-home.js, which fires on open, on typing, and
   on filter-pill clicks.

   Rows come from search_suggest (migration 20260853): people,
   communities and live/scheduled debates by prefix. Until that RPC
   exists the component falls back to the older direct queries. The
   last row is always "See all results for ⟨q⟩ →", and Enter in either
   search box (navbar #searchInput or overlay #discoveryInput) opens
   /search?q=… through the shell router (pushState + popstate). ↑/↓
   move the highlight; Enter on a highlighted row opens it. */

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase-browser";
import { pathFor } from "@/lib/routes";
import { userPath, roomPath } from "@/lib/urls";
import { Icon } from "./icons";
import UserAvatar from "./UserAvatar";

type SuggestKind = "person" | "community" | "debate";
type Suggestion = {
  kind: SuggestKind;
  id: string;
  label: string;
  sublabel: string | null;
  avatar_url: string | null;
  href_hint: string | null;
};

const sectionLabel: React.CSSProperties = {
  fontFamily: "'Space Grotesk', sans-serif",
  fontWeight: 700,
  fontSize: 11,
  letterSpacing: "0.06em",
  color: "rgba(255,255,255,0.45)",
  margin: "0 0 8px",
};

const rowStyle = (active: boolean): React.CSSProperties => ({
  background: active ? "rgba(255,255,255,0.08)" : "rgba(11,11,13,0.95)",
  border: active ? "0.5px solid #4a4a54" : "0.5px solid #2e2e38",
  borderRadius: 10,
  padding: "8px 12px",
  cursor: "pointer",
});

const KIND_LABEL: Record<SuggestKind, string> = { person: "Person", community: "Community", debate: "Debate" };

/** Navigate inside the homepage shell (page.tsx re-parses on popstate). */
function shellNavigate(path: string) {
  window.history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function closeOverlay() {
  document.getElementById("closeDiscovery")?.click();
}

export default function DiscoverySearch({ container }: { container: HTMLElement | null }) {
  const [supabase] = useState(() => createClient());
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<Suggestion[]>([]);
  const [active, setActive] = useState(-1);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);
  const legacy = useRef(false);

  useEffect(() => {
    const onSearch = (e: Event) =>
      setQuery(String((e as CustomEvent).detail?.query ?? "").trim());
    document.addEventListener("agora:discovery-search", onSearch);
    return () => document.removeEventListener("agora:discovery-search", onSearch);
  }, []);

  /* Pre-migration fallback: the direct queries this component used to run. */
  const legacyFetch = useCallback(async (q: string): Promise<Suggestion[]> => {
    const cleaned = q.replace(/[%_,()]/g, "");
    if (!cleaned) return [];
    const term = `%${cleaned}%`;
    const [peopleRes, commRes, roomsRes] = await Promise.all([
      supabase.from("users").select("id, username, display_name, avatar_url")
        .or(`username.ilike.${cleaned}%,display_name.ilike.${cleaned}%`).limit(4),
      supabase.from("communities").select("id, name, avatar_url").ilike("name", term).limit(3),
      supabase.from("debate_rooms").select("id, motion, status, thumbnail_url")
        .in("status", ["live", "created", "scheduled"]).ilike("motion", term)
        .order("created_at", { ascending: false }).limit(4),
    ]);
    const out: Suggestion[] = [];
    for (const u of (peopleRes.data ?? []) as { id: string; username: string; display_name: string | null; avatar_url: string | null }[]) {
      out.push({ kind: "person", id: u.id, label: u.display_name?.trim() || `@${u.username}`, sublabel: `@${u.username}`, avatar_url: u.avatar_url, href_hint: userPath(u.username) });
    }
    for (const c of (commRes.data ?? []) as { id: string; name: string; avatar_url: string | null }[]) {
      out.push({ kind: "community", id: c.id, label: c.name, sublabel: null, avatar_url: c.avatar_url, href_hint: pathFor.community(c.id) });
    }
    for (const r of (roomsRes.data ?? []) as { id: string; motion: string; status: string; thumbnail_url: string | null }[]) {
      out.push({ kind: "debate", id: r.id, label: r.motion, sublabel: r.status === "live" ? "Live now" : r.status === "scheduled" ? "Scheduled" : "Open", avatar_url: r.thumbnail_url, href_hint: roomPath(r) });
    }
    return out;
  }, [supabase]);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const mySeq = ++seq.current;
    timer.current = setTimeout(async () => {
      setActive(-1);
      if (query.length < 2) { setRows([]); return; }
      let list: Suggestion[] = [];
      if (!legacy.current) {
        const { data, error } = await supabase.rpc("search_suggest", { p_q: query, p_limit: 10 });
        if (error) {
          legacy.current = /does not exist|not find|schema cache/i.test(error.message ?? "");
          list = legacy.current ? await legacyFetch(query) : [];
        } else {
          list = (data ?? []) as Suggestion[];
        }
      } else {
        list = await legacyFetch(query);
      }
      if (seq.current !== mySeq) return; // a newer query superseded this one
      setRows(list);
    }, query.length < 2 ? 0 : 200);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [query, supabase, legacyFetch]);

  const goSearch = useCallback((q: string) => {
    const t = q.trim();
    if (!t) return;
    closeOverlay();
    shellNavigate(pathFor.search(t));
  }, []);

  const openRow = useCallback((s: Suggestion) => {
    if (s.kind === "person") { window.location.href = s.href_hint || userPath(s.label.replace(/^@/, "")); return; }
    if (s.kind === "community") { closeOverlay(); shellNavigate(pathFor.community(s.id)); return; }
    window.location.href = roomPath({ id: s.id, motion: s.label });
  }, []);

  /* Keyboard: Enter / ↑ / ↓ in either search box. Capture phase so the
     engine's own Escape handler and focus logic aren't disturbed. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const id = el?.id;
      if (id !== "searchInput" && id !== "discoveryInput") return;
      const q = (el as HTMLInputElement).value.trim();
      if (e.key === "Enter") {
        e.preventDefault();
        if (active >= 0 && active < rows.length && q === query) openRow(rows[active]);
        else goSearch(q);
        return;
      }
      if (rows.length === 0 || q.length < 2) return;
      // The "See all results" row sits at index rows.length.
      if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(rows.length, a + 1)); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(-1, a - 1)); }
      else if (active >= 0 && e.key.length === 1) setActive(-1);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [active, rows, query, goSearch, openRow]);

  if (!container) return null;
  if (query.length < 2) return createPortal(null, container);

  const avatar = (s: Suggestion) => {
    if (s.kind === "person") {
      return <UserAvatar size={30} username={s.sublabel?.replace(/^@/, "") ?? "?"} avatarUrl={s.avatar_url} seed={s.id} />;
    }
    if (s.avatar_url) {
      // eslint-disable-next-line @next/next/no-img-element
      return <img src={s.avatar_url} alt="" width={30} height={30} style={{ width: 30, height: 30, borderRadius: 8, objectFit: "cover", flexShrink: 0 }} />;
    }
    return (
      <span
        className="inline-flex items-center justify-center shrink-0"
        style={{ width: 30, height: 30, borderRadius: 8, background: s.kind === "community" ? "#4a9eff" : "rgba(255,255,255,0.08)", color: "#fff", fontSize: 12, fontWeight: 700 }}
      >
        {s.kind === "community" ? s.label.charAt(0).toUpperCase() : <Icon name="monitor-play" size={14} />}
      </span>
    );
  };

  const seeAll = active === rows.length;

  return createPortal(
    <div style={{ margin: "4px 0 18px", display: "flex", flexDirection: "column", gap: 8 }} role="listbox" aria-label="Search suggestions">
      {rows.length > 0 && <p style={sectionLabel}>SUGGESTIONS</p>}
      {rows.map((s, i) => (
        <div
          key={`${s.kind}-${s.id}`}
          role="option"
          aria-selected={active === i}
          tabIndex={0}
          onMouseEnter={() => setActive(i)}
          onClick={() => openRow(s)}
          onKeyDown={(e) => { if (e.key === "Enter") openRow(s); }}
          className="flex items-center gap-2.5"
          style={rowStyle(active === i)}
        >
          {avatar(s)}
          <div style={{ minWidth: 0, flex: 1 }}>
            <p className="m-0 text-[12.5px] truncate" style={{ color: "#f5f5f0", fontWeight: 600 }}>{s.label}</p>
            <p className="m-0 text-[10.5px]" style={{ color: "#8b8b94" }}>
              {s.kind === "debate" && s.sublabel === "Live now"
                ? <span style={{ color: "#e05a5a", fontWeight: 700 }}>LIVE</span>
                : s.sublabel}
              {s.sublabel ? " · " : ""}{KIND_LABEL[s.kind]}
            </p>
          </div>
        </div>
      ))}
      <div
        role="option"
        aria-selected={seeAll}
        tabIndex={0}
        onMouseEnter={() => setActive(rows.length)}
        onClick={() => goSearch(query)}
        onKeyDown={(e) => { if (e.key === "Enter") goSearch(query); }}
        className="flex items-center gap-2.5"
        style={rowStyle(seeAll)}
      >
        <span className="inline-flex items-center justify-center shrink-0" style={{ width: 30, height: 30, borderRadius: 8, background: "rgba(74,158,255,0.18)", color: "#8fc1ff" }}>
          <Icon name="search" size={14} />
        </span>
        <p className="m-0 text-[12.5px]" style={{ color: "#f5f5f0", fontWeight: 600 }}>
          See all results for &ldquo;{query}&rdquo; →
        </p>
      </div>
    </div>,
    container
  );
}
