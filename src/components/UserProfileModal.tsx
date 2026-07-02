"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase-browser";
import { TOPICS } from "@/types/database";
import EditProfileModal from "./EditProfileModal";
import FollowListModal from "./FollowListModal";

interface Props {
  userId: string | null;
  onClose: () => void;
  /** Allow parent to swap to a different user's profile (e.g. from a follow list row). */
  onOpenProfile?: (userId: string) => void;
}

interface ProfileRow {
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
  is_followed_by: boolean;
  is_friend: boolean;
}

interface LiveOrScheduledDebate {
  room_id: string;
  motion: string;
  topic_key: string;
  status: string;
  stance: string | null;
  started_at: string | null;
  scheduled_start: string | null;
  is_scheduled: boolean;
  is_private: boolean;
}

const AVATAR_COLORS = [
  "#1976D2", "#00b894", "#4a9eff", "#fd9644",
  "#64B5F6", "#e17055", "#00cec9", "#fdcb6e",
];

function avatarColor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase();
}

export default function UserProfileModal({ userId, onClose, onOpenProfile }: Props) {
  const supabase = createClient();
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [debates, setDebates] = useState<LiveOrScheduledDebate[]>([]);
  const [me, setMe] = useState<string | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);  // initial load (blocks rendering)
  const [refetching, setRefetching] = useState(false);          // post-save refetch (silent)
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [followListMode, setFollowListMode] = useState<null | "followers" | "following">(null);

  const load = useCallback(async (isInitial = true) => {
    if (!userId) return;

    // Set appropriate loading state based on context
    if (isInitial) {
      setLoadingProfile(true);
    } else {
      setRefetching(true);
    }
    setError(null);

    try {
      const [{ data: u }, { data: profRows, error: profErr }, { data: debateRows }] = await Promise.all([
        supabase.auth.getUser(),
        supabase.rpc("get_user_profile", { p_user: userId }),
        supabase.rpc("get_user_live_and_scheduled", { p_user: userId }),
      ]);

      setMe(u.user?.id ?? null);

      if (profErr) {
        setError(profErr.message || "Could not load profile");
        return;
      }
      const row = Array.isArray(profRows) ? profRows[0] : profRows;
      setProfile(row ?? null);
      setDebates((debateRows as LiveOrScheduledDebate[]) ?? []);
    } catch (e) {
      // A thrown (non-returned) error from Promise.all would otherwise leave
      // loadingProfile true forever and hang the modal on the spinner.
      console.error("[UserProfileModal] load failed:", e);
      setError(e instanceof Error ? e.message : "Could not load profile");
    } finally {
      if (isInitial) {
        setLoadingProfile(false);
      } else {
        setRefetching(false);
      }
    }
  }, [userId, supabase]);

  useEffect(() => {
    if (userId) load(true);  // true = initial load
    else {
      setProfile(null);
      setDebates([]);
      setError(null);
    }
  }, [userId, load]);

  // Cleanup effect: reset both loading states when modal closes (userId becomes null)
  useEffect(() => {
    if (!userId) {
      setLoadingProfile(false);
      setRefetching(false);
    }
  }, [userId]);

  // Silently refetch if a profile edit is dispatched elsewhere in the app while
  // this modal is open (e.g. the user edits their own profile).
  useEffect(() => {
    function onUpdate() {
      if (userId) load(false);
    }
    window.addEventListener("profile-updated", onUpdate);
    return () => window.removeEventListener("profile-updated", onUpdate);
  }, [userId, load]);

  async function handleFollowToggle() {
    if (!profile || !me || me === profile.id || busy) return;

    // Optimistic update — patch state in place immediately.
    const prev = profile;
    const willFollow = !profile.is_following;
    const nextFollowerCount = profile.follower_count + (willFollow ? 1 : -1);
    const nextIsFriend = willFollow ? profile.is_followed_by : false;
    setProfile({
      ...profile,
      is_following: willFollow,
      follower_count: Math.max(0, nextFollowerCount),
      is_friend: nextIsFriend,
    });
    setBusy(true);

    const fn = willFollow ? "follow_user" : "unfollow_user";
    const { error: rpcErr } = await supabase.rpc(fn, { p_target: profile.id });
    if (rpcErr) {
      // roll back
      setProfile(prev);
      setError(rpcErr.message);
    }
    setBusy(false);
  }

  function topicLabel(key: string) {
    return TOPICS.find((t) => t.key === key)?.label ?? key;
  }

  function formatScheduled(iso: string) {
    const d = new Date(iso);
    const now = new Date();
    const sameDay =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();
    const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    if (sameDay) return `Today · ${time}`;
    const dateStr = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    return `${dateStr} · ${time}`;
  }

  if (!userId) return null;

  return (
    <div
      className="fixed inset-0 z-[900] flex items-center justify-center p-5"
      style={{
        background: "rgba(0,0,0,0.78)",
        backdropFilter: "blur(4px)",
        animation: "modalIn 0.2s ease",
      }}
      onClick={onClose}
    >
      <div
        className="w-full"
        style={{
          maxWidth: "520px",
          background: "rgba(10,10,18,0.97)",
          backdropFilter: "blur(24px)",
          border: "1px solid rgba(255,255,255,0.09)",
          borderRadius: "20px",
          boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
          padding: "24px 24px 22px",
          animation: "modalPanelIn 0.25s cubic-bezier(0.25, 0.46, 0.45, 0.94)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-3">
          <h2
            style={{
              fontFamily: "'Syne', sans-serif",
              fontSize: "15px",
              fontWeight: 700,
              color: "var(--text-primary)",
              opacity: 0.7,
            }}
          >
            Profile
          </h2>
          <button
            onClick={onClose}
            className="text-xl leading-none cursor-pointer"
            style={{ color: "var(--text-muted)", background: "none", border: "none" }}
          >
            &times;
          </button>
        </div>

        {loadingProfile && (
          <div className="py-10 text-center" style={{ color: "var(--text-muted)", fontSize: 13 }}>
            Loading…
          </div>
        )}

        {error && !loadingProfile && (
          <div
            className="text-sm rounded-lg px-3 py-2 mb-3"
            style={{
              background: "rgba(232,64,64,0.1)",
              border: "1px solid rgba(232,64,64,0.3)",
              color: "#ff6b6b",
              fontSize: "12px",
            }}
          >
            {error}
          </div>
        )}

        {!loadingProfile && profile && (
          <>
            {/* Header: avatar + name + stats */}
            <div className="flex items-center gap-4 mb-4">
              {profile.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={profile.avatar_url}
                  alt={profile.username}
                  className="rounded-full"
                  style={{ width: 64, height: 64, border: "1.5px solid rgba(255,255,255,0.12)" }}
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div
                  className="rounded-full flex items-center justify-center text-white"
                  style={{
                    width: 64,
                    height: 64,
                    background: avatarColor(profile.username),
                    fontFamily: "'Syne', sans-serif",
                    fontWeight: 700,
                    fontSize: 20,
                  }}
                >
                  {initials(profile.username)}
                </div>
              )}

              <div className="flex-1 min-w-0">
                <div
                  className="flex items-center gap-2"
                  style={{
                    fontFamily: "'DM Sans', sans-serif",
                    fontSize: 20,
                    fontWeight: 700,
                    letterSpacing: "-0.02em",
                    color: "var(--text-primary)",
                  }}
                >
                  <span className="truncate">{profile.display_name || profile.username}</span>
                  {profile.is_friend && (
                    <span
                      style={{
                        fontFamily: "'DM Sans', sans-serif",
                        fontSize: 10,
                        fontWeight: 600,
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                        padding: "2px 8px",
                        borderRadius: 999,
                        background: "rgba(34,197,94,0.1)",
                        border: "1px solid rgba(34,197,94,0.3)",
                        color: "#22c55e",
                      }}
                    >
                      Friend
                    </span>
                  )}
                </div>
                <div
                  style={{
                    fontFamily: "'DM Mono', monospace",
                    fontSize: 12,
                    color: "var(--text-dim)",
                    marginTop: 1,
                  }}
                >
                  @{profile.username}
                </div>
                <div
                  className="flex gap-4 mt-1"
                  style={{
                    fontFamily: "'DM Sans', sans-serif",
                    fontSize: 12,
                    color: "var(--text-muted)",
                  }}
                >
                  <button
                    onClick={() => setFollowListMode("followers")}
                    className="cursor-pointer"
                    style={{
                      background: "none",
                      border: "none",
                      padding: 0,
                      color: "inherit",
                      font: "inherit",
                    }}
                  >
                    <b style={{ color: "var(--text-primary)" }}>{profile.follower_count}</b> followers
                  </button>
                  <button
                    onClick={() => setFollowListMode("following")}
                    className="cursor-pointer"
                    style={{
                      background: "none",
                      border: "none",
                      padding: 0,
                      color: "inherit",
                      font: "inherit",
                    }}
                  >
                    <b style={{ color: "var(--text-primary)" }}>{profile.following_count}</b> following
                  </button>
                </div>
              </div>
            </div>

            {profile.bio && (
              <p
                style={{
                  fontFamily: "'DM Sans', sans-serif",
                  fontSize: 13,
                  color: "var(--text-muted)",
                  marginBottom: 16,
                  lineHeight: 1.5,
                }}
              >
                {profile.bio}
              </p>
            )}

            {/* Actions */}
            {me && me === profile.id && (
              <div className="flex gap-2 mb-5">
                <button
                  onClick={() => setEditOpen(true)}
                  className="flex-1 cursor-pointer transition-all"
                  style={{
                    background:
                      "linear-gradient(135deg, rgba(108,92,231,0.22) 0%, rgba(108,92,231,0.14) 100%)",
                    border: "1px solid rgba(108,92,231,0.45)",
                    color: "rgba(200,190,255,0.96)",
                    fontFamily: "'Syne', sans-serif",
                    fontSize: 12.5,
                    fontWeight: 700,
                    letterSpacing: "0.03em",
                    padding: "10px 18px",
                    borderRadius: 10,
                  }}
                >
                  Edit profile
                </button>
              </div>
            )}

            {me && me !== profile.id && (
              <div className="flex gap-2 mb-5">
                <button
                  onClick={handleFollowToggle}
                  disabled={busy}
                  className="flex-1 cursor-pointer transition-all disabled:opacity-50"
                  style={{
                    background: profile.is_following
                      ? "rgba(255,255,255,0.04)"
                      : "linear-gradient(135deg, rgba(108,92,231,0.22) 0%, rgba(108,92,231,0.14) 100%)",
                    border: profile.is_following
                      ? "1px solid rgba(255,255,255,0.12)"
                      : "1px solid rgba(108,92,231,0.45)",
                    color: profile.is_following ? "rgba(255,255,255,0.78)" : "rgba(200,190,255,0.96)",
                    fontFamily: "'Syne', sans-serif",
                    fontSize: 12.5,
                    fontWeight: 700,
                    letterSpacing: "0.03em",
                    padding: "10px 18px",
                    borderRadius: 10,
                  }}
                >
                  {busy
                    ? "…"
                    : profile.is_following
                    ? profile.is_friend
                      ? "Friends ✓"
                      : "Following ✓"
                    : profile.is_followed_by
                    ? "Follow back"
                    : "Follow"}
                </button>
                <button
                  onClick={() => alert("Direct messages are coming soon.")}
                  className="flex-1 cursor-pointer transition-all"
                  style={{
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    color: "rgba(238,238,245,0.82)",
                    fontFamily: "'Syne', sans-serif",
                    fontSize: 12.5,
                    fontWeight: 700,
                    letterSpacing: "0.03em",
                    padding: "10px 18px",
                    borderRadius: 10,
                  }}
                  title="Coming soon"
                >
                  Message
                </button>
              </div>
            )}

            {/* Live & scheduled debates */}
            <div
              className="mb-2"
              style={{
                fontFamily: "'DM Sans', sans-serif",
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "rgba(255,255,255,0.4)",
              }}
            >
              Live & scheduled
            </div>

            {debates.length === 0 ? (
              <div
                className="rounded-xl text-center py-6"
                style={{
                  background: "rgba(255,255,255,0.02)",
                  border: "1px solid rgba(255,255,255,0.06)",
                  color: "var(--text-dim)",
                  fontSize: 12.5,
                }}
              >
                No live or upcoming debates.
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {debates.map((d) => {
                  const stanceColor = d.stance === "PRO"
                    ? "var(--pro-color, #22c55e)"
                    : d.stance === "CON"
                    ? "var(--con-color, #e84040)"
                    : "rgba(180,170,255,0.9)";
                  const isLive = d.status === "live" && !d.is_scheduled;
                  const statusLabel = isLive
                    ? "LIVE"
                    : d.is_scheduled && d.scheduled_start
                    ? formatScheduled(d.scheduled_start)
                    : d.status;
                  const statusColor = isLive
                    ? "#e84040"
                    : d.is_scheduled
                    ? "#e2b96b"
                    : "var(--text-dim)";
                  return (
                    <div
                      key={d.room_id}
                      className="flex items-center gap-3"
                      style={{
                        padding: "10px 12px",
                        background: "rgba(255,255,255,0.03)",
                        border: "1px solid rgba(255,255,255,0.06)",
                        borderRadius: 12,
                      }}
                    >
                      {d.stance && (
                        <span
                          style={{
                            fontFamily: "'Syne', sans-serif",
                            fontSize: 10,
                            fontWeight: 800,
                            letterSpacing: "0.08em",
                            padding: "3px 8px",
                            borderRadius: 999,
                            border: `1px solid ${stanceColor}`,
                            color: stanceColor,
                            flexShrink: 0,
                          }}
                        >
                          {d.stance}
                        </span>
                      )}
                      <div className="flex-1 min-w-0">
                        <div
                          className="truncate"
                          style={{
                            fontFamily: "'DM Sans', sans-serif",
                            fontSize: 13,
                            color: "var(--text-primary)",
                            fontWeight: 500,
                          }}
                        >
                          {d.motion}
                        </div>
                        <div
                          className="truncate flex items-center gap-1.5"
                          style={{
                            fontFamily: "'DM Mono', monospace",
                            fontSize: 10,
                            color: "var(--text-dim)",
                            marginTop: 2,
                          }}
                        >
                          <span>{topicLabel(d.topic_key)}</span>
                          <span>·</span>
                          <span style={{ color: statusColor, fontWeight: 600 }}>
                            {statusLabel}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* Edit profile (self only) */}
      {profile && me === profile.id && (
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
            load(false);  // false = refetch, don't block
          }}
        />
      )}

      {/* Followers / Following list */}
      {profile && followListMode && (
        <FollowListModal
          open={!!followListMode}
          userId={profile.id}
          mode={followListMode}
          onClose={() => setFollowListMode(null)}
          onOpenProfile={(id) => {
            setFollowListMode(null);
            if (onOpenProfile) onOpenProfile(id);
          }}
        />
      )}
    </div>
  );
}
