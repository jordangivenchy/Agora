"use client";

/* Full profile view — rendered by the /users/[username] route (and /@handle),
   and embedded as a slide-over drawer inside live rooms so the debate keeps
   playing while you browse someone (Twitch-style).

   Header (avatar, name + verified badge, bio, joined date, follow/message),
   social stats with follower/following lists, then tabbed content: debates,
   scheduled, posts, shorts. Moderators see a verify toggle. */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";
import { TOPICS } from "@/types/database";
import { roomPath, userPath } from "@/lib/urls";
import UserAvatar from "@/components/UserAvatar";
import VerifiedBadge from "@/components/VerifiedBadge";
import FollowListModal from "@/components/FollowListModal";
import Wordmark from "@/components/Wordmark";
import EditProfileModal from "@/components/EditProfileModal";

interface Profile {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  created_at: string;
  username_changed_at: string | null;
  follower_count: number;
  following_count: number;
  is_following: boolean;
  is_friend: boolean;
  verified: boolean;
}

type DebateRow = {
  id: string;
  motion: string | null;
  topic_key: string | null;
  status: string;
  created_at: string;
  scheduled_start: string | null;
  viewer_count: number | null;
  role: string;
};

type PostRow = {
  id: string;
  title: string;
  body: string | null;
  created_at: string;
  community: { name: string } | null;
};

type ClipRow = {
  id: string;
  title: string | null;
  thumb_gradient: string | null;
  video_url: string | null;
  view_count: number | null;
  duration_seconds: number | null;
};

type Tab = "debates" | "scheduled" | "posts" | "shorts";

const card: React.CSSProperties = {
  background: "rgba(16,16,22,0.88)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 14,
};

function timeAgo(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

export default function ProfileView({
  username: rawUsername,
  embedded = false,
}: {
  username: string;
  /** Drawer mode inside a room: no top bar, transparent shell. */
  embedded?: boolean;
}) {
  const router = useRouter();
  const [supabase] = useState(() => createClient());

  const [profile, setProfile] = useState<Profile | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [viewerIsMod, setViewerIsMod] = useState(false);
  const [busy, setBusy] = useState(false);

  const [tab, setTab] = useState<Tab>("debates");
  const [debates, setDebates] = useState<DebateRow[] | null>(null);
  const [posts, setPosts] = useState<PostRow[] | null>(null);
  const [clips, setClips] = useState<ClipRow[] | null>(null);
  const [listMode, setListMode] = useState<null | "followers" | "following">(null);
  const [editOpen, setEditOpen] = useState(false);
  const [shared, setShared] = useState(false);

  const loadProfile = useCallback(async () => {
    const uname = decodeURIComponent(rawUsername);
    const { data: row } = await supabase
      .from("users")
      .select("id")
      .ilike("username", uname)
      .maybeSingle();
    if (!row) {
      setNotFound(true);
      return;
    }
    const { data } = await supabase.rpc("get_user_profile", { p_user: row.id });
    const p = Array.isArray(data) ? data[0] : data;
    if (!p) setNotFound(true);
    else setProfile(p as Profile);
  }, [rawUsername, supabase]);

  useEffect(() => {
    loadProfile();
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return;
      setViewerId(auth.user.id);
      const { data: me } = await supabase
        .from("users")
        .select("is_moderator")
        .eq("id", auth.user.id)
        .maybeSingle();
      setViewerIsMod(!!me?.is_moderator);
    })();
  }, [loadProfile, supabase]);

  /* Tab data — loaded lazily, once per profile. */
  const uid = profile?.id;
  useEffect(() => {
    if (!uid) return;
    (async () => {
      const [{ data: parts }, { data: hosted }] = await Promise.all([
        supabase
          .from("debate_participants")
          .select("role, room:debate_rooms(id, motion, topic_key, status, created_at, scheduled_start, viewer_count)")
          .eq("user_id", uid)
          .eq("role", "debater"),
        supabase
          .from("debate_rooms")
          .select("id, motion, topic_key, status, created_at, scheduled_start, viewer_count")
          .eq("host_id", uid)
          .order("created_at", { ascending: false })
          .limit(40),
      ]);
      const seen = new Map<string, DebateRow>();
      for (const r of (hosted ?? []) as Omit<DebateRow, "role">[]) {
        seen.set(r.id, { ...r, role: "host" });
      }
      for (const p of (parts ?? []) as unknown as { role: string; room: Omit<DebateRow, "role"> | null }[]) {
        if (p.room && !seen.has(p.room.id)) seen.set(p.room.id, { ...p.room, role: "debater" });
      }
      setDebates(
        [...seen.values()].sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        )
      );

      const { data: postRows } = await supabase
        .from("community_posts")
        .select("id, title, body, created_at, community:communities(name)")
        .eq("author_id", uid)
        .order("created_at", { ascending: false })
        .limit(30);
      setPosts((postRows ?? []) as unknown as PostRow[]);

      const { data: clipRows } = await supabase
        .from("clips")
        .select("id, title, thumb_gradient, video_url, view_count, duration_seconds")
        .eq("uploader_id", uid)
        .order("created_at", { ascending: false })
        .limit(30);
      setClips((clipRows ?? []) as ClipRow[]);
    })();
  }, [uid, supabase]);

  const toggleFollow = useCallback(async () => {
    if (!profile) return;
    if (!viewerId) {
      window.location.href = "/login";
      return;
    }
    setBusy(true);
    const fn = profile.is_following ? "unfollow_user" : "follow_user";
    const { error } = await supabase.rpc(fn, { p_target: profile.id });
    setBusy(false);
    if (!error) loadProfile();
  }, [profile, viewerId, supabase, loadProfile]);

  const toggleVerified = useCallback(async () => {
    if (!profile) return;
    setBusy(true);
    await supabase.rpc("set_user_verified", { p_user: profile.id, p_value: !profile.verified });
    setBusy(false);
    loadProfile();
  }, [profile, supabase, loadProfile]);

  const isSelf = viewerId && profile && viewerId === profile.id;

  const isUpcoming = (d: DebateRow) =>
    d.status !== "live" && d.status !== "ended" &&
    !!d.scheduled_start && new Date(d.scheduled_start).getTime() > Date.now();
  const pastAndLive = useMemo(() => debates?.filter((d) => !isUpcoming(d)) ?? null, [debates]);
  const upcoming = useMemo(
    () =>
      debates
        ?.filter(isUpcoming)
        .sort((a, b) => new Date(a.scheduled_start!).getTime() - new Date(b.scheduled_start!).getTime()) ?? null,
    [debates]
  );

  const counts = useMemo(
    () => ({
      debates: pastAndLive?.length ?? null,
      scheduled: upcoming?.length ?? null,
      posts: posts?.length ?? null,
      shorts: clips?.length ?? null,
    }),
    [pastAndLive, upcoming, posts, clips]
  );

  if (notFound) {
    return (
      <div className={`${embedded ? "h-full" : "min-h-screen"} flex flex-col items-center justify-center gap-4`} style={{ background: embedded ? "transparent" : "var(--bg-primary, #0a0a0c)" }}>
        <Wordmark size={24} />
        <p style={{ color: "#8b8b94", fontFamily: "'DM Sans', sans-serif" }}>
          No one by that name here.
        </p>
        <a href="/" style={{ color: "#9cc4f0", fontFamily: "'DM Sans', sans-serif", fontSize: 14 }}>
          ← Back to the Agora
        </a>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className={`${embedded ? "h-full py-24" : "min-h-screen"} flex items-center justify-center`} style={{ background: embedded ? "transparent" : "var(--bg-primary, #0a0a0c)" }}>
        <div className="animate-spin" style={{ width: 28, height: 28, borderRadius: "50%", border: "2px solid #3b6cf6", borderTopColor: "transparent" }} />
      </div>
    );
  }

  const tabBtn = (key: Tab, label: string, count: number | null) => (
    <button
      key={key}
      onClick={() => setTab(key)}
      className="cursor-pointer"
      style={{
        background: tab === key ? "rgba(255,255,255,0.09)" : "transparent",
        border: "none",
        borderRadius: 10,
        padding: "8px 16px",
        color: tab === key ? "#f5f5f0" : "#8b8b94",
        fontFamily: "'DM Sans', sans-serif",
        fontSize: 13.5,
        fontWeight: 600,
      }}
    >
      {label}
      {count !== null && (
        <span style={{ color: "#6b6b74", fontWeight: 400, marginLeft: 6 }}>{count}</span>
      )}
    </button>
  );

  return (
    <div
      className={embedded ? "" : "min-h-screen"}
      style={{
        background: embedded ? "transparent" : "var(--bg-primary, #0a0a0c)",
        fontFamily: "'DM Sans', sans-serif",
      }}
    >
      {!embedded && (
        <div className="flex items-center justify-between px-6 py-4 max-w-[860px] mx-auto">
          <a href="/" className="no-underline">
            <Wordmark size={20} />
          </a>
          <a href="/" style={{ color: "#8b8b94", fontSize: 13, textDecoration: "none" }}>
            ← Back to the Agora
          </a>
        </div>
      )}

      <main className="max-w-[860px] mx-auto px-6 pb-16">
        {/* ── Header ── */}
        <section className="p-6 flex gap-5 flex-wrap items-start" style={card}>
          <UserAvatar size={84} username={profile.username} avatarUrl={profile.avatar_url} seed={profile.id} />
          <div className="flex-1 min-w-[240px]">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="m-0" style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 24, fontWeight: 700, color: "#f5f5f0" }}>
                {profile.display_name || profile.username}
              </h1>
              {profile.verified && <VerifiedBadge size={20} />}
            </div>
            <p className="m-0 mt-0.5" style={{ color: "#8b8b94", fontSize: 14 }}>
              @{profile.username} · joined{" "}
              {new Date(profile.created_at).toLocaleDateString(undefined, { month: "long", year: "numeric" })}
            </p>
            {profile.bio && (
              <p className="m-0 mt-2.5" style={{ color: "#c9c9d2", fontSize: 14, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>
                {profile.bio}
              </p>
            )}
            <div className="flex items-center gap-4 mt-3 flex-wrap">
              <button
                onClick={() => setListMode("followers")}
                className="cursor-pointer bg-transparent border-none p-0"
                style={{ color: "#c9c9d2", fontSize: 13.5, fontFamily: "inherit" }}
              >
                <strong style={{ color: "#f5f5f0" }}>{profile.follower_count}</strong> followers
              </button>
              <button
                onClick={() => setListMode("following")}
                className="cursor-pointer bg-transparent border-none p-0"
                style={{ color: "#c9c9d2", fontSize: 13.5, fontFamily: "inherit" }}
              >
                <strong style={{ color: "#f5f5f0" }}>{profile.following_count}</strong> following
              </button>
              {profile.is_friend && (
                <span style={{ color: "#6fd3a0", fontSize: 12.5 }}>✓ Friends</span>
              )}
            </div>
            {isSelf && (
              <div className="flex items-center gap-2.5 mt-3.5 flex-wrap">
                <button
                  onClick={() => setEditOpen(true)}
                  className="cursor-pointer"
                  style={{
                    padding: "8px 20px",
                    borderRadius: 999,
                    border: "none",
                    background: "#3b6cf6",
                    color: "white",
                    fontFamily: "inherit",
                    fontSize: 13,
                    fontWeight: 600,
                  }}
                >
                  Edit profile
                </button>
                <button
                  onClick={() => {
                    navigator.clipboard
                      .writeText(`${window.location.origin}${userPath(profile.username)}`)
                      .then(() => {
                        setShared(true);
                        setTimeout(() => setShared(false), 1800);
                      });
                  }}
                  className="cursor-pointer"
                  style={{
                    padding: "8px 20px",
                    borderRadius: 999,
                    border: "1px solid rgba(255,255,255,0.14)",
                    background: shared ? "rgba(111,211,160,0.12)" : "rgba(255,255,255,0.05)",
                    color: shared ? "#6fd3a0" : "#c9c9d2",
                    fontFamily: "inherit",
                    fontSize: 13,
                    fontWeight: 600,
                  }}
                >
                  {shared ? "✓ Link copied" : "Share profile"}
                </button>
              </div>
            )}
          </div>

          {/* Actions — others: follow/message (self actions live under the stats) */}
          {!isSelf && (
            <div className="flex flex-col gap-2 shrink-0">
              <button
                onClick={toggleFollow}
                disabled={busy}
                className="cursor-pointer"
                style={{
                  padding: "9px 22px",
                  borderRadius: 999,
                  border: profile.is_following ? "1px solid rgba(255,255,255,0.18)" : "none",
                  background: profile.is_following ? "transparent" : "#3b6cf6",
                  color: profile.is_following ? "#c9c9d2" : "white",
                  fontFamily: "inherit",
                  fontSize: 13.5,
                  fontWeight: 600,
                }}
              >
                {profile.is_following ? "Following" : profile.is_friend ? "Add friend back" : "Add friend"}
              </button>
              {profile.is_friend && (
                <button
                  onClick={() => router.push(`/?dm=${profile.id}`)}
                  className="cursor-pointer"
                  style={{
                    padding: "9px 22px",
                    borderRadius: 999,
                    border: "1px solid rgba(255,255,255,0.14)",
                    background: "rgba(255,255,255,0.05)",
                    color: "#c9c9d2",
                    fontFamily: "inherit",
                    fontSize: 13.5,
                    fontWeight: 600,
                  }}
                >
                  💬 Message
                </button>
              )}
              {viewerIsMod && (
                <button
                  onClick={toggleVerified}
                  disabled={busy}
                  className="cursor-pointer"
                  title="Moderator: toggle verification badge"
                  style={{
                    padding: "7px 18px",
                    borderRadius: 999,
                    border: "1px solid rgba(59,130,246,0.4)",
                    background: "rgba(59,130,246,0.10)",
                    color: "#93bbfd",
                    fontFamily: "inherit",
                    fontSize: 12,
                  }}
                >
                  {profile.verified ? "Remove badge" : "Verify account"}
                </button>
              )}
            </div>
          )}
        </section>

        {/* ── Tabs ── */}
        <div className="flex items-center gap-1.5 mt-5 mb-3">
          {tabBtn("debates", "Debates", counts.debates)}
          {tabBtn("scheduled", "Scheduled", counts.scheduled)}
          {tabBtn("posts", "Posts", counts.posts)}
          {tabBtn("shorts", "Shorts", counts.shorts)}
        </div>

        {/* ── Debates ── */}
        {tab === "debates" && (
          <div className="flex flex-col gap-2.5">
            {pastAndLive === null ? (
              <p style={{ color: "#6b6b74", fontSize: 13 }}>Loading…</p>
            ) : pastAndLive.length === 0 ? (
              <p className="text-center py-8" style={{ ...card, color: "#6b6b74", fontSize: 13 }}>
                No debates yet.
              </p>
            ) : (
              pastAndLive.map((d) => {
                const topic = TOPICS.find((t) => t.key === d.topic_key);
                const live = d.status === "live";
                return (
                  <a
                    key={d.id}
                    href={roomPath({ id: d.id, motion: d.motion })}
                    className="no-underline px-4 py-3 flex items-center gap-3 flex-wrap"
                    style={card}
                  >
                    <div className="flex-1 min-w-[220px]">
                      <p className="m-0" style={{ color: "#f5f5f0", fontSize: 14.5, fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700 }}>
                        {d.motion || "Untitled debate"}
                      </p>
                      <p className="m-0 mt-1" style={{ color: "#8b8b94", fontSize: 11.5 }}>
                        {live ? (
                          <span style={{ color: "#e05a5a", fontWeight: 700 }}>● LIVE · </span>
                        ) : (
                          `${timeAgo(d.created_at)} ago · `
                        )}
                        {d.role === "host" ? "hosted" : "debated"}
                        {topic ? ` · ${topic.label}` : ""}
                      </p>
                    </div>
                    <span style={{ color: "#6b6b74", fontSize: 12 }}>→</span>
                  </a>
                );
              })
            )}
          </div>
        )}

        {/* ── Scheduled ── */}
        {tab === "scheduled" && (
          <div className="flex flex-col gap-2.5">
            {upcoming === null ? (
              <p style={{ color: "#6b6b74", fontSize: 13 }}>Loading…</p>
            ) : upcoming.length === 0 ? (
              <p className="text-center py-8" style={{ ...card, color: "#6b6b74", fontSize: 13 }}>
                Nothing scheduled.
              </p>
            ) : (
              upcoming.map((d) => {
                const topic = TOPICS.find((t) => t.key === d.topic_key);
                return (
                  <a
                    key={d.id}
                    href={roomPath({ id: d.id, motion: d.motion })}
                    className="no-underline px-4 py-3 flex items-center gap-3 flex-wrap"
                    style={card}
                  >
                    <div className="flex-1 min-w-[220px]">
                      <p className="m-0" style={{ color: "#f5f5f0", fontSize: 14.5, fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700 }}>
                        {d.motion || "Untitled debate"}
                      </p>
                      <p className="m-0 mt-1" style={{ color: "#f4d47c", fontSize: 11.5, fontWeight: 600 }}>
                        {new Date(d.scheduled_start!).toLocaleString(undefined, {
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                        <span style={{ color: "#8b8b94", fontWeight: 400 }}>
                          {" "}· {d.role === "host" ? "hosting" : "debating"}
                          {topic ? ` · ${topic.label}` : ""}
                        </span>
                      </p>
                    </div>
                    <span style={{ color: "#6b6b74", fontSize: 12 }}>→</span>
                  </a>
                );
              })
            )}
          </div>
        )}

        {/* ── Posts ── */}
        {tab === "posts" && (
          <div className="flex flex-col gap-2.5">
            {posts === null ? (
              <p style={{ color: "#6b6b74", fontSize: 13 }}>Loading…</p>
            ) : posts.length === 0 ? (
              <p className="text-center py-8" style={{ ...card, color: "#6b6b74", fontSize: 13 }}>
                No community posts yet.
              </p>
            ) : (
              posts.map((p) => (
                <div key={p.id} className="px-4 py-3" style={card}>
                  <p className="m-0" style={{ color: "#8b8b94", fontSize: 11 }}>
                    {p.community?.name ? `${p.community.name} · ` : ""}
                    {timeAgo(p.created_at)} ago
                  </p>
                  <p className="m-0 mt-1" style={{ color: "#f5f5f0", fontSize: 14.5, fontWeight: 600 }}>
                    {p.title}
                  </p>
                  {p.body && (
                    <p
                      className="m-0 mt-1"
                      style={{
                        color: "#a9a9b4",
                        fontSize: 13,
                        lineHeight: 1.5,
                        display: "-webkit-box",
                        WebkitLineClamp: 3,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                      }}
                    >
                      {p.body}
                    </p>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {/* ── Shorts ── */}
        {tab === "shorts" && (
          <div>
            {clips === null ? (
              <p style={{ color: "#6b6b74", fontSize: 13 }}>Loading…</p>
            ) : clips.length === 0 ? (
              <p className="text-center py-8" style={{ ...card, color: "#6b6b74", fontSize: 13 }}>
                No shorts yet.
              </p>
            ) : (
              <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))" }}>
                {clips.map((c) => (
                  <a
                    key={c.id}
                    href={c.video_url ?? "#"}
                    target={c.video_url ? "_blank" : undefined}
                    rel="noreferrer"
                    className="no-underline flex flex-col justify-end p-3"
                    style={{
                      aspectRatio: "9 / 14",
                      borderRadius: 14,
                      border: "1px solid rgba(255,255,255,0.08)",
                      background: c.thumb_gradient || "linear-gradient(160deg,#23233a,#101018)",
                    }}
                  >
                    <p className="m-0" style={{ color: "white", fontSize: 12.5, fontWeight: 600, textShadow: "0 1px 6px rgba(0,0,0,0.7)" }}>
                      {c.title || "Untitled short"}
                    </p>
                    <p className="m-0 mt-0.5" style={{ color: "rgba(255,255,255,0.75)", fontSize: 10.5 }}>
                      {c.view_count ?? 0} views
                      {c.duration_seconds ? ` · ${c.duration_seconds}s` : ""}
                    </p>
                  </a>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {profile && (
        <EditProfileModal
          open={editOpen}
          userId={profile.id}
          initialUsername={profile.username}
          initialDisplayName={profile.display_name}
          initialAvatarUrl={profile.avatar_url}
          initialBio={profile.bio}
          usernameChangedAt={profile.username_changed_at}
          accountCreatedAt={profile.created_at}
          onClose={() => setEditOpen(false)}
          onSaved={() => {
            setEditOpen(false);
            loadProfile();
          }}
        />
      )}

      <FollowListModal
        open={listMode !== null}
        userId={profile.id}
        mode={listMode ?? "followers"}
        onClose={() => setListMode(null)}
        onOpenProfile={(id) => {
          setListMode(null);
          (async () => {
            const { data } = await supabase.from("users").select("username").eq("id", id).maybeSingle();
            if (data?.username) router.push(userPath(data.username));
          })();
        }}
      />
    </div>
  );
}
