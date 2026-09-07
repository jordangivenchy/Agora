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
import { displayName } from "@/lib/names";
import { roomPath } from "@/lib/urls";
import { pathFor } from "@/lib/routes";
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
  uploader: { username: string; display_name: string | null; avatar_url: string | null } | null;
  room: { id: string; motion: string; recording_url: string | null } | null;
}

const CLIP_SELECT =
  "id, title, duration_seconds, video_url, start_seconds, end_seconds, room_id, uploader_id, view_count, " +
  "uploader:users!clips_uploader_id_fkey(username, display_name, avatar_url), " +
  "room:debate_rooms(id, motion, recording_url)";

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
        setClip(data as unknown as ClipRow);
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
  }, [id, supabase]);

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

  const author = clip?.uploader ? displayName(clip.uploader) : null;
  const composerTags = tags.filter((t) => t.community_id === composeCommunity);

  return (
    <SiteChrome>
    <main className="replay-beside-sidebar" style={{ fontFamily: "'DM Sans', sans-serif" }}>
      <div style={{ maxWidth: 960, margin: 0, padding: "10px 20px 60px" }}>
        <h1 style={{ margin: "14px 0 4px", fontSize: 24, fontWeight: 700, color: "#f5f5f0", fontFamily: "'Space Grotesk', sans-serif", letterSpacing: "-0.01em" }}>
          {clip ? clip.title || "Clip" : " "}
        </h1>

        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, minHeight: 24, flexWrap: "wrap" }}>
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
          {clip && (
            <>
              <span style={{ color: "#3a3a42" }}>·</span>
              <span style={{ fontSize: 13, color: "#8b8b94" }}>{formatViews(clip.view_count ?? 0)}</span>
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
          <button onClick={openComposer} disabled={!clip} style={pill("#26262e", "#eeeef5")}>
            <Icon name="message-square" size={13} style={{ marginRight: 6 }} />
            Post to community
          </button>
        </div>

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

function pill(bg: string, color: string): React.CSSProperties {
  return {
    display: "inline-flex", alignItems: "center",
    background: bg, border: "none", color,
    fontSize: 13, fontWeight: 600, fontFamily: "'DM Sans', sans-serif",
    padding: "9px 18px", borderRadius: 100, cursor: "pointer", whiteSpace: "nowrap",
  };
}
