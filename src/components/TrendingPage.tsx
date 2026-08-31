"use client";

/* Trending tab — desktop-YouTube-style feed. The video grid is real rooms
   (live first, then recent past debates). The Shorts shelf is hidden for
   now (its player + clip machinery remain dormant below, ready to re-add);
   clips still exist and have their own /clips pages. */

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { Icon } from "@/components/icons";
import useEscapeClose from "@/lib/useEscapeClose";
import type { SeedClip } from "@/lib/seed-content";
import { displayName } from "@/lib/names";
import { replayPath } from "@/lib/urls";
import ReplayPlayer from "@/components/agora/ReplayPlayer";
import UserAvatar from "@/components/UserAvatar";

interface Props {
  open: boolean;
  onClose: () => void;
}

type Clip = SeedClip & {
  videoUrl?: string | null;
  uploaderId?: string | null;
  roomId?: string | null;
  isSeed?: boolean;
  /** Range clips: a window over the room's VOD instead of an upload. */
  range?: { start: number; end: number } | null;
  roomRecordingUrl?: string | null;
};

type GridRoom = {
  id: string;
  motion: string;
  viewer_count: number;
  status: string;
  created_at: string;
  thumbnail_url?: string | null;
  recording_url?: string | null;
  host?: { username: string; display_name?: string | null; avatar_url?: string | null } | null;
};

const CHIP_FILTERS = ["All", "Politics", "Economics", "Science & Tech", "Philosophy", "Culture"];

const GRID_GRADIENTS = [
  "linear-gradient(135deg,#0d1b4b,#2d1b69)",
  "linear-gradient(135deg,#0a2e1a,#1a4d3a)",
  "linear-gradient(135deg,#1a0a00,#3d2200)",
  "linear-gradient(135deg,#0d0a2e,#2a1a5a)",
  "linear-gradient(135deg,#2d0a1a,#1a1500)",
  "linear-gradient(135deg,#001e2e,#0d001a)",
];

function fmt(n: number): string {
  return n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, "") + "K" : String(n);
}

function ago(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return `${Math.floor(days / 7)} week${days >= 14 ? "s" : ""} ago`;
}

const card: React.CSSProperties = {
  background: "rgba(18,18,24,0.92)",
  border: "0.5px solid #2e2e38",
  borderRadius: 12,
};

export default function TrendingPage({ open, onClose }: Props) {
  const [supabase] = useState(() => createClient());
  const [rooms, setRooms] = useState<GridRoom[]>([]);
  const [dbClips, setDbClips] = useState<Clip[]>([]);
  const [activeChip, setActiveChip] = useState("All");
  const [activeShort, setActiveShort] = useState<Clip | null>(null);
  const [hearted, setHearted] = useState<Record<string, boolean>>({});
  const [localComments, setLocalComments] = useState<Record<string, { user: string; body: string }[]>>({});
  const [draft, setDraft] = useState("");
  const [shareCopied, setShareCopied] = useState(false);
  const [uploadMsg, setUploadMsg] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const [{ data: roomRows }, { data: clipRows }] = await Promise.all([
      supabase
        .from("debate_rooms")
        .select("id, motion, viewer_count, status, created_at, thumbnail_url, recording_url, host:users!debate_rooms_host_id_fkey(username, display_name, avatar_url)")
        .in("status", ["live", "created", "ended"])
        .eq("is_private", false)
        /* Ended rooms are only worth a tile when the replay exists —
           an unrecorded ended room is a dead end dressed as a video. */
        .or("status.neq.ended,recording_url.not.is.null")
        .order("created_at", { ascending: false })
        .limit(12),
      supabase
        .from("clips")
        .select("id, title, duration_seconds, video_url, thumb_gradient, view_count, uploader_id, room_id, start_seconds, end_seconds, uploader:users!clips_uploader_id_fkey(username, display_name), room:debate_rooms(recording_url)")
        .order("created_at", { ascending: false })
        .limit(12),
    ]);
    if (roomRows) {
      const sorted = [...roomRows].sort((a, b) => {
        const rank = (s: string) => (s === "live" ? 0 : s === "created" ? 1 : 2);
        return rank(a.status) - rank(b.status);
      });
      setRooms(sorted as unknown as GridRoom[]);
    }
    if (clipRows) {
      setDbClips(
        clipRows.map((c, i) => {
          const row = c as unknown as {
            uploader?: { username: string };
            room?: { recording_url: string | null } | { recording_url: string | null }[] | null;
            start_seconds: number | null;
            end_seconds: number | null;
          };
          const uploader = row.uploader;
          const name = uploader?.username ?? "speaker";
          const roomRec = Array.isArray(row.room) ? row.room[0]?.recording_url : row.room?.recording_url;
          const hasRange =
            row.start_seconds !== null && row.end_seconds !== null && row.end_seconds > row.start_seconds;
          return {
            id: c.id,
            title: c.title,
            duration: c.duration_seconds
              ? `${Math.floor(c.duration_seconds / 60)}:${String(c.duration_seconds % 60).padStart(2, "0")}`
              : "clip",
            hearts: c.view_count ?? 0,
            gradient: c.thumb_gradient ?? GRID_GRADIENTS[i % GRID_GRADIENTS.length],
            uploader: { name, initial: name.charAt(0).toUpperCase(), color: "#3b82f6" },
            motion: c.title,
            opponent: "",
            comments: [],
            videoUrl: c.video_url,
            uploaderId: c.uploader_id,
            roomId: c.room_id,
            range: hasRange ? { start: row.start_seconds!, end: row.end_seconds! } : null,
            roomRecordingUrl: roomRec ?? null,
          } as Clip;
        })
      );
    }
  }, [supabase]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  useEscapeClose(open, () => (activeShort ? setActiveShort(null) : onClose()));

  const toggleHeart = useCallback((id: string) => {
    setHearted((h) => ({ ...h, [id]: !h[id] }));
  }, []);

  const share = useCallback(async (clip: Clip) => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/?clip=${clip.id}`);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 1600);
    } catch {
      /* clipboard unavailable */
    }
  }, []);

  const handleUpload = useCallback(
    async (file: File) => {
      setUploadMsg("");
      const { data: auth } = await supabase.auth.getUser();
      if (!auth?.user) { window.location.href = "/login"; return; }
      const title = window.prompt("Title for your clip:", file.name.replace(/\.[^.]+$/, ""));
      if (!title) return;
      setUploading(true);
      const path = `${auth.user.id}/${Date.now()}-${file.name.replace(/[^\w.-]/g, "_")}`;
      const { error: upErr } = await supabase.storage.from("clips").upload(path, file);
      if (upErr) {
        setUploadMsg(
          upErr.message?.includes("not found")
            ? "Clip storage isn't set up yet — run the Agora Stoa migration in Supabase first."
            : `Upload failed: ${upErr.message}`
        );
        setUploading(false);
        return;
      }
      const { data: pub } = supabase.storage.from("clips").getPublicUrl(path);
      const { error: insErr } = await supabase.from("clips").insert({
        uploader_id: auth.user.id,
        title,
        video_url: pub?.publicUrl ?? null,
        thumb_gradient: GRID_GRADIENTS[Math.floor(Math.random() * GRID_GRADIENTS.length)],
      });
      setUploading(false);
      if (insErr) {
        setUploadMsg(`Saved the video but couldn't publish the clip: ${insErr.message}`);
        return;
      }
      setUploadMsg("Clip published to your profile ✓");
      load();
    },
    [supabase, load]
  );

  if (!open) return null;

  // Real uploads only — the fictional demo reel is gone.
  const shorts: Clip[] = [...dbClips];

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
      <div className="mx-auto" style={{ maxWidth: 1440, margin: "0 auto", padding: "20px 24px" }}>
        <div className="flex items-center gap-4 mb-5">
          {activeShort && (
            <button
              onClick={() => setActiveShort(null)}
              className="text-[13px] cursor-pointer bg-transparent border-none"
              style={{ color: "#9a9aa2" }}
            >
              ← Back to Trending
            </button>
          )}
          {!activeShort && (
            <>
              <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 800, fontSize: 24, color: "#f5f5f0" }}>
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
              <span className="text-[11px] ml-auto whitespace-nowrap" style={{ color: "#6b6b74" }}>
                <span style={{ color: "#f09595" }}>●</span> updated in real time
              </span>
            </>
          )}
        </div>

        {activeShort ? (
          <div className="flex gap-5 justify-center items-stretch py-4">
            <div
              className="relative flex flex-col justify-between p-4 shrink-0 overflow-hidden"
              style={{ width: 330, height: 586, borderRadius: 18, border: "0.5px solid #3a3a44", background: activeShort.gradient }}
            >
              {activeShort.videoUrl ? (
                <video
                  src={activeShort.videoUrl}
                  controls
                  playsInline
                  className="absolute inset-0 w-full h-full"
                  style={{ objectFit: "cover", zIndex: 0 }}
                />
              ) : activeShort.range && activeShort.roomRecordingUrl ? (
                /* Range clip: a window cut from the room's VOD. */
                <div className="absolute inset-0" style={{ zIndex: 0 }}>
                  <ReplayPlayer
                    src={activeShort.roomRecordingUrl}
                    range={activeShort.range}
                    style={{ height: "100%", borderRadius: 0 }}
                  />
                </div>
              ) : null}
              <div className="flex justify-end" style={{ position: "relative", zIndex: 1 }}>
                <span style={{ background: "rgba(0,0,0,0.55)", color: "#e5e5ec", fontSize: 11, padding: "3px 10px", borderRadius: 99 }}>
                  {activeShort.duration}
                </span>
              </div>
              {!activeShort.videoUrl && !(activeShort.range && activeShort.roomRecordingUrl) && (
                <div className="text-center">
                  <span
                    className="inline-flex items-center justify-center"
                    style={{ width: 56, height: 56, borderRadius: "50%", background: "rgba(255,255,255,0.12)", border: "0.5px solid rgba(255,255,255,0.3)", color: "#fff", fontSize: 20 }}
                  >
                    <Icon name="play" size={22} style={{ fill: "currentColor" }} />
                  </span>
                  <p className="mt-3 text-[11px]" style={{ color: "rgba(255,255,255,0.5)" }}>
                    example clip — recordings attach here once discussions are recorded
                  </p>
                </div>
              )}
              <div style={{ position: "relative", zIndex: 1 }}>
                <button
                  onClick={() => {
                    if (activeShort.uploaderId) {
                      window.dispatchEvent(new CustomEvent("agora:profile", { detail: activeShort.uploaderId }));
                    }
                  }}
                  className="flex items-center gap-2.5 mb-2 cursor-pointer bg-transparent border-none p-0 text-left"
                  title={activeShort.uploaderId ? "View profile" : undefined}
                >
                  <span
                    className="flex items-center justify-center"
                    style={{ width: 34, height: 34, borderRadius: "50%", background: activeShort.uploader.color, color: "#0a0a10", fontSize: 13, fontWeight: 500, border: "1.5px solid rgba(255,255,255,0.5)" }}
                  >
                    {activeShort.uploader.initial}
                  </span>
                  <span className="text-[13px] font-medium" style={{ color: "#f5f5f0" }}>
                    @{activeShort.uploader.name}
                  </span>
                  {activeShort.uploaderId && (
                    <span className="text-[11px] px-3 py-0.5 rounded-full" style={{ background: "rgba(255,255,255,0.14)", border: "0.5px solid rgba(255,255,255,0.25)", color: "#f5f5f0" }}>
                      View profile
                    </span>
                  )}
                </button>
                <p className="text-[13px] mb-1" style={{ color: "#f5f5f0", lineHeight: 1.4 }}>
                  {activeShort.title}
                  {activeShort.opponent && <> — from "{activeShort.motion}"</>}
                </p>
                {activeShort.roomId ? (
                  <a href={`/agora/${activeShort.roomId}`} className="text-[11px] no-underline" style={{ color: "#9cc4f0" }}>
                    watch full discussion ⤢
                  </a>
                ) : activeShort.opponent ? (
                  <p className="text-[11px] m-0" style={{ color: "#c0c0c8" }}>vs {activeShort.opponent}</p>
                ) : null}
              </div>
            </div>

            <div className="flex flex-col justify-end gap-4 pb-2">
              <div className="text-center">
                <button
                  onClick={() => toggleHeart(activeShort.id)}
                  className="inline-flex items-center justify-center cursor-pointer"
                  style={{
                    width: 46, height: 46, borderRadius: "50%",
                    background: hearted[activeShort.id] ? "rgba(240,96,94,0.15)" : "rgba(255,255,255,0.06)",
                    border: "0.5px solid #3a3a42",
                    color: hearted[activeShort.id] ? "#f0605e" : "#d5d5dc", fontSize: 18,
                  }}
                >
                  <Icon name="heart" size={20} style={{ fill: hearted[activeShort.id] ? "currentColor" : "none" }} />
                </button>
                <p className="text-[10px] mt-1" style={{ color: "#c0c0c8" }}>
                  {fmt(activeShort.hearts + (hearted[activeShort.id] ? 1 : 0))}
                </p>
              </div>
              <div className="text-center">
                <span className="inline-flex items-center justify-center" style={{ width: 46, height: 46, borderRadius: "50%", background: "rgba(255,255,255,0.06)", border: "0.5px solid #3a3a42", color: "#d5d5dc", fontSize: 16 }}><Icon name="message-circle" size={18} /></span>
                <p className="text-[10px] mt-1" style={{ color: "#c0c0c8" }}>
                  {activeShort.comments.length + (localComments[activeShort.id]?.length ?? 0)}
                </p>
              </div>
              <div className="text-center">
                <button
                  onClick={() => share(activeShort)}
                  className="inline-flex items-center justify-center cursor-pointer"
                  style={{ width: 46, height: 46, borderRadius: "50%", background: "rgba(255,255,255,0.06)", border: "0.5px solid #3a3a42", color: "#d5d5dc" }}
                >
                  <Icon name="share" size={18} />
                </button>
                <p className="text-[10px] mt-1" style={{ color: shareCopied ? "#97c459" : "#c0c0c8" }}>
                  {shareCopied ? "Copied!" : "Share"}
                </p>
              </div>
              <div className="text-center">
                <button
                  onClick={() => window.dispatchEvent(new CustomEvent("agora:tab", { detail: "battle" }))}
                  className="inline-flex items-center justify-center cursor-pointer"
                  style={{ width: 46, height: 46, borderRadius: "50%", background: "rgba(24,48,82,0.9)", border: "0.5px solid #2c5382", color: "#9cc4f0", fontSize: 16 }}
                  title="Discuss this topic"
                >
                  <Icon name="sparkles" size={18} />
                </button>
                <p className="text-[10px] mt-1" style={{ color: "#9cc4f0" }}>Topics</p>
              </div>
            </div>

            <div className="flex flex-col p-4" style={{ ...card, width: 320, borderRadius: 14 }}>
              <p className="mb-3 text-[14px]" style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, color: "#f5f5f0" }}>
                Comments{" "}
                <span className="text-[11px] font-normal" style={{ color: "#8b8b94", fontFamily: "'DM Sans', sans-serif" }}>
                  {activeShort.comments.length + (localComments[activeShort.id]?.length ?? 0)}
                </span>
              </p>
              <div className="flex-1 flex flex-col gap-3 overflow-y-auto">
                {activeShort.comments.map((c, i) => (
                  <div key={i} className="flex gap-2.5">
                    <span className="flex items-center justify-center shrink-0" style={{ width: 28, height: 28, borderRadius: "50%", background: c.color, color: "#0a0a10", fontSize: 10, fontWeight: 500 }}>
                      {c.user.charAt(0).toUpperCase()}
                    </span>
                    <div>
                      <p className="text-[11px] m-0" style={{ color: "#c0c0c8" }}>
                        <span style={{ color: "#f5f5f0", fontWeight: 500 }}>@{c.user}</span> · {c.when}
                      </p>
                      <p className="text-[12px] my-0.5" style={{ color: "#e5e5ec", lineHeight: 1.4 }}>{c.body}</p>
                      <p className="text-[10px] m-0" style={{ color: "#8b8b94" }}><Icon name="heart" size={10} /> {fmt(c.likes)} · Reply</p>
                    </div>
                  </div>
                ))}
                {(localComments[activeShort.id] ?? []).map((c, i) => (
                  <div key={`local-${i}`} className="flex gap-2.5">
                    <span className="flex items-center justify-center shrink-0" style={{ width: 28, height: 28, borderRadius: "50%", background: "#3b82f6", color: "#eff6ff", fontSize: 10, fontWeight: 500 }}>
                      {c.user.charAt(0).toUpperCase()}
                    </span>
                    <div>
                      <p className="text-[11px] m-0" style={{ color: "#c0c0c8" }}>
                        <span style={{ color: "#f5f5f0", fontWeight: 500 }}>@{c.user}</span> · now
                      </p>
                      <p className="text-[12px] my-0.5" style={{ color: "#e5e5ec", lineHeight: 1.4 }}>{c.body}</p>
                    </div>
                  </div>
                ))}
                {activeShort.comments.length === 0 && !(localComments[activeShort.id]?.length) && (
                  <p className="text-[11px]" style={{ color: "#8b8b94" }}>No comments yet — start the discussion.</p>
                )}
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
            {/* Video grid — real rooms */}
            {rooms.length === 0 ? (
              <div className="p-4 text-center" style={card}>
                <p className="m-0 mb-2 text-[14px]" style={{ color: "#f5f5f0", fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700 }}>
                  Nothing trending yet
                </p>
                <p className="m-0 mb-3 text-[12px]" style={{ color: "#8b8b94" }}>
                  Discussions appear here the moment they go live.
                </p>
                <button
                  onClick={() => window.dispatchEvent(new CustomEvent("agora:create"))}
                  className="cursor-pointer text-[12px] font-medium px-4 py-2 rounded-lg border-none"
                  style={{ background: "linear-gradient(135deg,#f7e3a0,#d9a238)", color: "#412402" }}
                >
                  <Icon name="sparkles" size={12} /> Start the first one
                </button>
              </div>
            ) : (
              <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
                {rooms.map((r, i) => (
                  <a
                    key={r.id}
                    /* Ended tiles open the dedicated replay surface —
                       no live-room machinery between click and video. */
                    href={r.status === "ended" ? replayPath(r) : `/agora/${r.id}`}
                    className="no-underline"
                  >
                    <div
                      className="relative mb-2 overflow-hidden"
                      style={{ aspectRatio: "16/9", borderRadius: 12, background: GRID_GRADIENTS[i % GRID_GRADIENTS.length], border: "0.5px solid #3a3a44" }}
                    >
                      {/* Host-picked thumbnail, else the host's profile
                          picture fills the tile; the gradient stays as
                          the fallback for hosts with neither. */}
                      {(r.thumbnail_url || r.host?.avatar_url) && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={(r.thumbnail_url || r.host?.avatar_url)!}
                          alt=""
                          className="absolute inset-0"
                          style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center 30%" }}
                        />
                      )}
                      {r.status === "live" ? (
                        <span className="absolute top-2 left-2 text-[10px] font-medium px-2.5 py-0.5 rounded-full" style={{ background: "#e24b4a", color: "#fcebeb" }}>
                          ● LIVE
                        </span>
                      ) : r.status === "created" ? (
                        <span className="absolute top-2 left-2 text-[10px] font-medium px-2.5 py-0.5 rounded-full" style={{ background: "rgba(51,41,26,0.95)", border: "0.5px solid #6b5a30", color: "#f4d47c" }}>
                          OPEN — JOIN
                        </span>
                      ) : (
                        <span className="absolute top-2 left-2 text-[10px] px-2.5 py-0.5 rounded-full" style={{ background: "rgba(0,0,0,0.55)", color: "#c0c0c8" }}>
                          ENDED
                        </span>
                      )}
                      <span className="absolute bottom-2 right-2 text-[10px] px-2.5 py-0.5 rounded-full" style={{ background: "rgba(0,0,0,0.55)", color: "#e5e5ec" }}>
                        <Icon name="eye" size={11} /> {fmt(r.viewer_count ?? 0)}
                      </span>
                    </div>
                    <div className="flex gap-2.5">
                      <UserAvatar
                        size={32}
                        username={r.host?.username}
                        avatarUrl={r.host?.avatar_url}
                      />
                      <div>
                        <p className="text-[13px] m-0" style={{ color: "#f5f5f0", lineHeight: 1.35 }}>{r.motion}</p>
                        <p className="text-[11px] mt-0.5 m-0" style={{ color: "#8b8b94" }}>
                          {displayName(r.host) || "Unknown"} · {r.status === "live" ? "watching now" : ago(r.created_at)}
                        </p>
                      </div>
                    </div>
                  </a>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
