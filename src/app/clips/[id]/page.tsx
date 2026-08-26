"use client";

/* /clips/<id> — a clip's own page: the ReplayPlayer plays just the
   saved window of the room's recording, with share (copy link),
   download (client-side HLS→MP4, see lib/clipDownload), and
   post-to-community. Uploaded-file clips (video_url set) play the file
   directly and skip the transmux download for a plain file save. */

import { use, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";
import ReplayPlayer from "@/components/agora/ReplayPlayer";
import UserAvatar from "@/components/UserAvatar";
import { Icon } from "@/components/icons";
import { displayName } from "@/lib/names";
import { roomPath } from "@/lib/urls";
import { downloadClip } from "@/lib/clipDownload";

interface ClipRow {
  id: string;
  title: string;
  duration_seconds: number | null;
  video_url: string | null;
  start_seconds: number | null;
  end_seconds: number | null;
  room_id: string | null;
  uploader_id: string;
  uploader: { username: string; display_name: string | null; avatar_url: string | null } | null;
  room: { id: string; motion: string; recording_url: string | null } | null;
}

const CLIP_SELECT =
  "id, title, duration_seconds, video_url, start_seconds, end_seconds, room_id, uploader_id, " +
  "uploader:users!clips_uploader_id_fkey(username, display_name, avatar_url), " +
  "room:debate_rooms(id, motion, recording_url)";

export default function ClipPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [clip, setClip] = useState<ClipRow | null>(null);
  const [gone, setGone] = useState(false);
  const [copied, setCopied] = useState(false);
  const [dlState, setDlState] = useState<"idle" | "busy" | "err">("idle");
  const [dlPct, setDlPct] = useState(0);

  /* Post-to-community picker */
  const [pickerOpen, setPickerOpen] = useState(false);
  const [boards, setBoards] = useState<{ id: string; name: string }[] | null>(null);
  const [posting, setPosting] = useState<string | null>(null);
  const [postNote, setPostNote] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    supabase
      .from("clips")
      .select(CLIP_SELECT)
      .eq("id", id)
      .maybeSingle()
      .then(({ data }) => {
        if (!alive) return;
        if (!data) setGone(true);
        else setClip(data as unknown as ClipRow);
      });
    return () => { alive = false; };
  }, [id, supabase]);

  const range = useMemo(() => {
    if (!clip || clip.video_url || clip.start_seconds === null || clip.end_seconds === null) return null;
    return { start: clip.start_seconds, end: clip.end_seconds };
  }, [clip]);
  const src = clip ? (clip.video_url ?? clip.room?.recording_url ?? null) : null;

  const copyLink = useCallback(() => {
    navigator.clipboard.writeText(window.location.origin + `/clips/${id}`).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  }, [id]);

  const download = useCallback(async () => {
    if (!clip || !src || dlState === "busy") return;
    setDlState("busy");
    setDlPct(0);
    try {
      if (clip.video_url) {
        /* Uploaded file: plain save. */
        const a = document.createElement("a");
        a.href = clip.video_url;
        a.download = `${clip.title || "clip"}.mp4`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      } else if (range) {
        await downloadClip({
          src, start: range.start, end: range.end, title: clip.title,
          onProgress: setDlPct,
        });
      }
      setDlState("idle");
    } catch (e) {
      console.warn("clip download failed", e);
      setDlState("err");
      setTimeout(() => setDlState("idle"), 3000);
    }
  }, [clip, src, range, dlState]);

  const openPicker = useCallback(async () => {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) { window.location.href = "/login"; return; }
    setPickerOpen(true);
    if (boards === null) {
      const { data } = await supabase
        .from("community_members")
        .select("community:communities(id, name)")
        .eq("user_id", auth.user.id);
      const rows = ((data ?? []) as unknown as { community: { id: string; name: string } | null }[])
        .map((r) => r.community)
        .filter((c): c is { id: string; name: string } => !!c);
      setBoards(rows);
    }
  }, [supabase, boards]);

  const postTo = useCallback(async (communityId: string) => {
    if (!clip || posting) return;
    setPosting(communityId);
    try {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) { window.location.href = "/login"; return; }
      const { error } = await supabase.from("community_posts").insert({
        community_id: communityId,
        author_id: auth.user.id,
        title: clip.title || "Clip",
        body: `${window.location.origin}/clips/${clip.id}`,
      });
      if (error) throw error;
      setPickerOpen(false);
      setPostNote("Posted ✓");
      setTimeout(() => setPostNote(null), 2500);
    } catch (e) {
      console.warn("clip post failed", e);
      setPostNote("Couldn't post — are you a member of that board?");
      setTimeout(() => setPostNote(null), 3500);
    } finally {
      setPosting(null);
    }
  }, [clip, posting, supabase]);

  if (gone) {
    return (
      <main style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, background: "#0a0a0e", color: "#c0c0c8", fontFamily: "'DM Sans', sans-serif" }}>
        <p style={{ margin: 0 }}>This clip doesn&apos;t exist, or its room is private.</p>
        <button onClick={() => router.push("/")} style={pill("#2f7fe0", "#fff")}>Back to the Agora</button>
      </main>
    );
  }

  const author = clip?.uploader ? displayName(clip.uploader) : null;

  return (
    <main style={{ minHeight: "100vh", background: "#0a0a0e", fontFamily: "'DM Sans', sans-serif" }}>
      <div style={{ maxWidth: 960, margin: "0 auto", padding: "28px 20px 60px" }}>
        <a href="/" style={{ fontSize: 12.5, color: "#8b8b94", textDecoration: "none" }}>← Back to the Agora</a>

        <h1 style={{ margin: "14px 0 4px", fontSize: 24, fontWeight: 700, color: "#f5f5f0", fontFamily: "'Space Grotesk', sans-serif", letterSpacing: "-0.01em" }}>
          {clip ? clip.title || "Clip" : " "}
        </h1>

        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, minHeight: 24 }}>
          {clip?.uploader && (
            <>
              <UserAvatar size={22} username={clip.uploader.username} avatarUrl={clip.uploader.avatar_url} />
              <a href={`/@${clip.uploader.username}`} style={{ fontSize: 13, color: "#c0c0c8", textDecoration: "none" }}>
                {author}
              </a>
            </>
          )}
          {clip?.room && (
            <>
              <span style={{ color: "#3a3a42" }}>·</span>
              <a href={roomPath(clip.room)} style={{ fontSize: 13, color: "#8b8b94", textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 380 }}>
                from “{clip.room.motion}”
              </a>
            </>
          )}
        </div>

        <ReplayPlayer
          src={src}
          range={range}
          errorFallback={
            <div style={{ aspectRatio: "16 / 9", display: "flex", alignItems: "center", justifyContent: "center", background: "#101014", borderRadius: 12, color: "#8b8b94", fontSize: 13 }}>
              This clip&apos;s recording isn&apos;t available.
            </div>
          }
        />

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
          <button onClick={copyLink} style={pill("#2f7fe0", "#fff")}>
            <Icon name="link" size={13} style={{ marginRight: 6 }} />
            {copied ? "Copied ✓" : "Share"}
          </button>
          <button onClick={download} disabled={dlState === "busy" || !src} style={{ ...pill("#26262e", "#eeeef5"), opacity: dlState === "busy" ? 0.7 : 1 }}>
            <Icon name="download" size={13} style={{ marginRight: 6 }} />
            {dlState === "busy" ? `Preparing… ${Math.round(dlPct * 100)}%` : dlState === "err" ? "Download failed — retry" : "Download"}
          </button>
          <button onClick={openPicker} style={pill("#26262e", "#eeeef5")}>
            <Icon name="message-square" size={13} style={{ marginRight: 6 }} />
            Post to community
          </button>
          {postNote && <span style={{ fontSize: 12.5, color: postNote.startsWith("Posted") ? "#7cd992" : "#fca5a5" }}>{postNote}</span>}
        </div>

        {pickerOpen && (
          <div style={{ marginTop: 14, padding: "14px 16px", background: "rgba(255,255,255,0.03)", border: "0.5px solid rgba(255,255,255,0.1)", borderRadius: 14, maxWidth: 460 }}>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: "#eeeef5" }}>Post this clip to…</span>
              <span style={{ flex: 1 }} />
              <button onClick={() => setPickerOpen(false)} style={{ background: "none", border: "none", color: "#8b8b94", cursor: "pointer", fontSize: 13 }}>✕</button>
            </div>
            {boards === null ? (
              <p style={{ margin: 0, fontSize: 12.5, color: "#8b8b94" }}>Loading your boards…</p>
            ) : boards.length === 0 ? (
              <p style={{ margin: 0, fontSize: 12.5, color: "#8b8b94" }}>Join a community first — boards you belong to appear here.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {boards.map((b) => (
                  <button
                    key={b.id}
                    onClick={() => postTo(b.id)}
                    disabled={posting !== null}
                    className="cursor-pointer disabled:opacity-50"
                    style={{
                      textAlign: "left", padding: "9px 12px", borderRadius: 10,
                      background: "rgba(255,255,255,0.05)", border: "0.5px solid rgba(255,255,255,0.08)",
                      color: "#eeeef5", fontSize: 13, fontFamily: "inherit",
                    }}
                  >
                    {posting === b.id ? `Posting to ${b.name}…` : b.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

function pill(bg: string, color: string): React.CSSProperties {
  return {
    display: "inline-flex", alignItems: "center",
    background: bg, border: "none", color,
    fontSize: 13, fontWeight: 600, fontFamily: "'DM Sans', sans-serif",
    padding: "9px 18px", borderRadius: 100, cursor: "pointer", whiteSpace: "nowrap",
  };
}
