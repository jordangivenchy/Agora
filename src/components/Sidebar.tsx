"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase-browser";

export type SidebarView = "home" | "explore" | "following";

interface Friend {
  id: string;
  username: string;
  avatar_url: string | null;
  bio: string | null;
  since: string;
}

interface Props {
  activeView: SidebarView;
  onChangeView: (v: SidebarView) => void;
  onOpenDashboard: () => void;
  onOpenProfile: (userId: string) => void;
}

const NAV_ITEMS: { key: SidebarView; label: string; Icon: () => React.ReactElement }[] = [
  { key: "home", label: "Home", Icon: HomeIcon },
  { key: "explore", label: "Explore", Icon: CompassIcon },
  { key: "following", label: "Following", Icon: HeartIcon },
];

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

export default function Sidebar({ activeView, onChangeView, onOpenDashboard, onOpenProfile }: Props) {
  const supabase = createClient();
  const [friends, setFriends] = useState<Friend[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [meId, setMeId] = useState<string | null>(null);

  const loadFriends = useCallback(async () => {
    // Single getUser() call — onAuthStateChange (below) fires INITIAL_SESSION
    // once cookies hydrate and re-runs loadFriends, so polling here would just
    // pile up extra auth-lock contention on mount.
    const { data: u } = await supabase.auth.getUser();
    const uid = u.user?.id ?? null;
    setMeId(uid);
    if (!uid) {
      setFriends([]);
      setLoaded(true);
      return;
    }
    const { data, error } = await supabase.rpc("get_friends");
    if (error) {
      console.warn("[Sidebar] get_friends failed:", error);
    } else {
      setFriends((data as Friend[]) || []);
    }
    setLoaded(true);
  }, [supabase]);

  useEffect(() => {
    loadFriends();

    // Refresh whenever the auth state changes (login / logout).
    const { data: sub } = supabase.auth.onAuthStateChange(() => loadFriends());
    return () => sub.subscription.unsubscribe();
  }, [loadFriends, supabase]);

  // Refetch when the current user edits their own profile so their own
  // sidebar reflects the new avatar/username without a reload.
  useEffect(() => {
    function onUpdate() { loadFriends(); }
    window.addEventListener("profile-updated", onUpdate);
    return () => window.removeEventListener("profile-updated", onUpdate);
  }, [loadFriends]);

  // Realtime: refresh friends list when a user_follows row touching me changes
  // OR when any of my current friends' `public.users` rows are updated (so
  // their new avatar/username propagates into the sidebar). Friends are read
  // through a ref so this effect doesn't tear down + rebuild the channel
  // every time the list changes — that thrash is what was racing the auth
  // lock and stalling create_room.
  const friendsRef = useRef<Friend[]>([]);
  useEffect(() => {
    friendsRef.current = friends;
  }, [friends]);

  useEffect(() => {
    if (!meId) return;
    const channel = supabase
      .channel(`user_follows:${meId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "user_follows", filter: `follower_id=eq.${meId}` },
        () => loadFriends()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "user_follows", filter: `following_id=eq.${meId}` },
        () => loadFriends()
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "users" },
        (payload) => {
          const changedId = (payload.new as { id?: string })?.id;
          if (!changedId) return;
          if (friendsRef.current.some((f) => f.id === changedId)) loadFriends();
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [meId, supabase, loadFriends]);

  return (
    <aside
      className="fixed z-[90] flex flex-col overflow-hidden"
      style={{
        top: "calc(var(--nav-height) + 12px)",
        left: "12px",
        height: "calc(100vh - var(--nav-height) - 24px)",
        width: "var(--sidebar-width)",
        borderRadius: "16px",
        background: "rgba(18,18,21,0.6)",
        border: "1px solid var(--border)",
        boxShadow: "0 8px 32px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.04)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
      }}
    >
      {/* Nav items */}
      <div className="flex flex-col gap-1.5 p-2.5 pb-1.5">
        {NAV_ITEMS.map((item) => {
          const active = activeView === item.key;
          return (
            <button
              key={item.key}
              onClick={() => onChangeView(item.key)}
              className="flex items-center gap-3 w-full text-left cursor-pointer transition-all"
              style={{
                padding: "10px 12px",
                borderRadius: "10px",
                background: active ? "rgba(59,130,246,0.12)" : "transparent",
                border: "1px solid transparent",
                color: active ? "var(--text-primary)" : "var(--text-muted)",
                fontSize: "13.5px",
                fontWeight: active ? 600 : 500,
                letterSpacing: "-0.005em",
              }}
              onMouseEnter={(e) => {
                if (!active) e.currentTarget.style.background = "rgba(255,255,255,0.05)";
              }}
              onMouseLeave={(e) => {
                if (!active) e.currentTarget.style.background = "transparent";
              }}
            >
              <span
                className="flex items-center justify-center shrink-0"
                style={{
                  width: "22px",
                  height: "22px",
                  color: active ? "var(--accent-purple-light)" : "var(--text-muted)",
                }}
              >
                <item.Icon />
              </span>
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>

      {/* Dashboard preview (clickable) */}
      <div className="mx-2.5 mt-2 mb-3">
        <button
          onClick={onOpenDashboard}
          className="w-full text-left rounded-2xl overflow-hidden cursor-pointer transition-all"
          style={{
            background: "rgba(59,130,246,0.07)",
            border: "1px solid var(--border)",
            padding: "14px",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.border = "1px solid rgba(59,130,246,0.4)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.border = "1px solid var(--border)";
          }}
          title="Open dashboard"
        >
          <div className="flex items-center justify-between">
            <p className="text-xs" style={{ color: "var(--text-muted)", fontWeight: 500 }}>
              Dashboard
            </p>
            <span style={{ color: "rgba(162,155,254,0.7)", fontSize: 11 }}>→</span>
          </div>
          <div className="flex gap-1.5 mt-2">
            {[22, 35, 28, 40, 32].map((h, i) => (
              <div
                key={i}
                className="rounded-md"
                style={{
                  width: "24px",
                  height: `${h}px`,
                  background: `linear-gradient(180deg, rgba(100,181,246,${0.3 + i * 0.1}) 0%, rgba(25,118,210,${0.2 + i * 0.08}) 100%)`,
                  border: "0.5px solid rgba(100,181,246,0.2)",
                }}
              />
            ))}
          </div>
        </button>
      </div>

      {/* Friends */}
      <div
        className="flex-1 overflow-y-auto scrollbar-hide"
        style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}
      >
        <div className="flex justify-between items-center px-4 py-2.5">
          <span
            className="uppercase"
            style={{
              fontSize: "11px",
              fontWeight: 600,
              letterSpacing: "0.08em",
              color: "rgba(255,255,255,0.4)",
            }}
          >
            Friends
          </span>
          <span
            className="px-1.5 rounded-full"
            style={{
              background: "rgba(255,255,255,0.06)",
              color: "var(--text-dim)",
              fontSize: "10px",
              padding: "2px 6px",
            }}
          >
            {friends.length}
          </span>
        </div>

        {!loaded && (
          <div className="px-4 pb-3">
            <div
              style={{
                height: 44,
                borderRadius: 10,
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.04)",
              }}
            />
          </div>
        )}

        {loaded && !meId && (
          <div className="px-3 pb-3 text-center">
            <p className="text-xs" style={{ color: "var(--text-dim)" }}>
              Sign in to see your friends
            </p>
          </div>
        )}

        {loaded && meId && friends.length === 0 && (
          <div className="px-3 pb-3 text-center">
            <p className="text-xs leading-relaxed" style={{ color: "var(--text-dim)" }}>
              Follow someone who follows you back and they&apos;ll appear here.
            </p>
          </div>
        )}

        {loaded && meId && friends.length > 0 && (
          <div>
            {friends.map((f) => (
              <button
                key={f.id}
                onClick={() => onOpenProfile(f.id)}
                className="flex items-center gap-2.5 w-full text-left cursor-pointer transition-all"
                style={{
                  padding: "10px 14px",
                  borderBottom: "1px solid rgba(255,255,255,0.05)",
                  background: "transparent",
                  border: "none",
                  borderRight: "none",
                  borderLeft: "none",
                  borderTop: "none",
                  borderBottomColor: "rgba(255,255,255,0.05)",
                  borderBottomStyle: "solid",
                  borderBottomWidth: 1,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(255,255,255,0.03)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                }}
              >
                <div className="relative shrink-0">
                  {f.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={f.avatar_url}
                      alt={f.username}
                      className="rounded-full"
                      style={{
                        width: 36,
                        height: 36,
                        border: "1px solid rgba(255,255,255,0.1)",
                        objectFit: "cover",
                      }}
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div
                      className="rounded-full flex items-center justify-center text-white"
                      style={{
                        width: 36,
                        height: 36,
                        background: avatarColor(f.username),
                        fontFamily: "'Syne', sans-serif",
                        fontSize: 11,
                        fontWeight: 600,
                        boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
                      }}
                    >
                      {initials(f.username)}
                    </div>
                  )}
                  <span
                    className="absolute rounded-full"
                    style={{
                      width: 10,
                      height: 10,
                      right: -1,
                      bottom: -1,
                      background: "#22c55e",
                      border: "2px solid var(--bg-sidebar)",
                    }}
                  />
                </div>

                <div className="flex-1 min-w-0 flex flex-col gap-[2px]">
                  <span
                    className="truncate"
                    style={{
                      fontFamily: "'DM Sans', sans-serif",
                      fontSize: 13,
                      fontWeight: 500,
                      color: "rgba(255,255,255,0.88)",
                      letterSpacing: "-0.01em",
                    }}
                  >
                    {f.username}
                  </span>
                  <span
                    style={{
                      fontFamily: "'DM Sans', sans-serif",
                      fontSize: 11,
                      fontWeight: 500,
                      color: "rgba(255,255,255,0.3)",
                    }}
                  >
                    Online
                  </span>
                </div>

              </button>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div
        className="px-4 py-3"
        style={{
          borderTop: "1px solid rgba(255,255,255,0.06)",
          fontSize: "10px",
          color: "var(--text-dim)",
        }}
      >
        &copy; 2026 AgoraSphere
      </div>
    </aside>
  );
}

/* ── Inline SVG icons (Lucide-style, formal, consistent stroke) ── */

function HomeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}

function CompassIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
    </svg>
  );
}

function HeartIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  );
}
