"use client";

/* The Agora — amphitheater view of a live discussion. This is where
   "Watch" lands. Host-curated conversation, not an open mic: the audience
   listens, raises hands, and only reaches the stage through a host —
   Audience → Raised Hand → Invited → Speaker → Audience (hosts may skip
   the raised-hand step). Hosts come from the room's configuration; the
   Host Controls panel is invisible to everyone else. */

import { use, useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from "react";
import { logRoomEvent, noteRoomAction, takeRoomAction } from "@/lib/roomDiag";
import { useRouter } from "next/navigation";
import useEscapeClose from "@/lib/useEscapeClose";
import { createClient } from "@/lib/supabase-browser";
import { parseRoomParam, userPath } from "@/lib/urls";
import UserAvatar from "@/components/UserAvatar";
import { displayName } from "@/lib/names";
import type { DebateRoom } from "@/types/database";
import { TOPICS } from "@/types/database";
import LoadingScreen from "@/components/LoadingScreen";
import RouteLoading from "@/components/RouteLoading";
import Amphitheater from "@/components/agora/Amphitheater";
import type { AgoraView } from "@/components/agora/AgoraScene3D";
import { setSimpleStage, useSimpleStage } from "@/lib/stageQuality";
import { setCamerasTall, setSmallFaces, useCallView } from "@/lib/callView";
import GpuNotice from "@/components/agora/GpuNotice";
import AgoraSidebar from "@/components/agora/AgoraSidebar";
import AgoraAssistant from "@/components/AgoraAssistant";
import { AGORA_AI } from "@/lib/features";
import AgoraVideoDock from "@/components/agora/AgoraVideoDock";
import AgoraStage from "@/components/agora/AgoraStage";
import ReactionOverlay from "@/components/agora/ReactionOverlay";
import { useAgoraCall, tileKey } from "@/components/agora/useAgoraCall";
import { useRecorderSpeech } from "@/components/agora/useRecorderSpeech";
import { CallGallery, CallMultiSpeaker, type LayoutTile } from "@/components/agora/CallLayouts";
import HostControls from "@/components/agora/HostControls";
import { HlsBroadcastSurface, turnSoundOn, useBroadcastSound } from "@/components/agora/HlsPlayer";
import DebateReplay from "@/components/agora/DebateReplay";
import SiteChrome from "@/components/SiteChrome";
import { roomPath } from "@/lib/urls";
import InvitePrompt from "@/components/agora/InvitePrompt";
import ReportModal, { type ReportTarget } from "@/components/ReportModal";
import { type StageParticipant, deriveStageRole, isHostRole, onStage, sortRequests } from "@/components/agora/stage";
import type { User } from "@supabase/supabase-js";
import { Icon } from "@/components/icons";
import RoomFrame from "@/components/agora/RoomFrame";
import MiniCall from "@/components/agora/MiniCall";
import { takeCoverScroll, useCallSlot } from "@/components/agora/CallSlot";
import { plainLinkUrl, pointsToRoom, softNavTarget } from "@/lib/softNav";
import "@/app/agora/agora.css";
import { sessionUser } from "@/lib/session";

/* Phone breakpoint shared with agora.css: below it the chat rail is a
   bottom sheet driven by `chatOpen`, and the rail-collapse button closes
   that sheet instead of folding the desktop rail. */
const isPhoneViewport = () =>
  typeof window !== "undefined" && window.matchMedia("(max-width: 639px)").matches;

/* ── The call, minimized: a live window in the corner ────────────────
   Leaving the room for another page, the room itself shrinks into the
   corner and keeps playing there, in the call card's window (above the
   card's title, mic and Leave on a desktop; at the start of the bar on a
   phone): the stage, and whoever is on it, without the room's own bars.
   Opening the card grows it back out.

   One move, one shape: the window the room is seen through closes from
   the whole screen onto the card's window while the part of the room it
   shows narrows onto the stage. The room is only ever scaled evenly
   (never stretched and unstretched, which makes the browser redraw it at
   several times its size), with the window a clip around it. Minimized,
   it stays where the move left it — drawn, live, framed by the card. */
type Box = { x: number; y: number; w: number; h: number };
const clampTo = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/* A cubic-bezier easing as a function of time (0 → 1) to progress
   (0 → 1), solved the way CSS does it. The move uses one long, soft
   ease-out (the curve iOS sheets move on): off at once, most of the way
   early, then a gentle landing with no bounce. The spring it replaces
   was pushed by the click and did most of its move in the first 100 ms,
   which read as a lurch. */
function cubicBezier(x1: number, y1: number, x2: number, y2: number) {
  const bez = (t: number, a: number, b: number) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let lo = 0, hi = 1, t = x;
    for (let i = 0; i < 30; i++) {
      t = (lo + hi) / 2;
      if (bez(t, x1, x2) < x) lo = t; else hi = t;
    }
    return bez(t, y1, y2);
  };
}
const FOLD_EASE = cubicBezier(0.32, 0.72, 0, 1);

/* The page a minimized room gives way to usually comes from the server
   after the room is already in the card. It fades in as it
   arrives instead of appearing all at once (agora.css). Over a kept
   page nothing arrives: history takes you back to it, already there. */
function fadeInArrivingPage() {
  const html = document.documentElement;
  const arrived = () => (document.querySelector(".site-chrome-content")?.childElementCount ?? 0) > 0;
  html.classList.add("agora-page-arriving");
  let done = false;
  const reveal = () => {
    if (done) return;
    done = true;
    obs.disconnect();
    window.clearTimeout(cap);
    // A frame hidden first, so the fade runs even for a page already there.
    requestAnimationFrame(() => requestAnimationFrame(() => html.classList.remove("agora-page-arriving")));
  };
  const obs = new MutationObserver(() => { if (arrived()) reveal(); });
  obs.observe(document.body, { childList: true, subtree: true });
  const cap = window.setTimeout(reveal, 4000); // never left hidden
}

/* Where the minimized room sits: the card's window (the card lays it
   out; the room follows), reaching a pixel under the card's hairline all
   round so no seam shows at its edges. Before the card is up, where it
   will be. */
function pipWindow(vw: number, vh: number): Box {
  const r = document.querySelector<HTMLElement>(".call-mini-screen")?.getBoundingClientRect();
  if (r && r.width && r.height) return { x: r.left - 1, y: r.top - 1, w: r.width + 2, h: r.height + 2 };
  if (isPhoneViewport()) return { x: 8, y: vh - 66 - 72, w: 128, h: 72 };
  return { x: vw - 20 - 360, y: vh - 20 - 274, w: 360, h: 204 };
}

/* The part of the room that window shows, in the room's own pixels:
   the stage — the room between its top bar and its controls, beside the
   chat — framed on the speakers' pictures: all of them, with a little
   room around, where they fit the window's shape (a desktop's, side by
   side); else the first, filling the window (a phone stacks them, and
   the middle of the stack would fall between two). With none up, as
   much of the stage as the window holds. Never closer than the room's
   own size: it is only ever made smaller. */
function pipCrop(room: HTMLElement, win: Box, vw: number, vh: number): Box {
  const aspect = win.w / win.h;
  const box = (el: Element | null) => {
    const r = el?.getBoundingClientRect();
    return r && r.width && r.height ? r : null;
  };
  const at = (sel: string) => box(room.querySelector(sel));
  const main = at(".ag-main");
  const left = Math.max(0, main?.left ?? 0);
  const right = Math.min(vw, main?.right ?? vw);
  const top = Math.max(0, at(".ag-topbar")?.bottom ?? 0);
  const bottom = Math.min(vh, main?.bottom ?? vh, at(".ag-controls")?.top ?? vh);
  /* The widest the window can take in. */
  const most = Math.min(Math.max(1, right - left), Math.max(1, bottom - top) * aspect);
  let w = most;
  let focus: { left: number; top: number; width: number; height: number } | null = at(".ag-cast") ?? at(".ag-strip");
  const find = (sel: string) => [...room.querySelectorAll(sel)].map(box).filter((r): r is DOMRect => !!r);
  let pics = find(".ag-cast .ag-lt, .ag-cast .ag-cast-pane, .ag-cast .ag-cast-main");
  if (!pics.length) pics = find(".ag-cast .ag-lt-empty");
  if (pics.length) {
    const x0 = Math.min(...pics.map((r) => r.left)), y0 = Math.min(...pics.map((r) => r.top));
    const all = { left: x0, top: y0, width: Math.max(...pics.map((r) => r.right)) - x0, height: Math.max(...pics.map((r) => r.bottom)) - y0 };
    if (all.width <= most && all.height <= most / aspect) {
      focus = all;
      w = Math.max(all.width, all.height * aspect) * 1.08;
    } else {
      /* Its rounded corners just outside the window. */
      focus = pics[0];
      w = Math.min(focus.width, focus.height * aspect) * 0.94;
    }
    w = Math.min(most, Math.max(win.w, w));
  }
  const h = w / aspect;
  const cx = focus ? focus.left + focus.width / 2 : (left + right) / 2;
  const cy = focus ? focus.top + focus.height / 2 : (top + bottom) / 2;
  return { x: clampTo(cx - w / 2, left, right - w), y: clampTo(cy - h / 2, top, bottom - h), w, h };
}

/* The minimized room's place: the card's window, the part of the room
   it shows, the window's rounded corners (top left, top right, bottom
   right, bottom left — the card's own, where the window meets its edge),
   and the screen they were worked out for. */
type Pip = { win: Box; crop: Box; radii: number[]; vw: number; vh: number };

/* A rectangle with rounded corners (top left, top right, bottom right,
   bottom left) as a clip path. A path rather than inset(… round …):
   Chrome runs a path's changes off the main thread, where a rounded
   inset() is redrawn on it — and fell behind the move, its edges
   jumping, whenever the page underneath was busy arriving. Every corner
   is at least a hair round, so each frame's path has the same parts. */
function roundedRect(x: number, y: number, w: number, h: number, radii: number[]) {
  const [a, b, c, d] = radii.map((r) => Math.max(0.01, Math.min(r, w / 2, h / 2)));
  const n = (v: number) => +v.toFixed(2);
  return (
    `path('M ${n(x + a)} ${n(y)} H ${n(x + w - b)} A ${n(b)} ${n(b)} 0 0 1 ${n(x + w)} ${n(y + b)} ` +
    `V ${n(y + h - c)} A ${n(c)} ${n(c)} 0 0 1 ${n(x + w - c)} ${n(y + h)} ` +
    `H ${n(x + d)} A ${n(d)} ${n(d)} 0 0 1 ${n(x)} ${n(y + h - d)} ` +
    `V ${n(y + a)} A ${n(a)} ${n(a)} 0 0 1 ${n(x + a)} ${n(y)} Z')`
  );
}

/* The room at progress p along the move (0 the whole screen, 1 the
   card's window): its even scale and place, and the window cut around
   it, rounding as it goes in. */
function pipFrame({ win, crop, radii, vw, vh }: Pip, p: number) {
  /* On screen: the whole screen closing onto the card's window. */
  const sx = win.x * p, sy = win.y * p, sw = vw + (win.w - vw) * p;
  /* In the room: all of it narrowing onto the stage. */
  const bx = crop.x * p, by = crop.y * p;
  const bw = vw + (crop.w - vw) * p, bh = vh + (crop.h - vh) * p;
  const u = sw / bw;
  return {
    transform: `translate(${sx - bx * u}px, ${sy - by * u}px) scale(${u})`,
    clipPath: roundedRect(bx, by, bw, bh, radii.map((r) => (r * p) / u)),
  };
}

function fmtElapsed(fromIso: string | null): string {
  if (!fromIso) return "00:00:00";
  const ms = Date.now() - new Date(fromIso).getTime();
  if (ms < 0) return "00:00:00";
  const s = Math.floor(ms / 1000);
  const hh = String(Math.floor(s / 3600)).padStart(2, "0");
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

interface PendingInvite {
  id: string;
  inviterName: string;
}

/* Route param may be a full uuid (legacy links) or a slug ending in an
   8-char id prefix (pretty links) — resolve to the uuid, then render. */
export default function AgoraPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawParam } = use(params);
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const parsed = useMemo(() => parseRoomParam(rawParam), [rawParam]);
  const [resolvedId, setResolvedId] = useState<string | null>(parsed.uuid ?? null);
  useEffect(() => {
    if (parsed.uuid || !parsed.prefix) {
      if (!parsed.uuid && !parsed.prefix) router.replace("/");
      return;
    }
    /* The slug lookup runs on every load, including the reload after a
       phone tab crash, when the request can fail before the radio is
       back. A failed request is not "no such room": retry a few times
       and only a definite null sends anyone home. */
    let stale = false;
    const attempt = (n: number) => {
      supabase.rpc("resolve_room_prefix", { p_prefix: parsed.prefix }).then(({ data, error }) => {
        if (stale) return;
        if (data) { setResolvedId(data as string); return; }
        if (error && n < 4) { setTimeout(() => attempt(n + 1), 800 * (n + 1)); return; }
        router.replace("/");
      }, () => {
        if (stale) return;
        if (n < 4) setTimeout(() => attempt(n + 1), 800 * (n + 1));
        else router.replace("/");
      });
    };
    attempt(0);
    return () => { stale = true; };
  }, [parsed, router, supabase]);

  /* While the room is looked up: the sky that brought us here, if it
     did — see RoomWait. */
  if (!resolvedId) return <RoomWait />;
  return <AgoraRoom roomId={resolvedId} />;
}

/* The waits before a room is known: its address looked up, its data
   loaded. Entering a live room from a card or Watch Live is one exposure
   from the click to the stage — the sky came up over the page left
   behind and carries on here, the same stars still turning
   (lib/skySplash.ts: carried across the page load from a card, handed
   over in the same document for a room opened in the app, like one you
   have just made), until the entering overlay takes it over and ends
   on the stage. With no sky to carry (a link opened cold, a past
   discussion) the screen stays out of sight and the bar does the
   waiting: the sky is for a call, and a past discussion never sees it. */
function RoomWait() {
  return (
    <>
      <RouteLoading />
      <LoadingScreen carry label="Entering the Agora" />
    </>
  );
}

function AgoraRoom({ roomId }: { roomId: string }) {
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  /* Where the room sits: the root layout's call slot, which keeps it —
     and the call — while you browse other pages (CallSlot.tsx). */
  const slot = useCallSlot();
  const minimizedRef = useRef(slot.minimized);
  useEffect(() => {
    minimizedRef.current = slot.minimized;
  }, [slot.minimized]);

  const [room, setRoom] = useState<
    | (DebateRoom & {
        speaker_requests_locked?: boolean;
        queue_auto_advance?: boolean;
        mic_user_id?: string | null;
      })
    | null
  >(null);
  const [participants, setParticipants] = useState<StageParticipant[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loaded, setLoaded] = useState(false);
  /* The room row came back empty under RLS — either it doesn't exist or
     this visitor isn't allowed into a followers/friends room. get_room_gate
     (below) tells the two apart and drives the denial screen. */
  const [roomUnreadable, setRoomUnreadable] = useState(false);
  const [deniedGate, setDeniedGate] = useState<
    { motion: string; host: string | null; mode: string | null; communityName: string | null } | null
  >(null);
  /* Invite-code entry on the denial screen — the code is the key, and on
     success join_private_room seats us, so a refetch walks straight in. */
  const [gateCode, setGateCode] = useState("");
  const [gateCodeBusy, setGateCodeBusy] = useState(false);
  const [gateCodeErr, setGateCodeErr] = useState<string | null>(null);
  /* Status the room had when this visitor first loaded it — 'ended' here
     means they arrived after the close and should get the replay. */
  const [firstStatus, setFirstStatus] = useState<string | null>(null);
  const [following, setFollowing] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);
  /* Host leave flow: leaving as host asks whether to close the stage. */
  const [leavePrompt, setLeavePrompt] = useState(false);
  /* ?avdebug=1 — live snapshot of the call plumbing for field debugging. */
  const [avDebug, setAvDebug] = useState<Record<string, unknown> | null>(null);
  const avDebugOn = useMemo(
    () => typeof window !== "undefined" && new URLSearchParams(window.location.search).has("avdebug"),
    []
  );
  /* Egress compositor mode: LiveKit's headless browser loads this page with
     ?token&url appended — render the amphitheater alone (no chrome) and
     signal readiness so the recorder starts filming. */
  const broadcastCreds = useMemo(() => {
    if (typeof window === "undefined") return null;
    const sp = new URLSearchParams(window.location.search);
    const token = sp.get("token");
    const serverUrl = sp.get("url");
    return token && serverUrl ? { token, serverUrl } : null;
  }, []);
  const broadcast = !!broadcastCreds;
  /* The same view opened by a host's own streaming app (lib/ownStream,
     `own` in the link) rather than LiveKit's recorder: a picture to be
     watched as it is, in a frame of whatever shape they chose. */
  const ownStream = useMemo(
    () => broadcast && typeof window !== "undefined" && new URLSearchParams(window.location.search).has("own"),
    [broadcast]
  );
  /* LiveKit's recorder alone carries a pass (`rk`) for noting who is
     speaking, which is what names the lines of the replay's transcript
     (useRecorderSpeech). A host's own stream link has none. */
  const recorderPass = useMemo(() => {
    if (!broadcast || ownStream || typeof window === "undefined") return null;
    const raw = new URLSearchParams(window.location.search).get("rk");
    return raw ? raw.split("?")[0] : null;
  }, [broadcast, ownStream]);
  const [closingStage, setClosingStage] = useState(false);
  const [elapsed, setElapsed] = useState("00:00:00");
  const [view, setView] = useState<AgoraView>("audience");
  /* Queue-matched 1v1 ("duel"): pro_size/con_size of 1 are written only
     by queue_for_topic — the create modal passes 10/10 under the hood.
     Duels eliminate the amphitheater vantage for everyone in the room:
     no view toggle, no layout switch — just the two speaker screens
     (gallery layout, which renders exactly two face-to-face panes). */
  const duel = !broadcastCreds && room?.pro_size === 1 && room?.con_size === 1;
  /* ── Call layout: the viewer's own arrangement of the live pictures.
     Orthogonal to the 3D vantage: "stage" is today's behavior; "gallery"
     and "multi" are flat overlays above the scene. Local-only — nothing
     changes on the wire — and remembered across visits. */
  const [layout, setLayout] = useState<"stage" | "gallery" | "multi">("stage");
  /* "Simple stage": no 3D scene — chosen in the call's settings, or
     decided for a browser drawing WebGL in software (lib/stageQuality). */
  const simpleStage = useSimpleStage();
  /* The viewer's own arrangement of the cameras (lib/callView). */
  const callView = useCallView();
  /* Phones run the room flat: no 3D scene, and the stage layout (which
     is the scene) isn't offered — gallery stands in for it. */
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const apply = () => setPhone(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  useEffect(() => {
    try {
      const saved = localStorage.getItem("agora:call-layout");
      if (saved === "gallery" || saved === "multi" || saved === "stage") setLayout(saved);
    } catch {
      /* private mode — default stands */
    }
  }, []);
  /* Tall cameras: a column the shape of a phone, in the gallery. A phone
     is that shape already, and the filmed views take theirs from the
     frame. */
  const tallCameras = callView.tall && !phone && !broadcast;
  /* Tall cameras took the viewer off the 3D stage (it is a gallery
     arrangement): turned off again, it gives the stage back. */
  const tookFromStage = useRef(false);
  useEffect(() => {
    if (!phone && !simpleStage.on && !ownStream && !tallCameras) {
      if (tookFromStage.current) {
        tookFromStage.current = false;
        setLayout((l) => (l === "gallery" ? "stage" : l));
      }
      return;
    }
    /* The tiles only exist in speaker view (audience view is the open
       amphitheater, which phones don't render) — so phones live there,
       and so does anyone on the simple stage: with no scene, the
       audience view is an empty backdrop and the vantage toggle that
       would leave it is hidden with the scene. */
    setView("speaker");
    const onlyForTall = tallCameras && !phone && !simpleStage.on && !ownStream;
    setLayout((l) => {
      if (l !== "stage") return l;
      if (onlyForTall) tookFromStage.current = true;
      return "gallery";
    });
  }, [phone, simpleStage.on, ownStream, tallCameras]);
  const pickLayout = useCallback((l: "stage" | "gallery" | "multi") => {
    setLayout(l);
    try {
      localStorage.setItem("agora:call-layout", l);
    } catch {
      /* best effort */
    }
  }, []);
  /* The viewer's pin, held as a tile key and resolved against the live
     list every render — a feed that ends simply stops matching and the
     multi layout falls back to its recent-speakers logic. */
  const [layoutPin, setLayoutPin] = useState<string | null>(null);
  /* `g` cycles layouts, Zoom-fashion — unless something is being typed. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "g" && e.key !== "G") return;
      if (minimizedRef.current) return; // browsing with the call minimized
      if (duel) return; // duels are locked to the two-pane gallery
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      setLayout((prev) => {
        const next = prev === "stage" ? "gallery" : prev === "gallery" ? "multi" : "stage";
        try {
          localStorage.setItem("agora:call-layout", next);
        } catch {
          /* best effort */
        }
        return next;
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [duel]);
  /* Duel rooms land everyone in the two-pane view. setLayout directly
     (not pickLayout) so the viewer's saved layout preference for normal
     rooms is left alone. */
  useEffect(() => {
    if (!duel) return;
    setView("speaker");
    setLayout("gallery");
  }, [duel]);
  /* Unpinning the near-fullscreen screen share in a duel snaps back to
     the two-pane gallery instead of stranding the pair in multi view. */
  useEffect(() => {
    if (duel && layout === "multi" && !layoutPin) setLayout("gallery");
  }, [duel, layout, layoutPin]);
  /* The DOM stage holds back until the camera glide lands on the current
     vantage — fading panes in mid-flight read as riding the camera. */
  const [viewSettled, setViewSettled] = useState(false);
  /* Chat rail collapsed → the stage runs the full width of the page, for
     watching without the chat in frame. Lives here rather than in the
     rail because the collapsed class drives layout on .ag-root. */
  const [railCollapsed, setRailCollapsed] = useState(false);
  /* The chat rail sliding in or out (0.34 s in CSS): the stage re-frames
     on every frame of it, so it draws every frame for it too — even as a
     backdrop behind a flat layout, where it otherwise runs at 15 fps and
     the re-framing would step. */
  const [railSliding, setRailSliding] = useState(false);
  const [seenRail, setSeenRail] = useState(railCollapsed);
  if (railCollapsed !== seenRail) {
    setSeenRail(railCollapsed);
    setRailSliding(true);
  }
  useEffect(() => {
    if (!railSliding) return;
    const t = window.setTimeout(() => setRailSliding(false), 450);
    return () => window.clearTimeout(t);
  }, [railSliding, railCollapsed]);
  /* Phone-only: the chat sheet. Desktop ignores it (agora.css). */
  const [chatOpen, setChatOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /* Audience overflow: watch the composited HLS stream instead of WebRTC. */
  const [invite, setInvite] = useState<PendingInvite | null>(null);
  useEffect(() => {
    setViewSettled(false);
  }, [view]);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [handBusy, setHandBusy] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  const [topMenuOpen, setTopMenuOpen] = useState(false);

  const [camMenuOpen, setCamMenuOpen] = useState(false);
  const camMenuRef = useRef<HTMLDivElement | null>(null);
  const [micMenuOpen, setMicMenuOpen] = useState(false);
  const micMenuRef = useRef<HTMLDivElement | null>(null);
  const topMenuRef = useRef<HTMLDivElement | null>(null);
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [noteBusy, setNoteBusy] = useState(false);
  const [noteDone, setNoteDone] = useState(false);
  const moreWrapRef = useRef<HTMLDivElement | null>(null);
  const [copied, setCopied] = useState(false);
  /* Community-hosted rooms carry the community's name in the topbar. */
  const [communityName, setCommunityName] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      const [{ data: roomData, error: roomErr }, { data: partData }] = await Promise.all([
        supabase.from("debate_rooms").select("*").eq("id", roomId).maybeSingle(),
        supabase
          .from("debate_participants")
          .select("*, user:users(username, display_name, avatar_url)")
          .eq("room_id", roomId)
          .is("left_at", null),
      ]);
      if (roomErr) {
        logRoomEvent(roomId, "room_fetch_fail", roomErr.message);
        /* A failed request is not a missing room. This refetch runs on
           every participant heartbeat, and a phone's radio drops requests
           whenever the page is disturbed (a permission prompt, a tap that
           wakes the connection) — treating that as "unreadable" sent
           people through the gate and out of the room. Keep what we have;
           the next change or the 30s tick tries again. */
        console.warn("agora room fetch failed", roomErr.message);
        return;
      }
      if (!roomData) {
        /* Don't redirect yet: an empty row can mean "denied into a
           followers/friends room", which deserves the gate screen. The
           get_room_gate effect resolves gone-vs-denied. */
        setRoomUnreadable(true);
        return;
      }
      setRoomUnreadable(false);
      setRoom(roomData);
      setFirstStatus((prev) => prev ?? roomData.status);
      if (partData) setParticipants(partData as StageParticipant[]);
      /* The room is known: it can mount and its call can start now. A
         community room's name is a label in the top bar, not a reason to
         hold everything else back another round trip. */
      setLoaded(true);
      if (roomData.community_id) {
        const { data: comm } = await supabase
          .from("communities")
          .select("name")
          .eq("id", roomData.community_id)
          .maybeSingle();
        setCommunityName(comm?.name ?? null);
      } else {
        setCommunityName(null);
      }
    } catch (e) {
      console.error("agora load failed", e);
    } finally {
      setLoaded(true);
    }
  }, [roomId, router, supabase]);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await sessionUser(supabase);
        setCurrentUser(data.user);
      } catch {
        /* signed-out guests are fine */
      }
    })();
    fetchAll();

    const channel = supabase
      .channel(`agora-room-${roomId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "debate_rooms", filter: `id=eq.${roomId}` },
        fetchAll
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "debate_participants", filter: `room_id=eq.${roomId}` },
        fetchAll
      )
      .subscribe();
    const heartbeat = setInterval(fetchAll, 30000);
    return () => {
      supabase.removeChannel(channel);
      clearInterval(heartbeat);
    };
  }, [fetchAll, roomId, supabase]);

  /* ── Invite listener: the consent moment arrives live ─────────────
     A pending invite for me (existing on load, or inserted while I'm
     here) raises the "«host» has invited you" prompt. Fails silent
     when the stage migration isn't applied yet. */
  const userId = currentUser?.id;
  useEffect(() => {
    if (!userId) return;

    const surface = async (inviteId: string, inviterId: string) => {
      let name = "The host";
      try {
        const { data } = await supabase
          .from("users")
          .select("username, display_name")
          .eq("id", inviterId)
          .maybeSingle();
        if (data) name = displayName(data) || name;
      } catch {
        /* name is cosmetic */
      }
      setInvite({ id: inviteId, inviterName: name });
    };

    (async () => {
      try {
        const { data } = await supabase
          .from("stage_invites")
          .select("id, inviter_id")
          .eq("room_id", roomId)
          .eq("invitee_id", userId)
          .eq("status", "pending")
          .order("created_at", { ascending: false })
          .limit(1);
        if (data?.[0]) surface(data[0].id, data[0].inviter_id);
      } catch {
        /* table not migrated yet */
      }
    })();

    const channel = supabase
      .channel(`agora-invites-${roomId}-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "stage_invites",
          filter: `invitee_id=eq.${userId}`,
        },
        (payload) => {
          const row = payload.new as { id: string; room_id: string; inviter_id: string; status: string };
          if (row.room_id === roomId && row.status === "pending") surface(row.id, row.inviter_id);
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, roomId, supabase]);

  /* Elapsed ticker */
  useEffect(() => {
    if (!room) return;
    const from = room.started_at ?? room.created_at;
    setElapsed(fmtElapsed(from));
    const t = setInterval(() => setElapsed(fmtElapsed(from)), 1000);
    return () => clearInterval(t);
  }, [room]);

  const myParticipation = useMemo(
    () => (currentUser ? participants.find((p) => p.user_id === currentUser.id) ?? null : null),
    [participants, currentUser]
  );
  useEscapeClose(leavePrompt, () => setLeavePrompt(false));

  /* The tool panel is large enough that leaving it open until the trigger
     is pressed again feels like a stuck overlay, so it takes the two
     dismissals people try by reflex. `pointerdown` rather than `click`:
     it fires before focus moves, so the panel is already gone by the time
     whatever was clicked underneath reacts. */
  useEscapeClose(moreOpen, () => setMoreOpen(false));
  useEscapeClose(chatOpen, () => setChatOpen(false));
  useEscapeClose(topMenuOpen, () => setTopMenuOpen(false));
  useEscapeClose(camMenuOpen, () => setCamMenuOpen(false));
  useEscapeClose(micMenuOpen, () => setMicMenuOpen(false));
  useEffect(() => {
    if (!micMenuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!micMenuRef.current?.contains(e.target as Node)) setMicMenuOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [micMenuOpen]);
  useEscapeClose(settingsOpen, () => setSettingsOpen(false));
  useEffect(() => {
    if (!camMenuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!camMenuRef.current?.contains(e.target as Node)) setCamMenuOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [camMenuOpen]);
  useEscapeClose(noteOpen, () => setNoteOpen(false));
  useEffect(() => {
    if (!topMenuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!topMenuRef.current?.contains(e.target as Node)) setTopMenuOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [topMenuOpen]);
  useEffect(() => {
    if (!moreOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!moreWrapRef.current?.contains(e.target as Node)) setMoreOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [moreOpen]);

  /* Host toggle for Agora's Live Moderator mode (agora_moderator column). */
  const toggleModerator = useCallback(
    async (on: boolean) => {
      if (!currentUser || !room || currentUser.id !== room.host_id) return;
      setRoom((r) => (r ? { ...r, agora_moderator: on } : r));
      const { error } = await supabase
        .from("debate_rooms")
        .update({ agora_moderator: on })
        .eq("id", room.id);
      if (error) {
        console.error("moderator toggle failed", error);
        setRoom((r) => (r ? { ...r, agora_moderator: !on } : r));
      }
    },
    [currentUser, room, supabase]
  );

  const myRole = useMemo(() => {
    if (!room) return "audience" as const;
    if (myParticipation) return deriveStageRole(myParticipation, room);
    // Not seated yet: the room creator still holds host power.
    if (currentUser && currentUser.id === room.host_id) return "host" as const;
    return "audience" as const;
  }, [myParticipation, currentUser, room]);

  /* ── Scheduled-debate door ─────────────────────────────────────────
     A scheduled room opens 30 minutes before its start time. Until then
     only the host may enter (to set up); everyone else waits outside. */
  const opensAtMs = useMemo(() => {
    if (!room?.scheduled_start || room.status === "live" || room.status === "ended") return null;
    return new Date(room.scheduled_start).getTime() - 30 * 60 * 1000;
  }, [room?.scheduled_start, room?.status]);
  const [nowTs, setNowTs] = useState(() => Date.now());
  useEffect(() => {
    if (opensAtMs === null || Date.now() >= opensAtMs) return;
    const t = setInterval(() => setNowTs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [opensAtMs]);
  const gated = opensAtMs !== null && nowTs < opensAtMs && myRole !== "host" && !broadcast;

  /* ── Private-room access gate (20260866) ──────────────────────────
     RLS is the authority now: followers/friends rooms are readable only
     to eligible visitors, so if `room` loaded at all, we're in. When it
     came back empty (roomUnreadable), get_room_gate says whether the room
     is simply gone (→ home) or exists but off-limits (→ denial screen).
     Ineligible visitors therefore never receive the room row, so no room
     UI can flash and no participant data leaks client-side. */
  useEffect(() => {
    if (!loaded || !roomUnreadable || deniedGate) return;
    let stale = false;
    supabase.rpc("get_room_gate", { p_room: roomId }).then(({ data, error }) => {
      if (stale) return;
      if (error) {
        /* The gate couldn't be asked (the request failed) — that's not a
           verdict. Drop back to the room we had and let the next refetch
           try again; only a definite "no such room" sends anyone home. */
        console.warn("agora gate check failed", error.message);
        logRoomEvent(roomId, "gate_fail", error.message);
        setRoomUnreadable(false);
        return;
      }
      const g = Array.isArray(data) ? data[0] : data;
      if (!g || !g.room_exists) {
        logRoomEvent(roomId, "gate_exit", "room_missing");
        router.replace("/");
        return;
      }
      if (g.allowed) {
        /* Readable per the gate but the direct fetch missed it — a
           transient race (e.g. a follow that just landed). Retry once. */
        setRoomUnreadable(false);
        fetchAll();
        return;
      }
      logRoomEvent(roomId, "gate_denied", g.access_mode);
      setDeniedGate({ motion: g.motion, host: g.host_username, mode: g.access_mode, communityName: g.community_name ?? null });
    });
    return () => {
      stale = true;
    };
  }, [loaded, roomUnreadable, deniedGate, roomId, supabase, router, fetchAll]);

  /* ── Seat heartbeat ────────────────────────────────────────────────
     touch_seat stamps our participant row's last_seen_at; ghost seats
     are swept server-side after 5 minutes of silence. */
  const heartbeatOn =
    !!currentUser && !!room && room.status !== "ended" && !gated && !broadcast;
  useEffect(() => {
    if (!heartbeatOn) return;
    const beat = () => supabase.rpc("touch_seat", { p_room: roomId }).then(undefined, () => {});
    beat();
    const t = setInterval(beat, 60_000);
    return () => clearInterval(t);
  }, [heartbeatOn, roomId, supabase]);

  /* ── Live call (LiveKit) ───────────────────────────────────────────
     Everyone connects: on-stage roles with publish rights, listeners and
     guests subscribe-only. The buttons below drive this, and the active-
     speaker set feeds the stage rings with real voice activity. */
  const myUsername =
    displayName(myParticipation?.user) ||
    (currentUser?.email?.split("@")[0] ?? "Guest");
  /* Tile count fed back into the call's quality hint (set post-render). */
  const [liveTileCount, setLiveTileCount] = useState(0);
  const call = useAgoraCall({
    roomId,
    userId: currentUser?.id ?? null,
    username: myUsername,
    canPublish: onStage(myRole),
    /* An ended room is a replay: never ask LiveKit for a token for it —
       the token route refuses (403 room_ended) and the refusal logged as
       a failed connect on every replay opened. */
    ready: loaded && !!room && room.status !== "ended" && !gated,
    /* Big tiles deserve the high simulcast layer: the close-up 3D
       vantage as before, multi-speaker always (its featured tiles are
       large), and gallery when tiles are few enough to render big.
       liveTileCount lags one render behind the call — harmless, it only
       retunes subscription quality. */
    highQuality:
      layout === "multi"
        ? liveTileCount > 0
        : layout === "gallery"
          ? liveTileCount > 0 && liveTileCount <= 4
          : view === "speaker",
    external: broadcastCreds,
  });
  useEffect(() => {
    setLiveTileCount(call.videoTiles.length);
  }, [call.videoTiles.length]);

  /* ── HLS audience mode ─────────────────────────────────────────────
     Over the spectator ceiling the token API answers "watch the
     broadcast" instead of minting a WebRTC token: the stage surface
     renders the composited HLS stream and the publish controls hide.
     Chat and hand-raise are Supabase-driven and keep working.
     Promotion is seamless: an approved raise-hand updates our
     participants row, onStage(myRole) flips, and the call hook's
     connect effect re-requests a token with the new role — the server
     sees the stage row and hands out WebRTC. */
  const hlsAudience = !broadcast && !!call.hlsMode;
  /* The broadcast's sound, for the call card's sound button: the picture
     in its window is the room's, out of reach there. */
  const broadcastSound = useBroadcastSound();
  /* The host's profile for the top bar, from their seat's row. */
  const hostUser = room ? participants.find((pp) => pp.user_id === room.host_id)?.user ?? null : null;

  /* Following the host is the real relationship (user_follows, through
     the same follow_user / unfollow_user everyone else uses), not a
     local toggle — and the host gets no button for themselves. */
  const hostId = room?.host_id ?? null;
  const isHostViewer = !!currentUser && !!hostId && currentUser.id === hostId;
  useEffect(() => {
    if (!currentUser || !hostId || isHostViewer) return;
    let alive = true;
    supabase
      .from("user_follows")
      .select("following_id")
      .eq("follower_id", currentUser.id)
      .eq("following_id", hostId)
      .maybeSingle()
      .then(({ data }) => { if (alive) setFollowing(!!data); });
    return () => { alive = false; };
  }, [supabase, currentUser, hostId, isHostViewer]);
  const toggleFollow = useCallback(async () => {
    if (!hostId) return;
    if (!currentUser) { window.location.href = "/login"; return; }
    if (followBusy || isHostViewer) return;
    setFollowBusy(true);
    const { error } = await supabase.rpc(following ? "unfollow_user" : "follow_user", { p_target: hostId });
    setFollowBusy(false);
    if (error) return;
    setFollowing(!following);
    window.dispatchEvent(new CustomEvent("follows-updated", { detail: { userId: hostId, following: !following } }));
  }, [supabase, currentUser, hostId, isHostViewer, followBusy, following]);

  /* ── The sky while the call connects ──────────────────────────────
     The loading screen that brought us here stays over the stage until
     the call is up (or the broadcast view is): its sky continues the
     entry screen's, so arriving in a room is one unbroken exposure that
     ends on the stage: the stars, and at their centre the mark over
     "Entering the Agora" (no bar). At least a beat, so it never
     flashes; at most twelve seconds, so a stalled connection can't trap
     anyone behind it — the stage's own "Connecting…" and retry take
     over then. */
  const callUp = call.connected || hlsAudience;
  const [entering, setEntering] = useState<"up" | "leaving" | "gone">("up");
  const enteredAt = useRef<number | null>(null);
  useEffect(() => {
    if (entering !== "up") return;
    if (broadcast) { queueMicrotask(() => setEntering("gone")); return; }
    enteredAt.current ??= Date.now();
    const ENTER_MIN_MS = 1200, ENTER_CAP_MS = 12000;
    const elapsed = Date.now() - enteredAt.current;
    /* The beat counts from when the sky came up, not from when this
       room mounted: a sky carried in from a card, or brought up when a
       room was made, has usually been turning for a while already, and
       holding it another full beat on top was pure waiting. */
    const S = window.__agoraSkySession;
    const skyUp = S && S.frozen == null && S.live > 0 && S.start != null ? performance.now() - S.start : 0;
    const shown = Math.max(elapsed, skyUp);
    const wait = callUp ? Math.max(0, ENTER_MIN_MS - shown) : Math.max(0, ENTER_CAP_MS - elapsed);
    const t = window.setTimeout(() => setEntering("leaving"), wait);
    return () => clearTimeout(t);
  }, [entering, callUp, broadcast]);
  useEffect(() => {
    if (entering !== "leaving") return;
    const t = window.setTimeout(() => setEntering("gone"), 420);
    return () => clearTimeout(t);
  }, [entering]);
  const { hlsMode, retryConnect } = call;
  useEffect(() => {
    /* Egress died mid-watch (hls_url nulled via realtime): fall back to
       requesting a WebRTC token — with no stream the threshold check
       lets everyone in. */
    if (!hlsMode || broadcast || !room) return;
    if (room.status === "live" && !room.hls_url) retryConnect();
  }, [hlsMode, broadcast, room, retryConnect]);

  /* Raised-hand fast lane, waiting side: a broadcast viewer whose hand is
     up but who was beyond the fast-lane cap re-asks the token API each
     time the line moves forward (someone ahead was brought up or gave
     up) — the server re-ranks and may now grant the real-time WebRTC
     seat. Deliberately narrow deps + a decrease check: hlsMode is a
     fresh object per token answer, so keying on it would loop. */
  const prevQueuePosRef = useRef<number | null>(null);

  useEffect(() => {
    if (!avDebugOn) return;
    const t = setInterval(() => setAvDebug(call.debugSnapshot()), 1000);
    return () => clearInterval(t);
  }, [avDebugOn, call]);

  useEffect(() => {
    if (!broadcast) return;
    setView("speaker");
  }, [broadcast]);

  /* ── Default recording: every live debate streams to HLS/R2 so the
        replay always exists and overflow viewers can watch. The host's
        client starts it once connected; harmless if already running
        (the egress route reuses an active stream) and best-effort —
        the debate never blocks on it. Cron/close-stage stop it. ── */
  const autoHlsRef = useRef(false);
  useEffect(() => {
    if (broadcast || autoHlsRef.current) return;
    if (!room || room.status !== "live" || room.hls_url) return;
    if (!currentUser || currentUser.id !== room.host_id || !call.connected) return;
    autoHlsRef.current = true;
    (async () => {
      try {
        const res = await fetch("/api/egress", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ roomId: room.id, action: "start_hls" }),
        });
        if (!res.ok) {
          const txt = await res.text();
          /* Host turned VODs off, or their storage allowance is full —
             a choice, not a fault: stay quiet and don't retry. */
          if (/recording_disabled|storage_full/.test(txt)) return;
          console.warn("[agora] auto HLS start failed:", txt);
          autoHlsRef.current = false; // allow a retry on the next state change
        }
      } catch (e) {
        console.warn("[agora] auto HLS start failed:", e);
        autoHlsRef.current = false;
      }
    })();
  }, [broadcast, room, currentUser, call.connected]);

  /* While a recorded call runs, the host's page checks on the recorder
     every 20 s: LiveKit's machines can let it go ("CPU exhausted" in
     production), and word of it never reached the webhook when tested —
     the check closes that part and starts the next (/api/egress
     check_recording, lib/recordingEgress). */
  const hostRecording =
    !broadcast && !!room && room.status === "live" && !!room.hls_url && !!currentUser && currentUser.id === room.host_id && call.connected;
  const recordingRoomId = room?.id ?? null;
  useEffect(() => {
    if (!hostRecording || !recordingRoomId) return;
    const every = setInterval(() => {
      void fetch("/api/egress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId: recordingRoomId, action: "check_recording" }),
      }).catch(() => {});
    }, 20_000);
    return () => clearInterval(every);
  }, [hostRecording, recordingRoomId]);

  /* The recording's backdrop, a still of the stage (agora.css), loaded
     before filming starts so a replay never opens on black — at most 3 s. */
  const [backdropReady, setBackdropReady] = useState(false);
  useEffect(() => {
    if (!broadcast) return;
    let done = false;
    const ready = () => {
      if (done) return;
      done = true;
      setBackdropReady(true);
    };
    const img = new Image();
    img.onload = ready;
    img.onerror = ready;
    img.src = "/recording-stage.jpg";
    const cap = window.setTimeout(ready, 3000);
    return () => {
      done = true;
      window.clearTimeout(cap);
    };
  }, [broadcast]);
  useRecorderSpeech({ roomId, pass: recorderPass, connected: call.connected, speaking: call.speakingIds });
  const recordingSignaledRef = useRef(false);
  useEffect(() => {
    if (!broadcast || recordingSignaledRef.current) return;
    if (loaded && room && call.connected && backdropReady) {
      recordingSignaledRef.current = true;
      // LiveKit egress template contract: filming begins on this log line.
      console.log("START_RECORDING");
    }
  }, [broadcast, loaded, room, call.connected, backdropReady]);
  const [reactOpen, setReactOpen] = useState(false);

  /* ── Stage composition ─────────────────────────────────────────────
     Debaters keep their PRO/CON panels. Everyone else on stage (hosts,
     co-hosts, promoted speakers) forms the discussion strip. The
     audience visualization excludes people who are on stage — their
     seat empties when they come up. */
  const { proSpeakers, conSpeakers, stageStrip, audience } = useMemo(() => {
    if (!room) return { proSpeakers: [], conSpeakers: [], stageStrip: [], audience: [] };
    const withRoles = participants.map((p) => ({ p, stageRole: deriveStageRole(p, room) }));
    const debaters = withRoles.filter(({ p }) => p.role === "debater");
    const toStage = ({ p, stageRole }: (typeof withRoles)[number]) => ({
      id: p.user_id,
      username: p.user?.username ?? "?",
      name: displayName(p.user) || "?",
      avatarUrl: p.user?.avatar_url ?? null,
      /* Real voice activity once the call is up; DB heartbeat otherwise. */
      speaking: call.connected ? call.speakingIds.has(p.user_id) : !p.mic_muted,
      micMuted: p.user_id === currentUser?.id ? !call.micOn : !!p.mic_muted,
      stageRole,
    });
    return {
      proSpeakers: debaters.filter(({ p }) => p.stance === "PRO").map(toStage),
      conSpeakers: debaters.filter(({ p }) => p.stance === "CON").map(toStage),
      stageStrip: withRoles
        .filter(({ p, stageRole }) => p.role !== "debater" && stageRole !== "audience")
        .sort((a, b) => rank(a.stageRole) - rank(b.stageRole))
        .map(toStage),
      audience: withRoles
        .filter(
          ({ p, stageRole }) =>
            p.role === "spectator" &&
            stageRole === "audience" &&
            /* Queue members and the mic holder leave their seats — they
               stand in the center aisle / at the medallion instead. */
            !p.hand_raised_at &&
            p.user_id !== room.mic_user_id
        )
        .map(({ p }) => ({
          id: p.user_id,
          username: p.user?.username ?? "?",
          name: displayName(p.user) || "?",
          avatarUrl: p.user?.avatar_url ?? null,
        })),
    };
  }, [participants, room, call.connected, call.speakingIds]);

  function rank(role: string) {
    return role === "host" ? 0 : role === "cohost" ? 1 : 2;
  }

  /* ── Speaker queue (derived — the DB timestamps ARE the queue) ─────
     Order: hand_raised_at asc, user_id tiebreak — identical to the
     advance_speaker_queue RPC, so every client sees the same line. */
  const micHolder = useMemo(() => {
    const uid = room?.mic_user_id;
    if (!uid) return null;
    const p = participants.find((x) => x.user_id === uid && !x.left_at);
    return p
      ? {
          id: p.user_id,
          username: p.user?.username ?? "?",
          name: displayName(p.user) || "?",
          avatarUrl: p.user?.avatar_url ?? null,
        }
      : null;
  }, [room?.mic_user_id, participants]);

  const speakerQueue = useMemo(() => {
    if (!room) return [];
    return sortRequests(
      participants.filter(
        (p) =>
          !p.left_at &&
          p.hand_raised_at &&
          p.user_id !== room.mic_user_id &&
          !isHostRole(deriveStageRole(p, room))
      )
    ).map((p) => ({
      id: p.user_id,
      username: p.user?.username ?? "?",
      name: displayName(p.user) || "?",
      avatarUrl: p.user?.avatar_url ?? null,
    }));
  }, [participants, room]);

  const amMicHolder = !!currentUser && room?.mic_user_id === currentUser.id;
  const myQueuePos = useMemo(() => {
    if (!currentUser) return null;
    const idx = speakerQueue.findIndex((p) => p.id === currentUser.id);
    return idx < 0 ? null : idx + 1;
  }, [speakerQueue, currentUser]);

  useEffect(() => {
    const prev = prevQueuePosRef.current;
    prevQueuePosRef.current = myQueuePos;
    if (!hlsAudience || myQueuePos == null) return;
    if (prev != null && myQueuePos < prev) retryConnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires only when the line moves; see prevQueuePosRef comment
  }, [myQueuePos]);

  /* Auto-advance driver: in open-mic mode the host's client brings up the
     front of the line whenever the mic is free. Host-gated server-side too. */
  const advanceGuardRef = useRef(0);
  useEffect(() => {
    if (!room || !currentUser || !isHostRole(myRole)) return;
    if (!room.queue_auto_advance || room.mic_user_id || room.status !== "live") return;
    if (speakerQueue.length === 0) return;
    const now = Date.now();
    if (now - advanceGuardRef.current < 2000) return;
    advanceGuardRef.current = now;
    supabase
      .rpc("advance_speaker_queue", { p_room: roomId })
      .then(({ error }) => {
        if (error) console.warn("auto-advance failed", error.message);
        fetchAll();
      });
  }, [room, currentUser, myRole, speakerQueue.length, roomId, supabase, fetchAll]);

  async function stepDownFromMic() {
    try {
      await supabase.rpc("step_down_from_mic", { p_room: roomId });
      fetchAll();
    } catch (e) {
      console.warn("step down failed", e);
    }
  }

  /* ── Stage panes ───────────────────────────────────────────────────
     The lead PRO/CON speakers own the two stage boxes — DOM now, drawn by
     AgoraStage over the scene where the WebGL panels used to stand. Each
     pane carries its holder's identity plus their live camera when it's
     on; camera off shows the profile card, no holder shows the open
     seat. */

  const { stagePanes, paneStrip } = useMemo(() => {
    const cams = call.videoTiles.filter((t) => t.source === "camera");
    const mk = (sp: (typeof proSpeakers)[number] | undefined) =>
      sp
        ? {
            id: sp.id,
            /* Display name on the tag; raw handle rides along for the menu. */
            username: sp.name || sp.username,
            handle: sp.username,
            avatarUrl: sp.avatarUrl,
            local: currentUser?.id === sp.id,
            micMuted: sp.micMuted,
            tile: cams.find((t) => t.identity === sp.id) ?? null,
          }
        : null;
    const overflow = [...stageStrip];
    const pro = proSpeakers[0] ?? overflow.shift();
    const con = conSpeakers[0] ?? overflow.shift();
    return {
      stagePanes: { pro: mk(pro), con: mk(con) },
      paneStrip: overflow,
    };
  }, [call.videoTiles, proSpeakers, conSpeakers, stageStrip, currentUser]);

  /* Tiles dressed for the flat layouts: display names and mute state
     from the seated rows; the local mute state from the call itself. */
  /* Every on-stage participant gets a tile — live camera when they have
     one, avatar placeholder otherwise — matching what the stage/dock show.
     Screen shares ride along as extra tiles. A camera-off face wears the
     stage's ring: the two pane holders their pane's colour, any other
     debater their stance's — so switching layouts never changes a face. */
  const layoutTiles = useMemo<LayoutTile[]>(() => {
    const sideOf = (id: string): LayoutTile["side"] => {
      if (stagePanes.pro?.id === id) return "pro";
      if (stagePanes.con?.id === id) return "con";
      const p = participants.find((pp) => pp.user_id === id);
      if (p?.role !== "debater") return null;
      return p.stance === "PRO" ? "pro" : p.stance === "CON" ? "con" : null;
    };
    const tiles: LayoutTile[] = call.videoTiles.map((t) => {
      const p = participants.find((pp) => pp.user_id === t.identity);
      return {
        key: tileKey(t),
        identity: t.identity,
        username: (p?.user ? displayName(p.user) : "") || t.username,
        handle: p?.user?.username,
        local: t.local,
        source: t.source,
        track: t.track,
        micMuted: t.local ? !call.micOn : !!p?.mic_muted,
        avatarUrl: p?.user?.avatar_url ?? null,
        side: sideOf(t.identity),
        host: !!p && !!room && isHostRole(deriveStageRole(p, room)),
      };
    });
    const haveCamera = new Set(
      tiles.filter((t) => t.source === "camera").map((t) => t.identity)
    );
    for (const p of participants) {
      if (!room || !onStage(deriveStageRole(p, room))) continue;
      if (p.left_at || haveCamera.has(p.user_id)) continue;
      tiles.push({
        key: `${p.user_id}:off`,
        identity: p.user_id,
        username: (p.user ? displayName(p.user) : "") || p.user?.username || "Speaker",
        handle: p.user?.username,
        local: p.user_id === userId,
        source: "camera",
        track: null,
        micMuted: p.user_id === userId ? !call.micOn : !!p.mic_muted,
        avatarUrl: p.user?.avatar_url ?? null,
        avatarSeed: p.user_id,
        side: sideOf(p.user_id),
        host: isHostRole(deriveStageRole(p, room)),
      });
    }
    return tiles;
  }, [call.videoTiles, call.micOn, participants, room, userId, stagePanes]);

  /* The dock keeps only what the stage doesn't already show at size.
     The stage shows in audience view (anchored fixture) and in settled
     speaker view; while the camera is still gliding in speaker view every
     camera docks as a small tile so nobody's picture is lost. While the
     stage is up, pane holders leave the dock, and a live share empties it
     entirely. Labels prefer the seated row's display name; the raw handle
     rides along for the user context menu. */
  const stageUp = view === "speaker" && viewSettled;
  const dockTiles = useMemo(() => {
    if (stageUp && call.videoTiles.some((t) => t.source === "screen")) return [];
    const paneIds = stageUp
      ? new Set([stagePanes.pro?.id, stagePanes.con?.id].filter(Boolean))
      : new Set<string | undefined>();
    return call.videoTiles
      /* Stage down → everything docks, shares included (small, but not
         invisible; speaker view gives them the big surface). Stage up →
         cameras only, minus the pane holders. */
      .filter((t) => (stageUp ? t.source === "camera" && !paneIds.has(t.identity) : true))
      .map((t) => {
        const u = participants.find((p) => p.user_id === t.identity)?.user;
        return u ? { ...t, username: displayName(u) || t.username, handle: u.username } : t;
      });
  }, [call.videoTiles, stagePanes, participants, stageUp]);

  /* Walking in seats you: signed-in visitors get a spectator row right
     away, so you're visible in the crowd the moment you arrive — raising
     a hand is for speaking, not for existing. Returning visitors get
     their old row restored (left_at cleared) with role untouched, so a
     re-entering host or speaker lands back where they belong. */
  const seatAttemptedRef = useRef(false);
  useEffect(() => {
    if (seatAttemptedRef.current) return;
    if (!loaded || !currentUser || !room || room.status === "ended" || gated) return;
    if (myParticipation) {
      seatAttemptedRef.current = true;
      return;
    }
    seatAttemptedRef.current = true;
    (async () => {
      try {
        const { data: existing } = await supabase
          .from("debate_participants")
          .select("id, left_at")
          .eq("room_id", roomId)
          .eq("user_id", currentUser.id)
          .maybeSingle();
        if (!existing) {
          await supabase
            .from("debate_participants")
            .insert({ room_id: roomId, user_id: currentUser.id, role: "spectator", stance: null });
        } else if (existing.left_at) {
          await supabase
            .from("debate_participants")
            .update({ left_at: null, joined_at: new Date().toISOString() })
            .eq("id", existing.id);
        }
        fetchAll();
      } catch {
        /* seating is cosmetic — the room still works unlisted */
      }
    })();
  }, [loaded, currentUser, room, myParticipation, roomId, supabase, fetchAll, gated]);

  /* Leaving vacates the seat (best effort — a closed tab can't stamp out). */
  const leavingRef = useRef(false);
  const vacateSeat = useCallback(() => {
    leavingRef.current = true;
    logRoomEvent(roomId, "leave");
    try { sessionStorage.removeItem(`agora:live:${roomId}`); } catch { /* private mode */ }
    if (!currentUser || !myParticipation) return;
    supabase
      .from("debate_participants")
      .update({ left_at: new Date().toISOString(), hand_raised_at: null })
      .eq("id", myParticipation.id)
      .then(undefined, () => {});
  }, [currentUser, myParticipation, supabase]);

  /* …but a closed tab CAN stamp out: sendBeacon outlives the page. On
     pagehide (with beforeunload as the fallback for browsers that skip
     it) the beacon hits /api/rooms/leave, which sets our left_at — and,
     for a live host, starts the 90-second host_left_at grace so a plain
     refresh doesn't kill the room (the room-lifecycle cron ends it only
     if we never come back; the LiveKit webhook is the belt to this
     brace). Ref-read so the handler never holds a stale seat. */
  const seatedRef = useRef(false);
  useEffect(() => {
    seatedRef.current = !!(currentUser && myParticipation && !myParticipation.left_at);
  }, [currentUser, myParticipation]);
  useEffect(() => {
    if (broadcast) return; // the egress compositor is not a participant
    const beacon = (e: Event) => {
      /* A pagehide into the back-forward cache is not a departure — the
         page may come straight back (phones do this on a backgrounded
         tab). Vacating the seat there ends a duel for both sides. Only
         a real unload leaves. */
      if ((e as PageTransitionEvent).persisted) return;
      if (!seatedRef.current) return;
      seatedRef.current = false; // pagehide + beforeunload can both fire
      logRoomEvent(roomId, "pagehide_beacon");
      try {
        navigator.sendBeacon("/api/rooms/leave", JSON.stringify({ roomId }));
      } catch {
        /* best effort — the webhook sweep catches what the beacon misses */
      }
    };
    window.addEventListener("pagehide", beacon);
    window.addEventListener("beforeunload", beacon);
    return () => {
      window.removeEventListener("pagehide", beacon);
      window.removeEventListener("beforeunload", beacon);
    };
  }, [roomId, broadcast]);

  /* ── Unclean exits ─────────────────────────────────────────
     A marker rides in sessionStorage while the call is up and is cleared
     by a deliberate leave. Safari reloads a page it had to kill (memory,
     a hung tab), so finding the marker on the next mount says the last
     visit ended without us — the closest thing to a crash report. */
  useEffect(() => {
    if (!call.connected) return;
    try { sessionStorage.setItem(`agora:live:${roomId}`, String(Date.now())); } catch { /* private mode */ }
  }, [call.connected, roomId]);
  useEffect(() => {
    let since: string | null = null;
    try { since = sessionStorage.getItem(`agora:live:${roomId}`); } catch { /* private mode */ }
    const lastAction = takeRoomAction(roomId);
    if (!since) return;
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    logRoomEvent(roomId, "reopened_after_unclean_exit", nav?.type ?? "unknown", {
      since: Number(since), agoMs: Date.now() - Number(since), lastAction,
    });
    try { sessionStorage.removeItem(`agora:live:${roomId}`); } catch { /* private mode */ }
  }, [roomId]);
  /* Every tap on a control is noted (its label), so an unclean exit can
     name what was pressed just before. On phones every tap — control or
     not — is also written to the telemetry at once (throttled), since a
     tab that dies on the next frame can't report afterwards. */
  useEffect(() => {
    const phone = window.matchMedia("(max-width: 639px)").matches;
    let lastTap = 0;
    const onDown = (e: PointerEvent) => {
      if (minimizedRef.current) return;
      const raw = e.target as HTMLElement | null;
      const t = raw?.closest("button, a, [role=button], input, textarea") as HTMLElement | null;
      const label = t
        ? t.getAttribute("aria-label") || t.getAttribute("title") || t.textContent?.trim().slice(0, 40) || t.tagName
        : raw ? `${raw.tagName.toLowerCase()}${raw.className && typeof raw.className === "string" ? "." + raw.className.split(" ")[0] : ""}` : "?";
      if (t) noteRoomAction(roomId, `${e.pointerType}:${label}`);
      if (phone && Date.now() - lastTap > 1500) {
        lastTap = Date.now();
        logRoomEvent(roomId, "tap", label, { x: Math.round(e.clientX), y: Math.round(e.clientY), control: !!t });
      }
    };
    document.addEventListener("pointerdown", onDown, { passive: true, capture: true });
    return () => document.removeEventListener("pointerdown", onDown, { capture: true } as EventListenerOptions);
  }, [roomId]);

  /* ── Coming back ────────────────────────────────────────────
     Phones freeze the page the moment the screen locks: heartbeats stop,
     the call's sockets drop, and by the time the person is back the
     LiveKit webhook (or the ghost sweep) has stamped their seat left —
     and, for a host, started the grace clock on the whole room. On
     return, and whenever the call reconnects after a drop: touch the
     seat, clear the host grace, take the seat back if it was stamped out
     while we were away, then refetch. A removal by the host from before
     we went away stands (the stamp predates the absence), and nothing
     runs after an intentional leave. */
  const hiddenAtRef = useRef<number | null>(null);
  const restoreSeat = useCallback(async () => {
    if (!currentUser || !room || room.status === "ended" || gated || broadcast || leavingRef.current) return;
    const awaySince = Math.max(hiddenAtRef.current ?? 0, call.lastDropAt ?? 0);
    if (!awaySince) return;
    try {
      const { data: mine } = await supabase
        .from("debate_participants")
        .select("id, left_at")
        .eq("room_id", roomId)
        .eq("user_id", currentUser.id)
        .maybeSingle();
      if (!mine?.left_at) return;
      if (new Date(mine.left_at).getTime() < awaySince - 60_000) {
        logRoomEvent(roomId, "seat_stale", "left before absence", { left_at: mine.left_at, awaySince });
        return;
      }
      logRoomEvent(roomId, "seat_restored", null, { left_at: mine.left_at, awaySince });
      await supabase
        .from("debate_participants")
        .update({ left_at: null, joined_at: new Date().toISOString() })
        .eq("id", mine.id);
    } catch {
      /* seating is cosmetic — the room still works unlisted */
    }
  }, [currentUser, room, gated, broadcast, roomId, supabase, call.lastDropAt]);
  const cameBack = useCallback(() => {
    if (!currentUser || !room || room.status === "ended" || broadcast || leavingRef.current) return;
    supabase.rpc("touch_seat", { p_room: roomId }).then(undefined, () => {});
    if (currentUser.id === room.host_id) {
      supabase.rpc("clear_host_left", { p_room: roomId }).then(undefined, () => {});
    }
    restoreSeat().finally(fetchAll);
  }, [currentUser, room, broadcast, roomId, supabase, restoreSeat, fetchAll]);
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAtRef.current = Date.now();
        logRoomEvent(roomId, "hidden");
      } else {
        logRoomEvent(roomId, "visible", null, { hiddenFor: hiddenAtRef.current ? Date.now() - hiddenAtRef.current : null });
        cameBack();
      }
    };
    window.addEventListener("pageshow", cameBack);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pageshow", cameBack);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [cameBack]);
  useEffect(() => {
    if (call.reconnects > 0) cameBack();
    // Only the reconnect edge should fire this, not every cameBack identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call.reconnects]);

  /* Host is back: cancel the grace timer. The participant_joined webhook
     normally clears host_left_at; this covers the race where the page
     loads before (or without) LiveKit reconnecting. Falls back to a
     direct update if the RPC isn't migrated yet. */
  useEffect(() => {
    if (!currentUser || !room?.host_left_at || room.host_id !== currentUser.id) return;
    supabase.rpc("clear_host_left", { p_room: roomId }).then(({ error }) => {
      if (error) {
        supabase
          .from("debate_rooms")
          .update({ host_left_at: null })
          .eq("id", roomId)
          .eq("host_id", currentUser.id)
          .then(undefined, () => {});
      }
    });
  }, [currentUser, room?.host_left_at, room?.host_id, roomId, supabase]);

  /* Ended rooms are replays, not dead ends. A visitor who arrives after
     the end goes straight to the replay; someone who was in the room when
     the host closed the stage gets a hand-off card instead (the VOD
     playlist finalizes a few seconds after egress stops). */
  const arrivedEnded = firstStatus === "ended";
  const [showReplay, setShowReplay] = useState(false);

  /* ── Raise / lower hand ────────────────────────────────────────────
     Signed-in listeners only. Landing in the Agora doesn't create a
     participant row, so the first raise seats you in the room (upsert,
     mirroring the classic room page's rejoin-safe flow). */
  const handRaised = !!myParticipation?.hand_raised_at;
  /* True while this viewer holds a raised-hand fast-lane WebRTC seat they
     hopped into from the HLS broadcast — lowering the hand gives it back. */
  const handFastLaneRef = useRef(false);
  const requestsLocked = !!room?.speaker_requests_locked;
  const canRaise = !!currentUser && room?.status === "live" && !isHostRole(myRole) && myRole !== "speaker";

  async function toggleHand() {
    if (!currentUser || !room || handBusy) return;
    setHandBusy(true);
    try {
      /* Server-stamped raise (Postgres now() is the one true clock, so the
         queue order is identical on every client). Falls back to the
         legacy client-side write if the RPC isn't migrated yet. */
      const { error } = await supabase.rpc("raise_hand", {
        p_room: roomId,
        p_raised: !handRaised,
      });
      if (error) {
        if (!/function|schema/i.test(error.message)) throw new Error(error.message);
        const ts = handRaised ? null : new Date().toISOString();
        if (myParticipation) {
          await supabase
            .from("debate_participants")
            .update({ hand_raised_at: ts })
            .eq("id", myParticipation.id);
        } else {
          const { data: existing } = await supabase
            .from("debate_participants")
            .select("id")
            .eq("room_id", roomId)
            .eq("user_id", currentUser.id)
            .maybeSingle();
          if (existing) {
            await supabase
              .from("debate_participants")
              .update({ role: "spectator", stance: null, left_at: null, joined_at: new Date().toISOString(), hand_raised_at: ts })
              .eq("id", existing.id);
          } else {
            await supabase
              .from("debate_participants")
              .insert({ room_id: roomId, user_id: currentUser.id, role: "spectator", stance: null, hand_raised_at: ts });
          }
        }
      }
      fetchAll();
      /* Fast-lane hop: raising while watching the ~10s-behind broadcast
         immediately re-asks the token API — near the front of the queue
         it now mints a real-time WebRTC seat, so a viewer who might be
         brought up is already at the live edge. Lowering re-asks too,
         which hands the seat back (the server answers HLS again). */
      if (!handRaised && call.hlsMode) {
        handFastLaneRef.current = true;
        retryConnect();
      } else if (handRaised && handFastLaneRef.current) {
        handFastLaneRef.current = false;
        retryConnect();
      }
    } catch (e) {
      console.error("raise hand failed", e);
    } finally {
      setHandBusy(false);
    }
  }

  /* ── Invite responses ── */
  async function respondToInvite(accept: boolean) {
    if (!invite || !currentUser) return;
    setInviteBusy(true);
    try {
      await supabase
        .from("stage_invites")
        .update({ status: accept ? "accepted" : "declined", responded_at: new Date().toISOString() })
        .eq("id", invite.id);
      if (accept) {
        if (myParticipation) {
          await supabase
            .from("debate_participants")
            .update({ stage_role: "speaker", hand_raised_at: null })
            .eq("id", myParticipation.id);
        } else {
          await supabase
            .from("debate_participants")
            .insert({ room_id: roomId, user_id: currentUser.id, role: "spectator", stance: null, stage_role: "speaker" });
        }
        fetchAll();
      }
      setInvite(null);
    } catch (e) {
      console.error("invite response failed", e);
      setInvite(null);
    } finally {
      setInviteBusy(false);
    }
  }

  /* A prompt is up above the controls, or a menu is open from them:
     the browser's-mute prompt waits its turn behind either. */
  const promptUp = (leavePrompt && room?.status !== "ended") || (noteOpen && !!room) || !!invite;
  const menuUp = moreOpen || topMenuOpen || micMenuOpen || camMenuOpen || reactOpen;

  const topic = TOPICS.find((t) => t.key === room?.topic_key);
  /* Who is listening now: everyone in the room who isn't on the stage or
     at the mic — a raised hand is still listening. (viewer_count is
     everyone who has been in the room while it was live, the host and the
     speakers among them, so on its own a host read as their own audience;
     it still sizes the amphitheatre's crowd.) */
  const audienceCount = room
    ? participants.filter((p) => !p.left_at && deriveStageRole(p, room) === "audience" && p.user_id !== room.mic_user_id).length
    : 0;

  /* ── Minimized: the call carries on while you browse ─────────────
     Another page showing (CallSlot keeps this room mounted through
     in-app navigation): the room shrinks into the corner and plays on
     there, in the window of a card (MiniCall) that carries its title,
     who is talking, your mic and Leave. Only a call is carried — a room
     with no call up (a gate, a replay, one you never got into) just goes
     quiet.

     The room itself stays built and live the whole time, so opening the
     card again is only an animation: the room grows back out of the
     card's window exactly as it went in, with nothing to rebuild — no
     scene to set up, no pictures to re-attach. `phase` is where it
     stands: "full" (the page), "shrinking" into the corner, "mini" (in
     the card), "growing" back out of it. */
  const callLive = !broadcast && !!room && !(arrivedEnded || showReplay) && (call.connected || hlsAudience);
  const [wasInCall, setWasInCall] = useState(false);
  if (callLive && !wasInCall) setWasInCall(true);
  const endedWhileAway = wasInCall && room?.status === "ended";
  const [phase, setPhase] = useState<"full" | "shrinking" | "mini" | "growing">(slot.minimized ? "mini" : "full");
  const [seenPath, setSeenPath] = useState(slot.path);
  /* The phase this render settles on (a change of address can move it). */
  let nextPhase = phase;
  if (seenPath !== slot.path) {
    setSeenPath(slot.path);
    if (slot.minimized) {
      /* Away from the room — or, mid-way back in, somewhere else after all. */
      if (phase === "full" || phase === "growing") nextPhase = callLive ? "shrinking" : "mini";
    } else if (phase === "mini") {
      /* Back to the room without the card (the browser's Forward): over
         the page it was minimized from, still there underneath, it grows
         back as from the card; where that page has gone (a history entry
         from before), the room is simply there. */
      nextPhase = slot.overPage && callLive ? "growing" : "full";
    } else if (phase === "shrinking") {
      nextPhase = "full";
    }
    if (nextPhase !== phase) setPhase(nextPhase);
  }
  /* The page underneath is held (see below) from the moment the room
     covers it until the room has folded away into its card — not just
     while the address is the room's: the browser redraws the whole
     screen's layers when the page's scrolling is locked or let go, and
     the stage's picture drops out until the scene next draws, so that
     happens only while the room is out of sight, under the card or not
     yet grown. */
  const covering = slot.overPage && !slot.minimized && callLive;
  const [holding, setHolding] = useState(false);
  if (covering && !holding) setHolding(true);
  if (holding && !covering && nextPhase !== "shrinking") setHolding(false);
  const frameRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  /* Back as a page of its own (below), the address changes once the room
     has grown to fill the screen, so the page you were on stays under it
     the whole way. */
  const expandWhenGrown = useRef<(() => void) | null>(null);
  /* Where the minimized room sits (pipWindow, pipCrop): worked out as it
     starts for the corner, with the room still whole, and again when the
     screen changes size while it is there — always on the room as laid
     out, not as it happens to be drawn. */
  const pipRef = useRef<Pip | null>(null);
  const measurePip = useCallback((el: HTMLElement): Pip => {
    const vw = window.innerWidth, vh = window.innerHeight;
    const win = pipWindow(vw, vh);
    const drawn = el.style.transform;
    el.style.transform = "";
    const crop = pipCrop(el, win, vw, vh);
    el.style.transform = drawn;
    const pip = { win, crop, radii: isPhoneViewport() ? [16, 0, 0, 16] : [16, 16, 0, 0], vw, vh };
    pipRef.current = pip;
    return pip;
  }, []);
  /* Started before the frame is painted (a layout effect), so the room
     is never seen for a frame at the wrong size. */
  useLayoutEffect(() => {
    if (phase !== "shrinking" && phase !== "growing") return;
    /* Once only, and never after this move has been superseded: a finish
       event already queued when the move is cancelled still arrives. */
    let over = false;
    const land = () => {
      if (over) return;
      over = true;
      setPhase(phase === "shrinking" ? "mini" : "full");
      const expand = phase === "growing" ? expandWhenGrown.current : null;
      expandWhenGrown.current = null;
      expand?.();
    };
    const el = frameRef.current;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    /* A grow cut short (somewhere else after all) takes its address
       change with it. */
    const drop = () => {
      over = true;
      if (phase === "growing") expandWhenGrown.current = null;
    };
    if (!el || still) {
      const t = window.setTimeout(land, 0);
      return () => {
        drop();
        window.clearTimeout(t);
      };
    }
    const going = phase === "shrinking";
    /* Going, from the room as it stands; coming back, from where it sat. */
    const pip = going || !pipRef.current ? measurePip(el) : pipRef.current;
    const ms = going ? 460 : 420;
    const STEPS = 32;
    const ps = Array.from({ length: STEPS + 1 }, (_, i) => {
      const v = FOLD_EASE(i / STEPS);
      return going ? v : 1 - v;
    });
    const frames = ps.map((p, i) => ({ offset: i / STEPS, ...pipFrame(pip, p) }));
    const timing: KeyframeAnimationOptions = { duration: ms, easing: "linear", fill: "forwards" };
    /* The move (a transform) and the window (a clip path), each its own
       animation: the browser runs both off the main thread, so neither
       waits on the page arriving underneath. */
    const move = el.animate(frames.map(({ offset, transform }) => ({ offset, transform })), timing);
    const clip = el.animate(frames.map(({ offset, clipPath }) => ({ offset, clipPath })), timing);
    /* The room's own buttons over the stage (the view switch, the notices
       column) go early on the way in — the window shows the stage, not
       buttons that can't be pressed there — and come back late on the
       way out. Hidden in between (agora.css). */
    const extras = [...el.querySelectorAll<HTMLElement>(".ag-switch-view, .ag-notices")].map((x) =>
      x.animate(
        going
          ? [{ opacity: 1 }, { opacity: 0, offset: 0.3 }, { opacity: 0 }]
          : [{ opacity: 0 }, { opacity: 0, offset: 0.55 }, { opacity: 1 }],
        timing
      )
    );
    /* The card comes up around the room as it lands — its frame, its
       words — and goes at once as the room grows back out of it. */
    const cardFade = document.querySelector<HTMLElement>(".call-mini")?.animate(
      going
        ? [{ opacity: 0 }, { opacity: 0, offset: 0.45 }, { opacity: 1, offset: 0.85 }, { opacity: 1 }]
        : [{ opacity: 1 }, { opacity: 0, offset: 0.12 }, { opacity: 0 }],
      { duration: ms, easing: "linear", fill: "both" }
    );
    /* The page behind: dimmed while the room is large, lit as it goes. */
    const dim = scrimRef.current?.animate(
      ps.map((p, i) => ({ offset: i / STEPS, opacity: 0.4 * (1 - clampTo(p, 0, 1)) })),
      timing
    );
    /* A hidden tab pauses animations; the move must still land. */
    const late = window.setTimeout(land, ms + 500);
    move.onfinish = () => {
      window.clearTimeout(late);
      land();
    };
    return () => {
      drop();
      window.clearTimeout(late);
      move.cancel();
      clip.cancel();
      extras.forEach((a) => a.cancel());
      cardFade?.cancel();
      dim?.cancel();
    };
  }, [phase, measurePip]);
  /* Minimized: the room stays in the card's window, drawn and live (the
     move's last frame, held), and is put back in it whenever the screen
     changes size. */
  useLayoutEffect(() => {
    if (phase !== "mini") return;
    const el = frameRef.current;
    if (!el) return;
    const put = (pip: Pip) => {
      const f = pipFrame(pip, 1);
      el.style.transform = f.transform;
      el.style.clipPath = f.clipPath;
    };
    /* Where the move left it — unless the screen changed size on the way,
       or the card moved (the page that arrived under it brought a
       scrollbar). */
    const last = pipRef.current;
    const now = pipWindow(window.innerWidth, window.innerHeight);
    const same =
      !!last && last.vw === window.innerWidth && last.vh === window.innerHeight &&
      Math.abs(last.win.x - now.x) < 0.5 && Math.abs(last.win.y - now.y) < 0.5 &&
      Math.abs(last.win.w - now.w) < 0.5 && Math.abs(last.win.h - now.h) < 0.5;
    put(same ? last : measurePip(el));
    const onResize = () => put(measurePip(el));
    window.addEventListener("resize", onResize);
    /* And when the page's width changes under a window that didn't (a
       scrollbar coming back as the page underneath is let go): the card
       moves with the page, the room with the card. */
    let pageW = document.documentElement.clientWidth;
    const page = new ResizeObserver(() => {
      const w = document.documentElement.clientWidth;
      if (w === pageW) return;
      pageW = w;
      put(measurePip(el));
    });
    page.observe(document.documentElement);
    return () => {
      window.removeEventListener("resize", onResize);
      page.disconnect();
      el.style.transform = "";
      el.style.clipPath = "";
    };
  }, [phase, measurePip]);
  /* Minimize: the room starts for the corner at the click. The page it
     gives way to is already underneath if the room came back over it
     (history takes you there, nothing to load); otherwise it comes from
     the server and arrives underneath when it can — waiting for it first
     was the pause between the click and anything moving. */
  const minimizeNow = () => {
    if (phase === "full" && callLive) {
      setPhase("shrinking");
      if (!slot.overPage) fadeInArrivingPage();
    }
    slot.minimize();
  };
  /* Out of the card: the room is already built, so going back in is the
     room growing out of the card. Where it fits the screen (a phone, a
     desktop) it comes back over the page you were on, which stays
     mounted underneath — the address changes with it (CallSlot), nothing
     is torn down, and minimizing again is instant. Where it is taller
     than the screen (a tablet's stacked layout, which scrolls the whole
     page) it takes that page's place again, as a page of its own. */
  const openFromCard = () => {
    if (phase !== "mini") return;
    const root = frameRef.current?.querySelector(".ag-root");
    const fits = !root || root.scrollHeight <= window.innerHeight + 1;
    if (fits) slot.expand(true);
    else if (slot.minimized) expandWhenGrown.current = () => slot.expand(false);
    else slot.expand(false);
    setPhase("growing");
  };
  /* Over the page it was minimized from (back from the card), the room
     lies on top of that page rather than replacing it: the page is kept
     out of reach underneath — no focus, no screen reader — until the
     room gives way to it again. */
  useLayoutEffect(() => {
    if (!holding) return;
    const page = document.getElementById("agora-page");
    page?.setAttribute("inert", "");
    /* Held still too: no scrolling reaches it, and nothing moves it —
       it is exactly where it was when the room gives way to it again
       (see takeCoverScroll). Where scrollbars take up room (Windows),
       the one taken away is made up in padding, so nothing shifts. */
    const html = document.documentElement;
    const bar = window.innerWidth - html.clientWidth;
    html.classList.add("agora-covered");
    if (bar > 0) document.body.style.paddingRight = `${bar}px`;
    const y = takeCoverScroll() ?? window.scrollY;
    const hold = () => {
      if (Math.abs(window.scrollY - y) > 0.5) window.scrollTo({ top: y, behavior: "instant" });
    };
    hold();
    window.addEventListener("scroll", hold, { passive: true });
    return () => {
      window.removeEventListener("scroll", hold);
      page?.removeAttribute("inert");
      html.classList.remove("agora-covered");
      document.body.style.paddingRight = "";
    };
  }, [holding]);

  /* This room, opened again while you are in it — its card or a link to
     it on the page you are browsing: back into it from its card, as the
     card's own window does. Loading it would hang this call up and join
     the room all over again. Already up, there is nothing to do. */
  const openAgain = useEffectEvent((url: string) => {
    if (!pointsToRoom(url, roomId, window.location.href)) return false;
    if (phase === "mini") openFromCard();
    return true;
  });
  /* While a call is live, pages change in the app — a full page load
     would hang the call up. Next's own links already navigate in place;
     plain links are routed here (lib/softNav.ts), and code that means to
     change page asks through window.__agoraSoftNav (goTo). A way into
     this room (a card's enterRoom, any link to it) asks
     window.__agoraOpenCall first; links to it are caught before anything
     else sees the click, Next's own included. */
  useEffect(() => {
    if (!callLive) return;
    const soft = (url: string) => {
      router.push(url);
      return true;
    };
    const again = (url: string) => openAgain(url);
    window.__agoraSoftNav = soft;
    window.__agoraOpenCall = again;
    const onClickFirst = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      const url = a ? plainLinkUrl(a, e, window.location) : null;
      if (url && openAgain(url.href)) e.preventDefault();
    };
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      const to = a ? softNavTarget(a, e, window.location) : null;
      if (!to) return;
      e.preventDefault();
      router.push(to);
    };
    document.addEventListener("click", onClickFirst, true);
    document.addEventListener("click", onClick);
    return () => {
      if (window.__agoraSoftNav === soft) delete window.__agoraSoftNav;
      if (window.__agoraOpenCall === again) delete window.__agoraOpenCall;
      document.removeEventListener("click", onClickFirst, true);
      document.removeEventListener("click", onClick);
    };
  }, [callLive, router]);

  /* The card: up while you browse (coming up under the room as it
     shrinks), and fading under it as the room grows back out. */
  const showCard = !!room && (callLive || endedWhileAway) && phase !== "full";
  const speakingNow = showCard ? [...stageStrip, ...proSpeakers, ...conSpeakers].find((p) => p.speaking) ?? null : null;
  const miniCard = showCard && room ? (
    <MiniCall
      arriving={phase === "shrinking"}
      leaving={phase === "growing"}
      motion={room.motion}
      ended={endedWhileAway}
      speaker={speakingNow ? { id: speakingNow.id, username: speakingNow.username, name: speakingNow.name, avatarUrl: speakingNow.avatarUrl } : null}
      hostName={hostUser ? displayName(hostUser) : null}
      onStage={onStage(myRole)}
      micOn={call.micOn}
      micReady={call.connected && !call.mediaBusy}
      onToggleMic={call.toggleMic}
      audioBlocked={call.audioBlocked || (hlsAudience && !broadcastSound)}
      onEnableAudio={hlsAudience ? turnSoundOn : call.enableAudio}
      screen={callLive}
      onLeave={() => {
        if (endedWhileAway) {
          vacateSeat();
          slot.end();
        } else if (isHostRole(myRole) && !duel) {
          /* A host leaving is a choice — end it for everyone, or step
             away — and that choice lives in the room. */
          setLeavePrompt(true);
          openFromCard();
        } else {
          vacateSeat();
          slot.end();
        }
      }}
      onExpand={openFromCard}
    />
  ) : null;
  /* No call to keep drawn (it ended while you were away, or never came
     up): just the card, or nothing. */
  if (slot.minimized && !callLive) return miniCard;

  if (deniedGate) {
    const who = deniedGate.host ? `@${deniedGate.host}` : "the host";
    const submitGateCode = async () => {
      const code = gateCode.trim().toUpperCase();
      if (!code || gateCodeBusy) return;
      setGateCodeBusy(true);
      setGateCodeErr(null);
      const { data, error } = await supabase.rpc("join_private_room", {
        p_code: code,
        p_role: "spectator",
      });
      setGateCodeBusy(false);
      if (error) {
        const msg = error.message || "";
        setGateCodeErr(
          msg.includes("invalid_or_expired") ? "That code doesn't match a live room."
          : msg.includes("banned_from_room") ? "You've been removed from this room."
          : "Couldn't join with that code — try again.");
        return;
      }
      const row = Array.isArray(data) ? data[0] : data;
      const joined: string | undefined = row?.room_id;
      if (!joined) {
        setGateCodeErr("That code doesn't match a live room.");
        return;
      }
      if (joined === roomId) {
        /* Seated — the room row is readable now; walk in. */
        setDeniedGate(null);
        setRoomUnreadable(false);
        fetchAll();
      } else {
        router.push(`/agora/${joined}`);
      }
    };
    return (
      <div
        className="ag-root ag-loading"
        style={{ textAlign: "center", padding: "0 24px", flexDirection: "column", gap: 0, alignItems: "center", justifyContent: "center" }}
      >
        <p className="m-0 text-[11px]" style={{ color: "#c9a6f0", fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, letterSpacing: "0.08em" }}>
          PRIVATE ROOM
        </p>
        <h1 className="m-0 mt-2 text-[22px]" style={{ color: "#f5f5f0", fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, maxWidth: 640 }}>
          {deniedGate.motion}
        </h1>
        <p className="m-0 mt-3 text-[13px]" style={{ color: "#c0c0c8", maxWidth: 480, lineHeight: 1.6 }}>
          {deniedGate.mode === "friends"
            ? `This room is open to ${who}'s friends only.`
            : deniedGate.mode === "followers"
              ? `This room is open to people who follow ${who}.`
              : deniedGate.mode === "community"
                ? `This room is for members of ${deniedGate.communityName ?? "its community"} — join the community to enter.`
                : "This room is invite-only — enter the code to join."}
          {!currentUser && " Sign in if that's you."}
        </p>
        {currentUser ? (
          <div className="mt-5 flex flex-col items-center" style={{ gap: 8 }}>
            <span className="text-[12px]" style={{ color: "#8b8b94" }}>
              Have an invite code?
            </span>
            <div className="flex items-center" style={{ gap: 8 }}>
              <input
                value={gateCode}
                onChange={(e) => { setGateCode(e.target.value); setGateCodeErr(null); }}
                onKeyDown={(e) => { if (e.key === "Enter") submitGateCode(); }}
                placeholder="ABC123"
                maxLength={6}
                autoCapitalize="characters"
                spellCheck={false}
                className="outline-none text-center uppercase"
                style={{
                  width: 130,
                  padding: "9px 10px",
                  background: "#0e0e11",
                  border: `1px solid ${gateCodeErr ? "#e0655a" : "#2a2a33"}`,
                  borderRadius: 10,
                  color: "#f5f5f0",
                  fontFamily: "'DM Mono', monospace",
                  fontSize: 15,
                  letterSpacing: "0.18em",
                }}
              />
              <button
                onClick={submitGateCode}
                disabled={gateCodeBusy || gateCode.trim().length < 6}
                className="cursor-pointer disabled:opacity-50 disabled:cursor-default"
                style={{
                  background: "#d9a238",
                  border: "none",
                  color: "#2b1a02",
                  fontFamily: "'DM Sans', sans-serif",
                  fontSize: 13,
                  fontWeight: 600,
                  padding: "9px 18px",
                  borderRadius: 100,
                }}
              >
                {gateCodeBusy ? "Joining…" : "Enter"}
              </button>
            </div>
            {gateCodeErr && (
              <span className="text-[12px]" style={{ color: "#fca5a5" }}>{gateCodeErr}</span>
            )}
          </div>
        ) : (
          <p className="m-0 mt-1.5 text-[12px]" style={{ color: "#8b8b94" }}>
            Have an invite code? Sign in to use it.
          </p>
        )}
        <button
          onClick={() => slot.leave("/")}
          className="mt-5 cursor-pointer"
          style={{
            background: "#2f7fe0",
            border: "none",
            color: "#fff",
            fontFamily: "'DM Sans', sans-serif",
            fontSize: "13px",
            fontWeight: 600,
            padding: "9px 22px",
            borderRadius: "100px",
          }}
        >
          Back to the Agora
        </button>
      </div>
    );
  }

  if (!loaded || !room) return <RoomWait />;

  if ((arrivedEnded || showReplay) && !broadcast) {
    // Ended rooms get the shared chrome (navbar + sidebar) like the
    // /replays route; the live amphitheater below stays chrome-free.
    return (
      <SiteChrome>
        <div className="replay-beside-sidebar">
          <DebateReplay roomId={roomId} initialRoom={room} />
        </div>
      </SiteChrome>
    );
  }

  if (gated && opensAtMs !== null) {
    const start = room.scheduled_start ? new Date(room.scheduled_start) : null;
    const opens = new Date(opensAtMs);
    const minsLeft = Math.max(1, Math.ceil((opensAtMs - nowTs) / 60000));
    const countdown =
      minsLeft >= 1440
        ? `${Math.floor(minsLeft / 1440)}d ${Math.floor((minsLeft % 1440) / 60)}h`
        : minsLeft >= 60
          ? `${Math.floor(minsLeft / 60)}h ${minsLeft % 60}m`
          : `${minsLeft}m`;
    return (
      <div
        className="ag-root ag-loading"
        style={{ textAlign: "center", padding: "0 24px", flexDirection: "column", gap: 0, alignItems: "center", justifyContent: "center" }}
      >
        <p className="m-0 text-[11px]" style={{ color: "#c9a6f0", fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, letterSpacing: "0.08em" }}>
          SCHEDULED DISCUSSION
        </p>
        <h1 className="m-0 mt-2 text-[22px]" style={{ color: "#f5f5f0", fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, maxWidth: 640 }}>
          {room.motion}
        </h1>
        {start && (
          <p className="m-0 mt-3 text-[13px]" style={{ color: "#c0c0c8" }}>
            Starts {start.toLocaleDateString([], { month: "short", day: "numeric" })} at{" "}
            {start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
          </p>
        )}
        <p className="m-0 mt-1.5 text-[12px]" style={{ color: "#8b8b94" }}>
          Doors open 30 minutes before start — come back at{" "}
          {opens.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} (in {countdown}).
        </p>
        <button
          onClick={() => slot.leave("/")}
          className="cursor-pointer text-[12px] px-4 py-2 rounded-lg mt-5"
          style={{ background: "#0e0e11", border: "1px solid #2a2a33", color: "#e7e9ee", fontFamily: "inherit" }}
        >
          ← Back to home
        </button>
      </div>
    );
  }

  const raiseTitle = !currentUser
    ? "Sign in to raise your hand"
    : requestsLocked
      ? "Speaker requests are locked"
      : handRaised
        ? "Lower your hand"
        : "Raise your hand to request to speak";

  /* Layout switcher: rendered in the control row on desktop and inside
     the More drawer on phones (agora.css shows one or the other). */
  const layoutSwitch = (
    <div className="ag-layout-switch" role="group" aria-label="Call layout">
      {(
        [
          { id: "stage", icon: "person-standing", label: "Stage view" },
          { id: "gallery", icon: "layout-grid", label: "Gallery view" },
          { id: "multi", icon: "users", label: "Multi-speaker view" },
        ] as const
      ).filter((opt) => !(phone && opt.id === "stage")).map((opt) => (
        <button
          key={opt.id}
          className={`ag-layout-seg${layout === opt.id ? " is-active" : ""}`}
          title={`${opt.label} (g cycles)`}
          aria-label={opt.label}
          aria-pressed={layout === opt.id}
          onClick={() => pickLayout(opt.id)}
        >
          <Icon name={opt.icon} size={17} />
        </button>
      ))}
    </div>
  );

  /* The frame: no box of its own while the room is the page; fixed over
     the page while it moves, and over it (in use) once it has come back
     over the page it was minimized from; in the card's window, minimized.
     Out of reach whenever it isn't the page: the card takes the clicks. */
  const frameState =
    phase === "mini"
      ? " is-pip"
      : phase !== "full"
        ? " is-moving"
        : slot.minimized || slot.overPage
          ? " is-over"
          : "";
  return (
    <>
    {(phase === "shrinking" || phase === "growing") && <div ref={scrimRef} className="ag-call-scrim" aria-hidden="true" />}
    <div ref={frameRef} className={`ag-call-frame${frameState}`} inert={phase !== "full"}>
    <div className={`ag-root${railCollapsed ? " rail-collapsed" : ""}${chatOpen ? " ag-chat-open" : ""}${broadcast ? " ag-root--recording" : ""}${ownStream ? " ag-root--own" : ""}`}>
      {entering !== "gone" && (
        <div className={`ld-page-wait${entering === "leaving" ? " is-leaving" : ""}`}>
          <LoadingScreen plain label="Entering the Agora" />
        </div>
      )}
      <div className="ag-main">
        {/* ── Top bar ── */}
        {(broadcast || duel) && (
          <style>{`.ag-switch-view { display: none !important; }`}</style>
        )}
        {broadcast && (
          <div
            style={{
              position: "absolute",
              bottom: 14,
              right: 16,
              zIndex: 60,
              fontFamily: "'Space Grotesk', sans-serif",
              fontWeight: 700,
              fontSize: ownStream ? "max(15px, 2vmin)" : 15,
              color: "rgba(255,255,255,0.85)",
              textShadow: "0 1px 8px rgba(0,0,0,0.8)",
              pointerEvents: "none",
            }}
          >
            Agora<span style={{ color: "#3b6cf6" }}>Sphere</span> · agorasphere.net
          </div>
        )}
        {!broadcast && (
        <header className="ag-topbar">
          <div className="ag-topbar-info">
            <div className="ag-live-tag">
              <span className={`ag-live-dot ${room.status === "live" ? "" : "idle"}`} />
              {room.status === "live" ? "LIVE DISCUSSION" : room.status === "created" ? "STARTING SOON" : "DISCUSSION"}
            </div>
            <h1 className="ag-motion">{room.motion}</h1>
            <div className="ag-topbar-meta">
              <span title="Elapsed"><Icon name="clock" size={13} /> {elapsed} elapsed</span>
              <span title="Audience"><Icon name="users" size={13} /> {audienceCount.toLocaleString("en-US")} in audience</span>
              {topic && (
                <span title="Topic">
                  {topic.emoji} {topic.label}
                </span>
              )}
              {communityName && (
                <span title="Hosted by this community" style={{ color: "#c9b06a" }}>
                  <Icon name="landmark" size={13} /> {communityName}
                </span>
              )}
            </div>
          </div>
          <div className="ag-topbar-actions">
            <button
              type="button"
              className="ag-more ag-minimize"
              onClick={minimizeNow}
              title="Minimize — keep listening while you browse"
              aria-label="Minimize the call and keep listening while you browse"
            >
              <Icon name="chevron-down" size={18} />
            </button>
            {hostUser?.username && (
              <a
                className="ag-host-chip"
                href={userPath(hostUser.username)}
                title="The host's profile"
              >
                <UserAvatar size={24} username={hostUser.username} avatarUrl={hostUser.avatar_url ?? null} seed={room.host_id} />
                <span>{displayName(hostUser)}</span>
              </a>
            )}
            {!isHostViewer && (
              <button
                className={`ag-follow ${following ? "on" : ""}`}
                onClick={toggleFollow}
                disabled={followBusy}
              >
                {following ? "Following ✓" : "Follow"}
              </button>
            )}
            <RoomFrame
              room={room}
              participants={participants}
              myRole={myRole}
              currentUserId={currentUser?.id ?? null}
              supabase={supabase}
              onChange={(framing) => setRoom((r) => (r ? { ...r, framing } : r))}
            />
            <div className="ag-react-wrap" ref={topMenuRef}>
              {topMenuOpen && (
                <div className="ag-more-menu ag-more-menu--down" role="menu" aria-label="Room options">
                  <button
                    className="ag-cam-item"
                    role="menuitem"
                    onClick={() => {
                      setTopMenuOpen(false);
                      if (!room) return;
                      const host = participants.find((pp) => pp.user_id === room.host_id);
                      setReportTarget({
                        userId: room.host_id,
                        username: host?.user?.username ?? "host",
                        context: "room",
                        roomId,
                      });
                    }}
                  >
                    <span className="ag-cam-ico" aria-hidden><Icon name="flag" size={15} /></span>
                    <span className="ag-cam-name">Report stream</span>
                  </button>
                  <button
                    className="ag-cam-item"
                    role="menuitem"
                    onClick={() => {
                      setTopMenuOpen(false);
                      if (!room) return;
                      const host = participants.find((pp) => pp.user_id === room.host_id);
                      setReportTarget({
                        userId: room.host_id,
                        username: host?.user?.username ?? "host",
                        context: "room",
                        roomId,
                      });
                    }}
                  >
                    <span className="ag-cam-ico" aria-hidden><Icon name="alert-triangle" size={15} /></span>
                    <span className="ag-cam-name">Report something else</span>
                  </button>
                  <button
                    className="ag-cam-item"
                    role="menuitem"
                    onClick={() => {
                      setTopMenuOpen(false);
                      setNoteText("");
                      setNoteDone(false);
                      setNoteOpen(true);
                    }}
                  >
                    <span className="ag-cam-ico" aria-hidden><Icon name="text-quote" size={15} /></span>
                    <span className="ag-cam-name">Request a community note</span>
                  </button>
                </div>
              )}
              <button
                className="ag-more"
                title="Room options"
                aria-haspopup="menu"
                aria-expanded={topMenuOpen}
                onClick={() => setTopMenuOpen((v) => !v)}
              >
                ⋯
              </button>
            </div>
          </div>
        </header>
        )}

        {/* A browser drawing without its graphics card: say so, and how to
            fix it — the room has already fallen back to the simple stage.
            Never in the recording: the recorder has no graphics card. */}
        {!broadcast && <GpuNotice />}

        {/* ── Amphitheater ── */}
        {/* The recorder films this page in a browser on LiveKit's machines,
            with no graphics card: the 3D scene drawn in software ran them
            out of CPU ~20 s into every camera room (the replay kept only
            those seconds). Recordings get the flat backdrop instead, with
            a still of the stage on it (agora.css). */}
        <Amphitheater
          moving={phase === "shrinking" || phase === "growing" || railSliding}
          performanceMode={broadcast}
          flat={phone || broadcast || simpleStage.on}
          background={layout !== "stage" || phase === "mini"}
          roomId={roomId}
          /* Flat layouts (gallery / multi) carry every picture themselves —
             the scene's 3D speaker panels and mic medallion would peek
             around the tile band as duplicate mini-cards, so they clear
             the stage while a flat layout is up. */
          proSpeakers={view === "speaker" && layout !== "stage" ? [] : proSpeakers}
          conSpeakers={view === "speaker" && layout !== "stage" ? [] : conSpeakers}
          stageStrip={view === "speaker" && layout !== "stage" ? [] : paneStrip}
          audience={audience}
          viewerCount={room.viewer_count ?? 0}
          view={view}
          onSwitchView={() => setView((v) => (v === "audience" ? "speaker" : "audience"))}
          onViewSettled={() => setViewSettled(true)}
          speakerQueue={speakerQueue}
          micHolder={view === "speaker" && layout !== "stage" ? null : micHolder}
          micLive={!!(room.mic_user_id && call.speakingIds.has(room.mic_user_id))}
        />

        {/* ── Host controls (hosts and co-hosts only) ── */}
        {/* Duels have no host: the "host" seat is just whoever waited
            longer — nobody gets power over their opponent. */}
        {currentUser && isHostRole(myRole) && !duel && (
          <HostControls
            room={room}
            participants={participants}
            currentUser={currentUser}
            myRole={myRole}
            onChanged={fetchAll}
          />
        )}

        {/* ── Stage closed: everyone gets walked out ── */}
        {room?.status === "ended" && !broadcast && (
          <div className="ag-ended-card" role="dialog" aria-label="Discussion ended">
            <h2>Discussion ended</h2>
            <p>
              The host closed the stage.
              {room.recording_url
                ? " The recording will be available shortly — it finalizes a few seconds after the stream stops."
                : " The transcript and discussion are open now."}
            </p>
            <div className="ag-ended-actions">
              <button
                className="ag-invite-join"
                onClick={() => {
                  vacateSeat();
                  window.history.replaceState(null, "", roomPath({ id: room.id, motion: room.motion }));
                  setShowReplay(true);
                }}
              >
                {room.recording_url ? "Watch the discussion" : "Transcript & discussion"}
              </button>
              <button
                className="ag-invite-decline"
                onClick={() => {
                  vacateSeat();
                  slot.leave("/");
                }}
              >
                Back to home
              </button>
            </div>
          </div>
        )}

        <ReportModal target={reportTarget} onClose={() => setReportTarget(null)} />

        {/* ── The stage: debater boxes, and the share when one is live.
              In speaker view it waits for the camera to land among the
              stars before fading in; audience view shows it as soon as a
              picture is live (no glide to wait out). ── */}
        {/* Camera surfaces exist in settled speaker view only — audience
              view keeps the open amphitheater, pictures riding the dock. */}
        {view === "speaker" && viewSettled && (
          hlsAudience ? (
            /* HLS audience mode: the broadcast IS the stage — one feed,
               same slot and lifecycle as AgoraStage. */
            <div className="ag-cast" role="region" aria-label="Broadcast view">
              <HlsBroadcastSurface src={call.hlsMode!.url} />
            </div>
          ) : layout === "stage" ? (
            <AgoraStage
              tiles={call.videoTiles}
              panes={stagePanes}
              view={view}
              speaking={call.speakingIds}
            />
          ) : (
            /* Gallery / multi-speaker take the stage's exact spot and
               lifecycle: same glide-in wait in speaker view, same anchored
               placement in audience view, vantage toggle untouched. */
            <div
              className={`ag-cast ag-layout-flat${tallCameras ? " ag-cast--tall" : ""}`}
              role="region"
              aria-label="Call layout"
            >
              {layout === "gallery" ? (
                <CallGallery
                  tiles={layoutTiles}
                  speaking={call.speakingIds}
                  pinnedKey={layoutPin}
                  gap={broadcast && !ownStream ? 0 : undefined}
                  fill={ownStream || tallCameras}
                  /* Never while our recorder films: the clip maker reads
                     its windows. A host's own stream always has them. */
                  smallFaces={ownStream || (callView.smallFaces && !broadcast)}
                  facesAtTopWhenTall={ownStream}
                  onKeepInView={setLayoutPin}
                  onPin={(key) => {
                    /* Duels stay in the two-pane gallery — EXCEPT a
                       screen share, which pins near-fullscreen. */
                    if (duel && !key.endsWith(":screen")) return;
                    setLayoutPin(key);
                    pickLayout("multi");
                  }}
                />
              ) : (
                <CallMultiSpeaker
                  tiles={layoutTiles}
                  speaking={call.speakingIds}
                  pinnedKey={layoutPin}
                  onPin={setLayoutPin}
                />
              )}
            </div>
          )
        )}

        {/* ── Live camera tiles + floating reactions ── */}
        {hlsAudience && view === "audience" && (
          /* Audience vantage in HLS mode: the broadcast rides where the
             video dock sits — small, corner, the amphitheater stays the
             show. */
          <div
            style={{
              position: "absolute",
              right: 16,
              bottom: 96,
              width: 300,
              aspectRatio: "16 / 9",
              zIndex: 18,
            }}
          >
            <HlsBroadcastSurface src={call.hlsMode!.url} compact />
          </div>
        )}
        {!hlsAudience && (layout === "stage" || view === "audience") && (
          <AgoraVideoDock tiles={dockTiles} />
        )}
        <ReactionOverlay reactions={call.reactions} />

        {/* ── Above the controls, one column: a prompt (closing the stage,
              a community note, an invitation to the stage, the browser's
              mute), a mic or camera failure, and your place in the queue
              on top — stacked, so none of them can cover another. ── */}
        <div className={`ag-notices${phase === "shrinking" || phase === "growing" ? " is-folding" : ""}`}>
          {/* ── Host leave prompt: the stage lives and dies with its host —
                leaving always closes the room, so this is just a confirm. ── */}
          {leavePrompt && room?.status !== "ended" && (
            <div className="ag-invite" role="dialog" aria-label="Close stage confirmation">
              <span className="ag-invite-text">
                You&apos;re the <strong>host</strong> — leaving closes the stage for everyone. Close it?
              </span>
              <div className="ag-invite-actions">
                <button
                  className="ag-invite-decline"
                  disabled={closingStage}
                  onClick={() => setLeavePrompt(false)}
                >
                  Stay
                </button>
                <button
                  className="ag-invite-danger"
                  disabled={closingStage}
                  onClick={async () => {
                    setClosingStage(true);
                    await supabase
                      .from("debate_rooms")
                      .update({ status: "ended", ended_at: new Date().toISOString() })
                      .eq("id", roomId);
                    /* Stop whatever is still filming with the stage — an egress
                       left running films a black page and bills LiveKit minutes. */
                    fetch("/api/egress", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ roomId, action: "stop_all" }),
                    }).catch(() => {});
                    slot.leave("/");
                  }}
                >
                  {closingStage ? "Closing…" : "Close stage"}
                </button>
              </div>
            </div>
          )}
          {noteOpen && room && (
            <div className="ag-invite" role="dialog" aria-label="Request a community note">
              {noteDone ? (
                <span className="ag-invite-text">
                  Request sent — reviewers will see it with this room attached.
                </span>
              ) : (
                <>
                  <span className="ag-invite-text">
                    <strong>Request a community note.</strong> What should it address?
                  </span>
                  <textarea
                    className="ag-note-input"
                    value={noteText}
                    maxLength={800}
                    rows={2}
                    placeholder="A claim made in this discussion that needs context…"
                    onChange={(e) => setNoteText(e.target.value)}
                  />
                  <div className="ag-invite-actions">
                    <button className="ag-invite-decline" disabled={noteBusy} onClick={() => setNoteOpen(false)}>
                      Cancel
                    </button>
                    <button
                      className="ag-invite-join"
                      disabled={noteBusy || !noteText.trim()}
                      onClick={async () => {
                        setNoteBusy(true);
                        const { error } = await supabase.rpc("submit_report", {
                          p_reported: room.host_id,
                          p_reason: "other",
                          p_description: `[Community note request] ${noteText.trim()}`,
                          p_context: "room",
                          p_room: roomId,
                          p_message: null,
                        });
                        setNoteBusy(false);
                        if (!error) setNoteDone(true);
                      }}
                    >
                      {noteBusy ? "Sending…" : "Send request"}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
          {/* ── Invite prompt ── */}
          {invite && (
            <InvitePrompt
              inviterName={invite.inviterName}
              busy={inviteBusy}
              onJoin={() => respondToInvite(true)}
              onDecline={() => respondToInvite(false)}
            />
          )}
          {/* ── Autoplay-blocked prompt: without this, listeners sit in
                silence with no idea the browser muted the room. It steps
                aside while another prompt or a menu is up, and comes back. ── */}
          {call.audioBlocked && !promptUp && !menuUp && (
            <button
              className="ag-invite ag-audio-prompt cursor-pointer"
              onClick={call.enableAudio}
            >
              <span className="ag-invite-text">
                <Icon name="volume-2" size={14} /> Your browser muted the room — <strong>tap to listen</strong>
              </span>
            </button>
          )}
          {/* ── Mic/camera failure toast — a silent dead button is worse ── */}
          {call.mediaError && (
            <div className="ag-media-error" role="alert">
              <span>{call.mediaError}</span>
              <button onClick={call.clearMediaError} aria-label="Dismiss">×</button>
            </div>
          )}
          {/* ── Queue position pill: the number reinforces what the 3D line
                already shows — your character physically nearing the mic ── */}
          {currentUser && (amMicHolder || myQueuePos !== null) && (
            <div
              className={`ag-queue-pill ${
                amMicHolder ? "is-mic" : myQueuePos === 1 ? "is-next" : ""
              }`}
            >
              {amMicHolder ? (
                <><Icon name="mic" size={14} /> You have the mic</>
              ) : myQueuePos === 1 ? (
                <><Icon name="sparkles" size={14} /> YOU&apos;RE NEXT</>
              ) : (
                <>
                  #{myQueuePos} in queue · {myQueuePos! - 1} ahead of you
                </>
              )}
            </div>
          )}
        </div>

        {avDebugOn && avDebug && (
          <pre
            style={{
              position: "absolute",
              top: 90,
              left: 12,
              zIndex: 80,
              maxWidth: 380,
              maxHeight: "50vh",
              overflow: "auto",
              background: "rgba(0,0,0,0.85)",
              border: "1px solid #444",
              borderRadius: 10,
              color: "#8f8",
              fontSize: 11,
              padding: 10,
              margin: 0,
            }}
          >
            {JSON.stringify(avDebug, null, 1)}
          </pre>
        )}

        {/* ── Bottom control bar ── */}
        {!broadcast && (
        <footer className="ag-controls">
          {/* Order is deliberate, and groups by how often a hand reaches
              for it: mic and camera leftmost, then the two you use while
              someone else holds the floor (react, raise hand), then screen
              share — rare enough to sit out by More, which keeps the frequent
              controls at the positions muscle memory already knows. Leave
              stays far right, where a destructive control belongs.

              Fill colour carries state: solid green = you are transmitting
              (mic, camera), solid white = your screen is on the wall, solid
              yellow = the reaction tray is open. Everything idle is black
              glass. Leave is the only control that is coloured at rest. */}

          {/* ── Mic ── */}
          {/* HLS audience mode has no WebRTC leg — mic/cam/share can't
              exist, so the controls hide rather than sit dead. */}
          {!hlsAudience && (
          <>
          <div className="ag-react-wrap ag-cam-wrap" ref={micMenuRef}>
            {micMenuOpen && (
              <div className="ag-more-menu ag-cam-menu" role="menu" aria-label="Audio">
                <div className="ag-cam-menu-title">Select a microphone</div>
                {call.mics.length === 0 && (
                  <div className="ag-cam-menu-empty">Unmute once to let the browser name your microphones.</div>
                )}
                {call.mics.map((d, i) => {
                  const active = d.deviceId === call.activeMicId;
                  return (
                    <button
                      key={d.deviceId || i}
                      className={`ag-cam-item${active ? " is-active" : ""}`}
                      role="menuitemradio"
                      aria-checked={active}
                      onClick={() => {
                        call.switchMic(d.deviceId);
                        setMicMenuOpen(false);
                      }}
                    >
                      <span className="ag-cam-check" aria-hidden>{active ? "✓" : ""}</span>
                      <span className="ag-cam-name">{d.label || `Microphone ${i + 1}`}</span>
                    </button>
                  );
                })}
                <div className="ag-cam-menu-sep" />
                <div className="ag-cam-menu-title">Select a speaker</div>
                {call.speakers.length === 0 && (
                  <div className="ag-cam-menu-empty">System default</div>
                )}
                {call.speakers.map((d, i) => {
                  const active = d.deviceId === call.activeSpeakerId;
                  return (
                    <button
                      key={d.deviceId || i}
                      className={`ag-cam-item${active ? " is-active" : ""}`}
                      role="menuitemradio"
                      aria-checked={active}
                      onClick={() => {
                        call.switchSpeaker(d.deviceId);
                        setMicMenuOpen(false);
                      }}
                    >
                      <span className="ag-cam-check" aria-hidden>{active ? "✓" : ""}</span>
                      <span className="ag-cam-name">{d.label || `Speaker ${i + 1}`}</span>
                    </button>
                  );
                })}
                <div className="ag-cam-menu-sep" />
                <button
                  className="ag-cam-item"
                  role="menuitem"
                  onClick={() => {
                    setMicMenuOpen(false);
                    setSettingsOpen(true);
                    setRailCollapsed(false);
                    setChatOpen(true);
                  }}
                >
                  <span className="ag-cam-ico" aria-hidden><Icon name="settings" size={15} /></span>
                  <span className="ag-cam-name">Audio settings</span>
                </button>
              </div>
            )}
            <button
              className={`ag-ctl ${call.micOn ? "ag-ctl--live" : ""}`}
              title={
                !onStage(myRole)
                  ? "Mic — speakers only"
                  : !call.connected
                    ? "Connecting…"
                    : call.micOn
                      ? "Mute your mic"
                      : "Unmute your mic"
              }
              disabled={!onStage(myRole) || !call.connected}
              onClick={call.toggleMic}
            >
              <span className="ag-ctl-ico">{call.micOn ? <Icon name="mic" size={19} /> : <Icon name="mic-off" size={19} />}</span>
              <span className="ag-ctl-label">{call.micOn ? "Mute" : "Mic"}</span>
            </button>
            {onStage(myRole) && call.connected && (
              <button
                className={`ag-ctl-caret${micMenuOpen ? " is-open" : ""}`}
                title="Audio options"
                aria-haspopup="menu"
                aria-expanded={micMenuOpen}
                onClick={(e) => {
                  e.stopPropagation();
                  setMicMenuOpen((v) => !v);
                }}
              >
                <Icon name="chevron-up" size={12} />
              </button>
            )}
          </div>

          <div className="ag-react-wrap ag-cam-wrap" ref={camMenuRef}>
            {camMenuOpen && (
              <div className="ag-more-menu ag-cam-menu" role="menu" aria-label="Camera">
                <div className="ag-cam-menu-title">Select a camera</div>
                {call.cameras.length === 0 && (
                  <div className="ag-cam-menu-empty">
                    No cameras found — turn your video on once to let the browser name them.
                  </div>
                )}
                {call.cameras.map((cam, i) => {
                  const active = cam.deviceId === call.activeCameraId;
                  return (
                    <button
                      key={cam.deviceId || i}
                      className={`ag-cam-item${active ? " is-active" : ""}`}
                      role="menuitemradio"
                      aria-checked={active}
                      onClick={() => {
                        call.switchCamera(cam.deviceId);
                        setCamMenuOpen(false);
                      }}
                    >
                      <span className="ag-cam-check" aria-hidden>{active ? "✓" : ""}</span>
                      <span className="ag-cam-name">{cam.label || `Camera ${i + 1}`}</span>
                    </button>
                  );
                })}
                <div className="ag-cam-menu-sep" />

                <button className="ag-cam-item" disabled title="Not built yet">
                  <span className="ag-cam-ico" aria-hidden><Icon name="sparkles" size={15} /></span>
                  <span className="ag-cam-name">Blur my background</span>
                  <span className="ag-cam-soon">Soon</span>
                </button>
                <button
                    className="ag-cam-item"
                    role="menuitem"
                    title="Call settings"
                    onClick={() => {
                      setMoreOpen(false);
                      setCamMenuOpen(false);
                      setSettingsOpen(true);
                      setRailCollapsed(false);
                      setChatOpen(true);
                    }}
                  >
                  <span className="ag-cam-ico" aria-hidden><Icon name="settings" size={15} /></span>
                  <span className="ag-cam-name">Video &amp; audio settings</span>
                </button>
              </div>
            )}
            <button
              className={`ag-ctl ${call.camOn ? "ag-ctl--live" : ""}`}
              title={
                !onStage(myRole)
                  ? "Camera — speakers only"
                  : !call.connected
                    ? "Connecting…"
                    : call.camOn
                      ? "Turn camera off"
                      : "Turn camera on"
              }
              disabled={!onStage(myRole) || !call.connected || call.mediaBusy}
              onClick={call.toggleCam}
            >
              <span className="ag-ctl-ico">{call.camOn ? <Icon name="video" size={19} /> : <Icon name="video-off" size={19} />}</span>
              <span className="ag-ctl-label">{call.mediaBusy ? "…" : call.camOn ? "Stop video" : "Video"}</span>
            </button>

            {onStage(myRole) && call.connected && (
              <button
                className={`ag-ctl-caret${camMenuOpen ? " is-open" : ""}`}
                title="Camera options"
                aria-haspopup="menu"
                aria-expanded={camMenuOpen}
                onClick={(e) => {
                  e.stopPropagation();
                  setCamMenuOpen((v) => !v);
                }}
              >
                <Icon name="chevron-up" size={12} />
              </button>
            )}
          </div>
          </>
          )}

          {/* ── React ── */}
          <div className="ag-react-wrap">
            {reactOpen && (
              <div className="ag-react-picker">
                {["👏", "❤️", "😂", "🔥", "👍", "🤯"].map((e) => (
                  <button
                    key={e}
                    className="ag-react-emoji"
                    onClick={() => {
                      call.sendReaction(e);
                      setReactOpen(false);
                    }}
                  >
                    {e}
                  </button>
                ))}
              </div>
            )}
            <button
              className={`ag-ctl ${reactOpen ? "ag-ctl--reacting" : ""}`}
              title={call.connected || hlsAudience ? "Send a reaction" : "Connecting…"}
              disabled={!call.connected && !hlsAudience}
              onClick={() => setReactOpen((v) => !v)}
            >
              <span className="ag-ctl-ico"><Icon name="smile" size={19} /></span>
              <span className="ag-ctl-label">React</span>
            </button>
          </div>

          {/* ── Raise hand (or step down, when you hold the mic) ── */}
          {amMicHolder ? (
            <button className="ag-ctl ag-ctl--live" title="Give up the mic" onClick={stepDownFromMic}>
              <span className="ag-ctl-ico"><Icon name="mic" size={19} /></span>
              <span className="ag-ctl-label">Step down</span>
            </button>
          ) : (
            <button
              className={`ag-ctl ${handRaised ? "ag-ctl--active" : ""}`}
              title={raiseTitle}
              disabled={!canRaise || requestsLocked || handBusy}
              onClick={toggleHand}
            >
              <span className="ag-ctl-ico"><Icon name="hand" size={19} /></span>
              <span className="ag-ctl-label">{handRaised ? "Lower hand" : "Raise hand"}</span>
            </button>
          )}

          {/* ── Share screen ── */}
          {!hlsAudience && (
          <button
            className={`ag-ctl ag-ctl--share ${call.screenOn ? "ag-ctl--sharing" : ""}`}
            title={
              !onStage(myRole)
                ? "Screen share — speakers only"
                : !call.connected
                  ? "Connecting…"
                  : call.screenOn
                    ? "Stop sharing your screen"
                    : "Share your screen"
            }
            disabled={!onStage(myRole) || !call.connected || call.mediaBusy}
            onClick={call.toggleScreenShare}
          >
            <span className="ag-ctl-ico"><Icon name="monitor-up" size={19} /></span>
            <span className="ag-ctl-label">{call.screenOn ? "Stop share" : "Share"}</span>
          </button>
          )}

          {/* ── Layout switcher: how *you* see the room. Local only —
                every viewer arranges their own pictures. `g` cycles.
                Hidden in HLS mode — the broadcast is a single feed. ── */}
          {!hlsAudience && !duel && layoutSwitch}

          {/* ── More: the room's tool drawer ──
              Four quadrants rather than a list. The tools are peers, not a
              ranked menu, and a square of equal tiles says that where a
              stack of rows would imply an order that doesn't exist.

              Whiteboard, Notepad and Documents have no backend yet, so they
              are marked and disabled rather than rendered as live buttons —
              the same reasoning as the media-error toast above: a control
              that looks ready and does nothing is worse than one that says
              it isn't ready. Settings is real and goes to /settings. */}
          {/* ── Chat (phones only — agora.css hides it wider; the desktop rail
                has its own collapse handle) ── */}
          <button
            className={`ag-ctl ag-ctl--chat${chatOpen ? " ag-ctl--active" : ""}`}
            title={chatOpen ? "Hide chat" : "Chat"}
            aria-expanded={chatOpen}
            onClick={() => setChatOpen((v) => !v)}
          >
            <span className="ag-ctl-ico"><Icon name="message-circle" size={19} /></span>
            <span className="ag-ctl-label">Chat</span>
          </button>

          <div className="ag-react-wrap" ref={moreWrapRef}>
            {moreOpen && (
              <div className="ag-more-menu ag-tools-menu" role="menu" aria-label="Room tools">
                {!hlsAudience && !duel && (
                  <div className="ag-more-layout">
                    <span className="ag-more-layout-label">Layout</span>
                    {layoutSwitch}
                  </div>
                )}
                <button
                  className="ag-cam-item"
                  role="menuitem"
                  title="Call settings"
                  onClick={() => {
                    setMoreOpen(false);
                    setCamMenuOpen(false);
                    setSettingsOpen(true);
                    setRailCollapsed(false);
                    setChatOpen(true);
                  }}
                >
                  <span className="ag-cam-ico" aria-hidden><Icon name="settings" size={15} /></span>
                  <span className="ag-cam-name">Settings</span>
                </button>
                {/* The panel deliberately stays open on copy: the row itself
                    is the confirmation, and closing it would hide the only
                    feedback that the copy worked. */}
                <button
                  className="ag-cam-item"
                  role="menuitem"
                  onClick={() => {
                    navigator.clipboard
                      ?.writeText(window.location.href)
                      .then(() => {
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1600);
                      })
                      .catch(() => setCopied(false));
                  }}
                >
                  <span className="ag-cam-ico" aria-hidden><Icon name={copied ? "check" : "link"} size={15} /></span>
                  <span className="ag-cam-name">{copied ? "Copied" : "Copy room link"}</span>
                </button>
                <div className="ag-cam-menu-sep" />
                {/* Not built yet, and saying so. */}
                <button className="ag-cam-item" role="menuitem" disabled title="Whiteboard — not built yet">
                  <span className="ag-cam-ico" aria-hidden><Icon name="monitor" size={15} /></span>
                  <span className="ag-cam-name">Whiteboard</span>
                  <span className="ag-cam-soon">Soon</span>
                </button>
                <button className="ag-cam-item" role="menuitem" disabled title="Notepad — not built yet">
                  <span className="ag-cam-ico" aria-hidden><Icon name="clipboard-list" size={15} /></span>
                  <span className="ag-cam-name">Notepad</span>
                  <span className="ag-cam-soon">Soon</span>
                </button>
                <button className="ag-cam-item" role="menuitem" disabled title="Documents — not built yet">
                  <span className="ag-cam-ico" aria-hidden><Icon name="file-text" size={15} /></span>
                  <span className="ag-cam-name">Documents</span>
                  <span className="ag-cam-soon">Soon</span>
                </button>
              </div>
            )}
            <button
              className={`ag-ctl ${moreOpen ? "ag-ctl--active" : ""}`}
              title="More options"
              aria-haspopup="menu"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen((v) => !v)}
            >
              <span className="ag-ctl-ico"><Icon name="more-vertical" size={19} /></span>
              <span className="ag-ctl-label">More</span>
            </button>
          </div>

          {/* ── Leave ── */}
          <button
            className="ag-ctl ag-ctl--leave"
            title="Leave the room"
            onClick={() => {
              if (isHostRole(myRole) && !duel) {
                setLeavePrompt(true);
              } else {
                vacateSeat();
                slot.leave("/");
              }
            }}
          >
            <span className="ag-ctl-ico"><Icon name="phone-off" size={19} /></span>
            <span className="ag-ctl-label">Leave</span>
          </button>
        </footer>
        )}
      </div>

      {/* Phone chat sheet scrim — tap outside to close. */}
      {chatOpen && !broadcast && (
        <div className="ag-sheet-scrim" onClick={() => setChatOpen(false)} aria-hidden />
      )}

      {!broadcast && (
        <AgoraSidebar
          roomId={roomId}
          currentUser={currentUser}
          collapsed={railCollapsed}
          onToggleCollapsed={() => {
            if (isPhoneViewport()) setChatOpen(false);
            else setRailCollapsed((v) => !v);
          }}
          settings={
            settingsOpen
              ? {
                  cameras: call.cameras,
                  activeCameraId: call.activeCameraId,
                  onSwitchCamera: call.switchCamera,
                  mics: call.mics,
                  activeMicId: call.activeMicId,
                  onSwitchMic: call.switchMic,
                  speakers: call.speakers,
                  activeSpeakerId: call.activeSpeakerId,
                  onSwitchSpeaker: call.switchSpeaker,
                  outputVolume: call.outputVolume,
                  onOutputVolume: call.setOutputVolume,
                  getMicStreamTrack: call.getMicStreamTrack,
                  simpleStage: simpleStage.on,
                  simpleStageForced: simpleStage.forced,
                  onSimpleStage: setSimpleStage,
                  smallFaces: callView.smallFaces,
                  onSmallFaces: setSmallFaces,
                  camerasTall: callView.tall,
                  onCamerasTall: phone ? undefined : setCamerasTall,
                  /* The room's own host (duels have none), while it is live. */
                  restreamRoomId: currentUser && room && room.status === "live" && currentUser.id === room.host_id && !duel ? room.id : null,
                  onClose: () => setSettingsOpen(false),
                }
              : null
          }
        />
      )}

      {/* Agora AI assistant — the full pipeline (Gemini + retrieval + history)
          lives behind /api/agora; this is its surface in the amphitheater,
          which is where every room entry routes now. Off for the beta
          (AGORA_AI in lib/features): nothing mounts, nothing listens. */}
      {AGORA_AI && !broadcast && (
        <AgoraAssistant
          motion={room.motion}
          roomId={roomId}
          topicKey={room.topic_key}
          /* Background "Hey Agora" listening + transcription for anyone on
             stage with a mic while the room is live (host, co-host, speakers). */
          liveListening={
            room.status === "live" &&
            call.connected &&
            myRole !== "audience" &&
            !myParticipation?.left_at
          }
          moderatorOn={!!room.agora_moderator}
          canModerate={!!currentUser && currentUser.id === room.host_id}
          onToggleModerator={toggleModerator}
        />
      )}
    </div>
    </div>
    {miniCard}
    </>
  );
}
