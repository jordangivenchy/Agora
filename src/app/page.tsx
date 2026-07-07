"use client";

/* Homepage — MVP design (WorkingIndexV5) driven by real AgoraSphere data.
   The visual layer is the original MVP HTML/CSS/JS carried over verbatim;
   mvp-adapter.js swaps its demo data for the rooms fetched here and routes
   clicks to the real app (rooms, login, create modal). */

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import CreateRoomModal from "@/components/CreateRoomModal";
import DashboardModal from "@/components/DashboardModal";
import DebatesPage from "@/components/DebatesPage";
import TrendingPage from "@/components/TrendingPage";
import BattlePage from "@/components/BattlePage";
import CommunitiesPage from "@/components/CommunitiesPage";
import NewsPage from "@/components/NewsPage";
import { MVP_HOME_HTML } from "@/components/mvp-home-html";
import "./mvp-home.css";

const TOPIC_MAP: Record<string, string> = {
  "politics-law": "politics-law",
  ethics: "politics-ethics",
  sports: "sports",
  culture: "culture",
  economics: "economics",
  "science-tech": "science-tech",
  "foreign-policy": "foreign-policy",
  philosophy: "philosophy",
};

const TOPIC_ICONS: Record<string, string> = {
  "politics-law": "⚖️",
  "politics-ethics": "🙏",
  sports: "🏆",
  culture: "🎭",
  economics: "💰",
  "science-tech": "🔬",
  "foreign-policy": "🌍",
  philosophy: "📚",
};

const GRADIENTS = [
  "linear-gradient(135deg, #0d1b3e 0%, #1e0533 100%)",
  "linear-gradient(135deg, #1a1000 0%, #002d3d 100%)",
  "linear-gradient(135deg, #0d2b1a 0%, #2d1a00 100%)",
  "linear-gradient(135deg, #001a2e 0%, #002214 100%)",
  "linear-gradient(135deg, #2d0a1a 0%, #1a1500 100%)",
  "linear-gradient(135deg, #0d0a2e 0%, #2e0d0d 100%)",
  "linear-gradient(135deg, #001e2e 0%, #0d001a 100%)",
  "linear-gradient(135deg, #001a3d 0%, #1a001a 100%)",
];

const PALETTE = ["#00b894", "#e17055", "#e2b96b", "#fd79a8", "#4a9eff", "#00cec9", "#64B5F6", "#1976D2"];

const FORMAT_LABEL: Record<string, string> = {
  open: "Open",
  oxford: "Oxford",
  "1v1": "1v1",
  panel: "Panel",
};

function fmtViewers(n: number): string {
  return n >= 1000 ? (n / 1000).toFixed(1) + "K" : String(n);
}

export default function Home() {
  const [supabase] = useState(() => createClient());
  const [showCreate, setShowCreate] = useState(false);
  const [showDashboard, setShowDashboard] = useState(false);
  const [showDebates, setShowDebates] = useState(false);
  const [activeTab, setActiveTab] = useState<"trending" | "communities" | "news" | "battle" | null>(null);
  const [createPrefill, setCreatePrefill] = useState<{ motion: string; topic: string } | null>(null);
  const [booted, setBooted] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);

  /* Inject the MVP markup imperatively, outside React's diffing, so state
     changes (e.g. opening the create modal) can never rewrite it and wipe
     the mutations made by the MVP scripts and adapter. */
  useEffect(() => {
    if (hostRef.current && !hostRef.current.firstChild) {
      hostRef.current.innerHTML = MVP_HOME_HTML;
    }
  }, []);

  /* Fetch real rooms + auth + platform stats, expose to the MVP scripts.
     Called on boot, on realtime changes, and every 30s as a live tracker. */
  const loadData = useCallback(async () => {
      try {
        const [{ data: auth }, { data: roomsData }, { count: memberCount }] = await Promise.all([
          supabase.auth.getUser(),
          supabase
            .from("debate_rooms")
            .select(`*, participants:debate_participants(*, user:users(username, avatar_url))`)
            .in("status", ["live", "created", "scheduled"])
            .order("created_at", { ascending: false })
            .limit(24),
          supabase.from("users").select("*", { count: "exact", head: true }),
        ]);

        const rooms = roomsData ?? [];
        const votesByRoom: Record<string, { pro: number; con: number }> = {};
        if (rooms.length) {
          const { data: votes } = await supabase
            .from("debate_votes")
            .select("room_id, stance")
            .in("room_id", rooms.map((r) => r.id));
          for (const v of votes ?? []) {
            const rec = (votesByRoom[v.room_id] ??= { pro: 0, con: 0 });
            if (v.stance === "PRO") rec.pro++;
            else rec.con++;
          }
        }

        const debates = rooms.map((room, i) => {
          const debaters = (room.participants ?? []).filter(
            (p: { role: string; left_at: string | null }) => p.role === "debater" && !p.left_at
          );
          const proD = debaters.find((p: { stance: string | null }) => p.stance === "PRO");
          const conD = debaters.find((p: { stance: string | null }) => p.stance === "CON");
          const key = TOPIC_MAP[room.topic_key] ?? "culture";
          const v = votesByRoom[room.id] ?? { pro: 0, con: 0 };
          const total = v.pro + v.con;
          return {
            motion: room.motion,
            debater1: proD?.user?.username ?? "Open seat",
            debater2: conD?.user?.username ?? "",
            color1: PALETTE[i % PALETTE.length],
            color2: PALETTE[(i + 3) % PALETTE.length],
            elo: "—",
            viewers: fmtViewers(room.viewer_count ?? 0),
            viewersNum: room.viewer_count ?? 0,
            progress: total ? Math.round((v.pro / total) * 100) : 50,
            topicKey: key,
            secondaryTopics: (room.secondary_topics ?? []).map((k: string) => TOPIC_MAP[k] ?? k),
            subTags: [],
            gradient: GRADIENTS[i % GRADIENTS.length],
            icon: TOPIC_ICONS[key] ?? "🎙️",
            debater1Stance: "PRO",
            debater2Stance: "CON",
            status: room.status === "live" ? "live" : room.scheduled_start ? "scheduled" : "queue",
            format: FORMAT_LABEL[room.format] ?? "Open",
            language: (room.language ?? "EN").toUpperCase().slice(0, 2),
            votesPro: v.pro,
            votesCon: v.con,
            roomId: room.id,
          };
        });

        const user = auth?.user;
        const liveRooms = rooms.filter((r) => r.status === "live");
        const data = {
          debates,
          user: user ? { name: user.user_metadata?.name ?? user.email ?? "U" } : null,
          stats: {
            activeRooms: rooms.length,
            members: memberCount ?? 0,
            watching: liveRooms.reduce((sum, r) => sum + (r.viewer_count ?? 0), 0),
          },
        };
        const w = window as unknown as Record<string, unknown>;
        w.__AGORA_DATA__ = data;
        // Live update path: if the MVP engine is already running, push the
        // fresh data straight into it.
        if (typeof w.__agoraApplyData === "function") {
          (w.__agoraApplyData as (d: unknown) => void)(data);
        }
        setBooted(true);
      } catch (e) {
        console.error("home data load failed", e);
        // Boot anyway so the MVP demo data renders and the page isn't blank.
        (window as unknown as Record<string, unknown>).__AGORA_DATA__ ??= { debates: [], user: null };
        setBooted(true);
      }
  }, [supabase]);

  /* Boot + live tracking: realtime DB changes and a 30s heartbeat both
     re-run loadData, so viewer counts and member totals stay current. */
  useEffect(() => {
    loadData();
    const channel = supabase
      .channel("mvp-home-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "debate_rooms" }, loadData)
      .on("postgres_changes", { event: "*", schema: "public", table: "debate_participants" }, loadData)
      .on("postgres_changes", { event: "*", schema: "public", table: "users" }, loadData)
      .subscribe();
    const heartbeat = setInterval(loadData, 30000);
    return () => {
      supabase.removeChannel(channel);
      clearInterval(heartbeat);
    };
  }, [loadData, supabase]);

  /* Load the MVP engine once, after the DOM above is in place. */
  useEffect(() => {
    if (!booted) return;
    const w = window as unknown as Record<string, unknown>;
    if (w.__MVP_BOOTED__) {
      // Engine already loaded (client-side remount): re-init against the
      // freshly injected DOM and re-apply the data adapter.
      if (typeof w.init === "function") (w.init as () => void)();
      const adapter = document.createElement("script");
      adapter.src = "/mvp-adapter.js";
      document.body.appendChild(adapter);
      return;
    }
    w.__MVP_BOOTED__ = true;

    const fonts = document.createElement("link");
    fonts.rel = "stylesheet";
    fonts.href =
      "https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&family=DM+Sans:wght@300;400;500&family=DM+Mono:wght@400;500&display=swap";
    document.head.appendChild(fonts);

    const three = document.createElement("script");
    three.src = "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js";
    three.onload = () => {
      const engine = document.createElement("script");
      engine.src = "/mvp-home.js";
      engine.onload = () => {
        const adapter = document.createElement("script");
        adapter.src = "/mvp-adapter.js";
        document.body.appendChild(adapter);
      };
      document.body.appendChild(engine);
    };
    document.body.appendChild(three);
  }, [booted]);

  /* Keep the MVP shell in sync with the active React tab: hide the MVP's
     main content while a tab panel is open, and move the sidebar's active
     highlight onto the open tab. Nav and sidebar stay interactive. */
  useEffect(() => {
    const main = document.querySelector(".main") as HTMLElement | null;
    if (main) main.style.display = activeTab ? "none" : "";
    document.querySelectorAll(".sidebar-link[data-nav-id]").forEach((el) => {
      const id = el.getAttribute("data-nav-id");
      el.classList.toggle("active", activeTab ? id === activeTab : id === "home");
    });
  }, [activeTab, booted]);

  useEffect(() => {
    const onCreate = () => { setCreatePrefill(null); setShowCreate(true); };
    const onDashboard = () => setShowDashboard(true);
    const onTab = (e: Event) => {
      const tab = (e as CustomEvent).detail;
      if (tab === "trending" || tab === "communities" || tab === "news" || tab === "battle") setActiveTab(tab);
      else if (tab === "close") setActiveTab(null);
    };
    const onLogout = async () => {
      await supabase.auth.signOut();
      window.location.reload();
    };
    window.addEventListener("agora:create", onCreate);
    window.addEventListener("agora:dashboard", onDashboard);
    window.addEventListener("agora:tab", onTab);
    window.addEventListener("agora:logout", onLogout);
    return () => {
      window.removeEventListener("agora:create", onCreate);
      window.removeEventListener("agora:dashboard", onDashboard);
      window.removeEventListener("agora:tab", onTab);
      window.removeEventListener("agora:logout", onLogout);
    };
  }, [supabase]);

  return (
    <>
      <div ref={hostRef} />
      <TrendingPage open={activeTab === "trending"} onClose={() => setActiveTab(null)} />
      <BattlePage open={activeTab === "battle"} onClose={() => setActiveTab(null)} />
      <CommunitiesPage open={activeTab === "communities"} onClose={() => setActiveTab(null)} />
      <NewsPage
        open={activeTab === "news"}
        onClose={() => setActiveTab(null)}
        onStartDebate={(motion, topic) => {
          setCreatePrefill({ motion, topic });
          setShowCreate(true);
        }}
      />
      <CreateRoomModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        initialMotion={createPrefill?.motion}
        initialTopic={createPrefill?.topic}
      />
      <DashboardModal
        open={showDashboard}
        onClose={() => setShowDashboard(false)}
        onOpenDebates={() => {
          setShowDashboard(false);
          setShowDebates(true);
        }}
      />
      <DebatesPage open={showDebates} onClose={() => setShowDebates(false)} />
    </>
  );
}
