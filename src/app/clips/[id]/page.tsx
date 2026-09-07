"use client";

/* /clips/<id> — a clip's own page: the ReplayPlayer plays just the
   saved window of the room's recording, with share (copy link),
   download (client-side HLS→MP4, see lib/clipDownload), and
   post-to-community, which opens the real post composer with the clip
   attached so people can write a title and text around it instead of
   the bare link going up on its own. Under the clip, Twitch-style: a
   grid of other clips — the same discussion's first, then the most
   viewed. Uploaded-file clips (video_url set) play the file directly
   and skip the transmux download for a plain file save. */

import { use, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";
import ReplayPlayer from "@/components/agora/ReplayPlayer";
import SiteChrome from "@/components/SiteChrome";
import UserAvatar from "@/components/UserAvatar";
import { Icon } from "@/components/icons";
import { roomPath, replayPath } from "@/lib/urls";
import { pathFor } from "@/lib/routes";
import { TOPICS } from "@/types/database";
import VerifiedBadge from "@/components/VerifiedBadge";
import { downloadClip } from "@/lib/clipDownload";
import { uploadPostImage } from "@/lib/postImages";
import PostComposer, { POST_BODY_MAX } from "@/components/community/PostComposer";
import { giphyEnabled } from "@/components/community/GifPicker";
import type { PickerCommunity } from "@/components/community/CommunityPicker";
import ClipTile, { formatClipDuration, formatViews, type ClipTileData } from "@/components/clips/ClipTile";

interface ClipRow {
  id: string;
  title: string;
  duration_seconds: number | null;
  video_url: string | null;
  start_seconds: number | null;
  end_seconds: number | null;
  room_id: string | null;
  uploader_id: string;
  view_count: number;
  created_at: string;
  uploader: { username: string; display_name: string | null; avatar_url: string | null } | null;
  room: {
    id: string; motion: string; recording_url: string | null; status: string; topic_key: string | null;
    host: Host | null;
  } | null;
}

type Host = { id: string; username: string; display_name: string | null; avatar_url: string | null; verified: boolean };

/* The host's standing with the viewer (get_user_profile) plus their
   latest room, for the Twitch-style channel card under the clip. */
type HostCard = {
  is_following: boolean;
  is_followed_by: boolean;
  last: { status: string; at: string } | null;
};

const CLIP_SELECT =
  "id, title, duration_seconds, video_url, start_seconds, end_seconds, room_id, uploader_id, view_count, created_at, " +
  "uploader:users!clips_uploader_id_fkey(username, display_name, avatar_url), " +
  "room:debate_rooms(id, motion, recording_url, status, topic_key, host:users!debate_rooms_host_id_fkey(id, username, display_name, avatar_url, verified))";

const MORE_SELECT =
  "id, title, duration_seconds, view_count, thumb_gradient, room_id, " +
  "uploader:users!clips_uploader_id_fkey(username, display_name, avatar_url), " +
  "room:debate_rooms(thumbnail_url)";

type MoreRow = ClipTileData & { room_id: string | null };

type Tag = { id: string; community_id: string; name: string; color: string | null };

export default function ClipPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [clip, setClip] = useState<ClipRow | null>(null);
  const [gone, setGone] = useState(false);
  const [copied, setCopied] = useState(false);
  const [dlState, setDlState] = useState<"idle" | "busy" | "err">("idle");
  const [dlPct, setDlPct] = useState(0);
  const [more, setMore] = useState<MoreRow[]>([]);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [hostCard, setHostCard] = useState<HostCard | null>(null);
  const [followBusy, setFollowBusy] = useState(false);

  /* Post composer (community/PostComposer.tsx) with the clip attached. */
  const [composing, setComposing] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [communities, setCommunities] = useState<PickerCommunity[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [composeCommunity, setComposeCommunity] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newBody, setNewBody] = useState("");
  const [newTagId, setNewTagId] = useState("");
  const [newImage, setNewImage] = useState<File | null>(null);
  const [newImagePreview, setNewImagePreview] = useState<string | null>(null);
  const [newGifUrl, setNewGifUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadHostCard = useCallback(async (h: Host) => {
    const [{ data: prof }, { data: rooms }] = await Promise.all([
      supabase.rpc("get_user_profile", { p_user: h.id }),
      supabase
        .from("debate_rooms")
        .select("status, started_at, ended_at, created_at")
        .eq("host_id", h.id)
        .eq("is_private", false)
        .order("created_at", { ascending: false })
        .limit(1),
    ]);
    const row = (Array.isArray(prof) ? prof[0] : prof) as { is_following?: boolean; is_followed_by?: boolean } | null;
    const r = (rooms ?? [])[0] as { status: string; started_at: string | null; ended_at: string | null; created_at: string } | undefined;
    setHostCard({
      is_following: !!row?.is_following,
      is_followed_by: !!row?.is_followed_by,
      last: r ? { status: r.status, at: r.ended_at ?? r.started_at ?? r.created_at } : null,
    });
  }, [supabase]);

  useEffect(() => {
    let alive = true;
    supabase
      .from("clips")
      .select(CLIP_SELECT)
      .eq("id", id)
      .maybeSingle()
      .then(({ data }) => {
        if (!alive) return;
        if (!data) { setGone(true); return; }
        const row = data as unknown as ClipRow;
        setClip(row);
        if (row.room?.host) loadHostCard(row.room.host);
        /* One view per clip per session; the count orders "More clips". */
        try {
          const key = `agora:clipViewed:${id}`;
          if (!sessionStorage.getItem(key)) {
            sessionStorage.setItem(key, "1");
            supabase.rpc("bump_clip_view", { p_clip: id }).then(undefined, () => {});
            /* The row was read before the bump; count this view on screen too. */
            setClip((c) => (c ? { ...c, view_count: (c.view_count ?? 0) + 1 } : c));
          }
        } catch {
          /* private mode */
        }
      });
    return () => { alive = false; };
  }, [id, supabase, loadHostCard]);

  const host = clip?.room?.host ?? null;

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setViewerId(data.user?.id ?? null));
  }, [supabase]);

  const toggleFollow = useCallback(async () => {
    if (!host || followBusy) return;
    if (!viewerId) { window.location.href = "/login"; return; }
    setFollowBusy(true);
    const fn = hostCard?.is_following ? "unfollow_user" : "follow_user";
    const { error: err } = await supabase.rpc(fn, { p_target: host.id });
    setFollowBusy(false);
    if (!err) loadHostCard(host);
  }, [host, followBusy, viewerId, hostCard, supabase, loadHostCard]);

  /* Other clips: the most viewed, with this discussion's own first. */
  useEffect(() => {
    if (!clip) return;
    let alive = true;
    supabase
      .from("clips")
      .select(MORE_SELECT)
      .neq("id", clip.id)
      .order("view_count", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(12)
      .then(({ data }) => {
        if (!alive || !data) return;
        const rows = (data as unknown as {
          id: string; title: string; duration_seconds: number | null; view_count: number | null;
          thumb_gradient: string | null; room_id: string | null;
          uploader: ClipTileData["uploader"];
          room: { thumbnail_url: string | null } | { thumbnail_url: string | null }[] | null;
        }[]).map((r) => ({
          id: r.id,
          title: r.title,
          duration_seconds: r.duration_seconds,
          view_count: r.view_count ?? 0,
          thumb_gradient: r.thumb_gradient,
          thumbnail_url: (Array.isArray(r.room) ? r.room[0]?.thumbnail_url : r.room?.thumbnail_url) ?? null,
          uploader: r.uploader,
          room_id: r.room_id,
        }));
        const sameRoom = clip.room_id ? rows.filter((r) => r.room_id === clip.room_id) : [];
        const rest = rows.filter((r) => !sameRoom.includes(r));
        setMore([...sameRoom, ...rest]);
      });
    return () => { alive = false; };
  }, [clip, supabase]);

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

  const pickImage = useCallback((file: File | null) => {
    setNewImage(file);
    setNewImagePreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return file ? URL.createObjectURL(file) : null;
    });
    if (file) setNewGifUrl(null);
  }, []);

  /* "Post to community": the same composer as a new post, prefilled
     with the clip's title and carrying the clip as a fixed attachment.
     Communities come grouped the way the picker expects (favorites,
     joined, the rest) — private ones only when joined. */
  const openComposer = useCallback(async () => {
    if (!clip) return;
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) { window.location.href = "/login"; return; }
    const uid = auth.user.id;
    setUserId(uid);
    setError(null);
    setNewTitle(clip.title || "Clip");
    setComposing(true);
    if (communities.length > 0) return;
    const [commRes, tagRes] = await Promise.all([
      supabase
        .from("communities")
        .select("id, name, color, avatar_url, is_private, community_members(user_id, role, favorite)"),
      supabase.from("community_tags").select("id, community_id, name, color"),
    ]);
    const rows = ((commRes.data ?? []) as unknown as {
      id: string; name: string; color: string; avatar_url: string | null; is_private: boolean;
      community_members: { user_id: string; role: string | null; favorite: boolean | null }[] | null;
    }[]).map((c) => {
      const members = c.community_members ?? [];
      const mine = members.find((m) => m.user_id === uid) ?? null;
      return {
        id: c.id, name: c.name, color: c.color, avatar_url: c.avatar_url, is_private: c.is_private,
        members: members.length, joined: !!mine, favorite: !!mine?.favorite, my_role: mine?.role ?? null,
      } satisfies PickerCommunity;
    }).filter((c) => !c.is_private || c.joined);
    rows.sort((a, b) => a.name.localeCompare(b.name));
    setCommunities(rows);
    setTags((tagRes.data ?? []) as Tag[]);
    let last: string | null = null;
    try { last = window.localStorage.getItem("agora:lastPostCommunity"); } catch {}
    const pick =
      rows.find((c) => c.id === last && c.joined) ??
      rows.find((c) => c.joined && c.favorite) ??
      rows.find((c) => c.joined) ??
      rows[0];
    setComposeCommunity(pick?.id ?? "");
  }, [clip, supabase, communities.length]);

  const closeComposer = useCallback(() => {
    setComposing(false);
    setNewTagId("");
    setNewBody("");
    setNewGifUrl(null);
    pickImage(null);
  }, [pickImage]);

  const submitPost = useCallback(async () => {
    if (!clip || !userId || busy) return;
    const title = newTitle.trim();
    if (!composeCommunity || !title) return;
    if (newBody.length > POST_BODY_MAX) {
      setError(`Post body is too long (${newBody.length.toLocaleString()} / ${POST_BODY_MAX.toLocaleString()} characters).`);
      return;
    }
    setBusy(true);
    setError(null);
    let imageUrl: string | null = null;
    if (newImage) {
      try {
        imageUrl = await uploadPostImage(supabase, userId, newImage);
      } catch (e) {
        setBusy(false);
        setError(e instanceof Error ? e.message : "Image upload failed.");
        return;
      }
    }
    /* The clip link rides at the end of the body: that is what every
       post surface keys the clip player / chip off (ClipEmbed.tsx), and
       it is stripped from the text they show. */
    const link = `${window.location.origin}/clips/${clip.id}`;
    const body = [newBody.trim(), link].filter(Boolean).join("\n\n");
    const { data, error: err } = await supabase
      .from("community_posts")
      .insert({
        community_id: composeCommunity,
        author_id: userId,
        title,
        body,
        tag_id: newTagId || null,
        image_url: imageUrl ?? newGifUrl,
      })
      .select("id")
      .single();
    setBusy(false);
    if (err) {
      setError(err.message.includes("rate_limited")
        ? "You're posting too quickly — try again in a few minutes."
        : err.message.includes("row-level security")
          ? "You can't post there — join that community first."
          : err.message);
      return;
    }
    try { window.localStorage.setItem("agora:lastPostCommunity", composeCommunity); } catch {}
    closeComposer();
    router.push(pathFor.post((data as { id: string }).id));
  }, [clip, userId, busy, newTitle, composeCommunity, newBody, newImage, newGifUrl, newTagId, supabase, closeComposer, router]);

  if (gone) {
    return (
      <main style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, background: "#0a0a0e", color: "#c0c0c8", fontFamily: "'DM Sans', sans-serif" }}>
        <p style={{ margin: 0 }}>This clip doesn&apos;t exist, or its room is private.</p>
        <button onClick={() => router.push("/")} style={pill("#2f7fe0", "#fff")}>Back to the Agora</button>
      </main>
    );
  }

  const composerTags = tags.filter((t) => t.community_id === composeCommunity);
  const topic = clip?.room?.topic_key ? TOPICS.find((t) => t.key === clip.room?.topic_key) ?? null : null;
  const live = clip?.room?.status === "live";
  const fullVideo = clip?.room
    ? live ? roomPath(clip.room) : clip.room.recording_url ? replayPath(clip.room) : null
    : null;
  const isSelf = !!host && !!viewerId && host.id === viewerId;
  const hostName = host ? host.display_name?.trim() || host.username : null;

  return (
    <SiteChrome>
    <main className="replay-beside-sidebar" style={{ fontFamily: "'DM Sans', sans-serif" }}>
      <div className="clip-page-col">
      <div className="clip-stage">
        <ReplayPlayer
          src={src}
          range={range}
          errorFallback={
            <div style={{ aspectRatio: "16 / 9", display: "flex", alignItems: "center", justifyContent: "center", background: "#101014", borderRadius: 12, color: "#8b8b94", fontSize: 13 }}>
              This clip&apos;s recording isn&apos;t available.
            </div>
          }
        />

        {/* Under the player, Twitch-style: when it was clipped, the
            title, the topic, who clipped it and the views — with the
            actions on the right. */}
        <div className="clip-info">
          <div style={{ minWidth: 0, flex: "1 1 320px" }}>
            {clip && (
              <p style={{ margin: 0, display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600, color: "#eeeef5" }}>
                <span aria-hidden style={{ width: 3, height: 16, borderRadius: 2, background: "#ffb700", flexShrink: 0 }} />
                {agoLong(clip.created_at)}
              </p>
            )}
            <h1 style={{ margin: "8px 0 0", fontSize: 17, fontWeight: 700, color: "#f5f5f0", fontFamily: "'Space Grotesk', sans-serif", letterSpacing: "-0.01em", lineHeight: 1.3 }}>
              {clip ? clip.title || "Clip" : " "}
            </h1>
            {topic && (
              <p style={{ margin: "4px 0 0", fontSize: 13.5 }}>
                <a href={`/explore?topic=${encodeURIComponent(topic.key)}`} style={{ color: "#ffb700", textDecoration: "none", fontWeight: 600 }}>{topic.label}</a>
              </p>
            )}
            {clip && (
              <p style={{ margin: "4px 0 0", fontSize: 13, color: "#8b8b94", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                {clip.uploader ? (
                  <>
                    <span>{clip.room ? "Clipped by" : "Posted by"}</span>
                    <a href={`/@${clip.uploader.username}`} style={{ color: "#c9c9d2", textDecoration: "none", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 5 }}>
                      <UserAvatar size={16} username={clip.uploader.username} avatarUrl={clip.uploader.avatar_url} />
                      @{clip.uploader.username}
                    </a>
                    <span style={{ color: "#3a3a42" }}>·</span>
                  </>
                ) : null}
                <span>{formatViews(clip.view_count ?? 0)}</span>
              </p>
            )}
          </div>
          <div className="clip-actions">
            {fullVideo && (
              <a href={fullVideo} style={{ ...pill("#26262e", "#eeeef5"), textDecoration: "none" }}>
                <Icon name={live ? "zap" : "monitor-play"} size={13} style={{ marginRight: 6 }} />
                {live ? "Join live" : "Watch full video"}
              </a>
            )}
            <button onClick={copyLink} style={pill("#2f7fe0", "#fff")}>
              <Icon name="link" size={13} style={{ marginRight: 6 }} />
              {copied ? "Copied ✓" : "Share"}
            </button>
            <button onClick={download} disabled={dlState === "busy" || !src} style={{ ...pill("#26262e", "#eeeef5"), opacity: dlState === "busy" ? 0.7 : 1 }}>
              <Icon name="download" size={13} style={{ marginRight: 6 }} />
              {dlState === "busy" ? `Preparing… ${Math.round(dlPct * 100)}%` : dlState === "err" ? "Download failed — retry" : "Download"}
            </button>
            <button onClick={openComposer} disabled={!clip} style={pill("#26262e", "#eeeef5")}>
              <Icon name="message-square" size={13} style={{ marginRight: 6 }} />
              Post to community
            </button>
          </div>
        </div>

        {/* Whose discussion it came from: the host, like Twitch's channel
            card — avatar, name, when they were last live, the discussion
            itself, and the same friend button the profile has. */}
        {clip?.room && host && (
          <div className="clip-channel">
            <a href={`/@${host.username}`} style={{ flexShrink: 0, display: "block", lineHeight: 0 }}>
              <UserAvatar size={56} username={host.username} avatarUrl={host.avatar_url} seed={host.id} />
            </a>
            <div style={{ minWidth: 0, flex: 1 }}>
              <p style={{ margin: 0, display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                <a href={`/@${host.username}`} style={{ fontSize: 16, fontWeight: 700, color: "#f5f5f0", textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {hostName}
                </a>
                {host.verified && <VerifiedBadge size={16} />}
                <span style={{ fontSize: 12.5, color: "#8b8b94", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>@{host.username}</span>
              </p>
              <p style={{ margin: "3px 0 0", fontSize: 12.5, color: "#8b8b94", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                {hostCard?.last?.status === "live" ? (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "#ff5c5c", fontWeight: 600 }}>
                    <span aria-hidden style={{ width: 7, height: 7, borderRadius: "50%", background: "#ff3b3b" }} />
                    Live now
                  </span>
                ) : hostCard?.last ? (
                  <span>Last live {agoLong(hostCard.last.at)}</span>
                ) : null}
                {hostCard?.last && <span style={{ color: "#3a3a42" }}>·</span>}
                <a href={fullVideo ?? roomPath(clip.room)} style={{ color: "#c9c9d2", textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 420 }}>
                  from “{clip.room.motion}”
                </a>
              </p>
            </div>
            {!isSelf && (
              <button
                onClick={toggleFollow}
                disabled={followBusy}
                className="cursor-pointer"
                style={{
                  height: 36, padding: "0 20px", borderRadius: 999, flexShrink: 0,
                  border: hostCard?.is_following ? "1px solid rgba(255,255,255,0.14)" : "1px solid #2f7fe0",
                  background: hostCard?.is_following ? "#0b0b0d" : "#2f7fe0",
                  color: hostCard?.is_following ? "#c9c9d2" : "white",
                  fontFamily: "inherit", fontSize: 13, fontWeight: 600,
                }}
              >
                {hostCard?.is_following ? "Following" : hostCard?.is_followed_by ? "Add friend back" : "Add friend"}
              </button>
            )}
          </div>
        )}

        {more.length > 0 && (
          <section style={{ marginTop: 34 }}>
            <h2 style={{ margin: "0 0 4px", fontSize: 18, fontWeight: 700, color: "#f5f5f0", fontFamily: "'Space Grotesk', sans-serif", letterSpacing: "-0.01em" }}>
              More clips
            </h2>
            <p style={{ margin: "0 0 14px", fontSize: 12.5, color: "#8b8b94" }}>
              {clip?.room_id && more[0]?.room_id === clip.room_id
                ? "From this discussion first, then the most watched across the Agora."
                : "The most watched across the Agora."}
            </p>
            <div className="clip-grid">
              {more.map((c) => <ClipTile key={c.id} clip={c} />)}
            </div>
          </section>
        )}
      </div>
      </div>

      {composing && clip && (
        <PostComposer
          clip={{ title: clip.title || "Clip", duration: formatClipDuration(clip.duration_seconds) }}
          pickCommunity={{
            communities,
            value: composeCommunity,
            onChange: (cid) => { setComposeCommunity(cid); setNewTagId(""); },
          }}
          title={newTitle}
          onTitle={setNewTitle}
          body={newBody}
          onBody={setNewBody}
          tags={composerTags}
          tagId={newTagId}
          onTagId={(tid) => setNewTagId(newTagId === tid ? "" : tid)}
          imagePreview={newImagePreview}
          gifUrl={newGifUrl}
          onPickImage={pickImage}
          onGif={setNewGifUrl}
          busy={busy}
          error={error}
          canSubmit={!busy && !!newTitle.trim() && !!composeCommunity}
          giphyEnabled={giphyEnabled}
          mentions={!!userId}
          maxLength={POST_BODY_MAX}
          onSubmit={submitPost}
          onClose={closeComposer}
        />
      )}
    </main>
    </SiteChrome>
  );
}

/** "6 days ago" — the long form for the clip's own line and the host's
    last-live note; the feed's short "6d" reads wrong at this size. */
function agoLong(iso: string): string {
  const mins = Math.floor((Date.now() - +new Date(iso)) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
  const years = Math.floor(days / 365);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}

function pill(bg: string, color: string): React.CSSProperties {
  return {
    display: "inline-flex", alignItems: "center",
    background: bg, border: "none", color,
    fontSize: 13, fontWeight: 600, fontFamily: "'DM Sans', sans-serif",
    padding: "9px 18px", borderRadius: 100, cursor: "pointer", whiteSpace: "nowrap",
  };
}
