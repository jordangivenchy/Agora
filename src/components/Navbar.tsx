"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import type { User } from "@supabase/supabase-js";

interface SearchResult {
  id: string;
  username: string;
  avatar_url: string | null;
  bio: string | null;
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

export default function Navbar({
  onCreateRoom,
  onJoinPrivate,
  onOpenProfile,
}: {
  onCreateRoom: () => void;
  onJoinPrivate: () => void;
  onOpenProfile: (userId: string) => void;
}) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<{
    username: string;
    display_name: string | null;
    avatar_url: string | null;
  } | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const supabase = createClient();

  // Hydrate the `public.users` row so we display the user's edited profile
  // rather than the stale OAuth metadata that Supabase auth returns. Retries
  // once on transient failure because the very first post-refresh call can
  // race with cookie hydration and either error or return an empty array.
  const loadProfile = useCallback(async (uid: string) => {
    async function attempt() {
      const { data, error } = await supabase.rpc("get_user_profile", { p_user: uid });
      if (error) return { ok: false as const, error };
      const row = Array.isArray(data) ? data[0] : data;
      return { ok: true as const, row: row ?? null };
    }
    let result = await attempt();
    if ((!result.ok || !result.row) && typeof window !== "undefined") {
      if (!result.ok) console.warn("[Navbar] get_user_profile retrying after error:", result.error);
      await new Promise((r) => setTimeout(r, 300));
      result = await attempt();
    }
    if (!result.ok) {
      console.error("[Navbar] get_user_profile failed twice:", result.error);
      return;
    }
    if (result.row) {
      const row = result.row as {
        username: string;
        display_name?: string | null;
        avatar_url: string | null;
      };
      setProfile({
        username: row.username,
        display_name: row.display_name ?? null,
        avatar_url: row.avatar_url ?? null,
      });
    }
  }, [supabase]);

  // Search state
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const searchWrapRef = useRef<HTMLDivElement | null>(null);

  // Single subscription path: onAuthStateChange fires INITIAL_SESSION on
  // subscribe, which both populates `user` and triggers loadProfile. Calling
  // getUser() in parallel (as we did before) doubled every auth-token lock
  // acquisition on mount; under React Strict Mode that's enough to overflow
  // the 5s navigator.locks timeout and stall every concurrent supabase RPC
  // (including create_room).
  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) loadProfile(session.user.id);
      else setProfile(null);
    });

    return () => subscription.unsubscribe();
  }, [loadProfile, supabase]);

  // Refetch whenever the user edits their profile from anywhere in the app.
  useEffect(() => {
    function onUpdate() {
      if (user) loadProfile(user.id);
    }
    window.addEventListener("profile-updated", onUpdate);
    return () => window.removeEventListener("profile-updated", onUpdate);
  }, [user, loadProfile]);

  // Debounced user search
  useEffect(() => {
    const q = query.trim();
    if (q.length === 0) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const handle = setTimeout(async () => {
      const { data, error } = await supabase.rpc("search_users", { p_query: q });
      if (!error) setResults((data as SearchResult[]) || []);
      setSearching(false);
    }, 200);
    return () => clearTimeout(handle);
  }, [query, supabase]);

  // Close results when clicking outside
  useEffect(() => {
    function handleDoc(e: MouseEvent) {
      if (!searchWrapRef.current) return;
      if (!searchWrapRef.current.contains(e.target as Node)) {
        setShowResults(false);
      }
    }
    document.addEventListener("mousedown", handleDoc);
    return () => document.removeEventListener("mousedown", handleDoc);
  }, []);

  async function signOut() {
    await supabase.auth.signOut();
    // Hard reload so every realtime channel, RPC cache, and in-memory state is
    // wiped. Avoids "data appears gone on re-sign-in" symptoms caused by stale
    // subscriptions bound to the previous session.
    window.location.href = "/";
  }

  function pickResult(userId: string) {
    setShowResults(false);
    setQuery("");
    setResults([]);
    onOpenProfile(userId);
  }

  // Prefer the freshly-loaded `public.users` row over the frozen OAuth metadata
  // so edits propagate instantly across the app.
  const avatarUrl =
    profile?.avatar_url ||
    user?.user_metadata?.avatar_url ||
    user?.user_metadata?.picture;
  const displayName =
    profile?.display_name ||
    profile?.username ||
    user?.user_metadata?.name ||
    user?.email?.split("@")[0] ||
    "User";

  return (
    <nav
      className="fixed top-0 left-0 right-0 flex items-center px-5 z-[100] gap-4"
      style={{
        height: "var(--nav-height)",
        background: "rgba(10,10,12,0.85)",
        borderBottom: "1px solid var(--border)",
        backdropFilter: "blur(20px) saturate(140%)",
        WebkitBackdropFilter: "blur(20px) saturate(140%)",
      }}
    >
      {/* Logo */}
      <a href="/" className="flex items-center gap-2.5 shrink-0 no-underline">
        <span
          className="text-[22px] font-bold tracking-tight"
          style={{ fontFamily: "'Syne', sans-serif", color: "var(--text-primary)" }}
        >
          <span style={{ color: "var(--accent-blue)" }}>A</span>goraSphere
        </span>
      </a>

      {/* Search */}
      <div
        className="flex-1 max-w-[480px] mx-auto relative"
        ref={searchWrapRef}
      >
        <svg
          width="15"
          height="15"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          viewBox="0 0 24 24"
          className="absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none"
          style={{ color: "var(--text-dim)" }}
        >
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.35-4.35" />
        </svg>
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setShowResults(true);
          }}
          onFocus={(e) => {
            setShowResults(true);
            e.currentTarget.style.borderColor = "var(--border-hover)";
            e.currentTarget.style.background = "rgba(255,255,255,0.06)";
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = "var(--border)";
            e.currentTarget.style.background = "rgba(255,255,255,0.04)";
          }}
          placeholder="Search"
          className="w-full outline-none transition-all"
          style={{
            height: "38px",
            background: "rgba(255,255,255,0.04)",
            border: "1px solid var(--border)",
            borderRadius: "100px",
            color: "var(--text-primary)",
            fontFamily: "'DM Sans', sans-serif",
            fontSize: "13.5px",
            padding: "0 18px 0 42px",
          }}
        />

        {/* Search results dropdown */}
        {showResults && query.trim().length > 0 && (
          <div
            className="absolute left-0 right-0 overflow-hidden"
            style={{
              top: "calc(100% + 8px)",
              background: "rgba(10,10,18,0.97)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: "16px",
              boxShadow: "0 12px 36px rgba(0,0,0,0.5)",
              backdropFilter: "blur(18px)",
              maxHeight: "360px",
              overflowY: "auto",
              zIndex: 200,
            }}
          >
            {searching && (
              <div
                className="py-5 text-center"
                style={{ color: "var(--text-muted)", fontSize: 12 }}
              >
                Searching…
              </div>
            )}

            {!searching && results.length === 0 && (
              <div
                className="py-6 text-center"
                style={{ color: "var(--text-dim)", fontSize: 12.5 }}
              >
                No users match <span style={{ color: "var(--text-muted)" }}>&quot;{query.trim()}&quot;</span>
              </div>
            )}

            {!searching && results.length > 0 && results.map((u) => (
              <button
                key={u.id}
                onClick={() => pickResult(u.id)}
                className="flex items-center gap-3 w-full text-left cursor-pointer transition-all"
                style={{
                  padding: "10px 14px",
                  background: "transparent",
                  border: "none",
                  borderBottom: "1px solid rgba(255,255,255,0.04)",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(255,255,255,0.04)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                }}
              >
                {u.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={u.avatar_url}
                    alt={u.username}
                    className="rounded-full shrink-0"
                    style={{ width: 32, height: 32, border: "1px solid rgba(255,255,255,0.1)" }}
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div
                    className="rounded-full flex items-center justify-center text-white shrink-0"
                    style={{
                      width: 32,
                      height: 32,
                      background: avatarColor(u.username),
                      fontFamily: "'Syne', sans-serif",
                      fontWeight: 700,
                      fontSize: 11,
                    }}
                  >
                    {initials(u.username)}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div
                    className="truncate"
                    style={{
                      fontFamily: "'DM Sans', sans-serif",
                      fontSize: 13,
                      fontWeight: 500,
                      color: "var(--text-primary)",
                    }}
                  >
                    {u.username}
                  </div>
                  {u.bio && (
                    <div
                      className="truncate"
                      style={{
                        fontFamily: "'DM Sans', sans-serif",
                        fontSize: 11,
                        color: "var(--text-dim)",
                      }}
                    >
                      {u.bio}
                    </div>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Right side */}
      <div className="flex items-center gap-3 ml-auto shrink-0">
        {user ? (
          <>
            {/* Join Private button */}
            <button
              onClick={onJoinPrivate}
              className="flex items-center gap-1.5 cursor-pointer transition-all shrink-0 whitespace-nowrap"
              style={{
                background: "transparent",
                border: "1px solid var(--border)",
                color: "var(--text-muted)",
                fontFamily: "'DM Sans', sans-serif",
                fontSize: "13px",
                fontWeight: 600,
                padding: "8px 14px",
                borderRadius: "100px",
                minWidth: "fit-content",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "var(--border-hover)";
                e.currentTarget.style.color = "var(--text-primary)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "var(--border)";
                e.currentTarget.style.color = "var(--text-muted)";
              }}
              title="Join a private room with an invite code"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              Join Private
            </button>

            {/* +Create button */}
            <button
              onClick={onCreateRoom}
              className="flex items-center gap-1.5 cursor-pointer transition-all shrink-0 whitespace-nowrap"
              style={{
                background: "var(--accent-blue)",
                border: "1px solid transparent",
                color: "#fff",
                fontFamily: "'DM Sans', sans-serif",
                fontSize: "13px",
                fontWeight: 600,
                padding: "8px 18px",
                borderRadius: "100px",
                minWidth: "fit-content",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--accent-purple-light)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "var(--accent-blue)";
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
              Create
            </button>

            {/* User avatar + dropdown */}
            <div className="relative">
              <button
                onClick={() => setShowDropdown(!showDropdown)}
                className="flex items-center gap-2 cursor-pointer bg-transparent border-none"
              >
                {avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={avatarUrl}
                    alt={displayName}
                    className="w-8 h-8 rounded-full object-cover"
                    style={{ border: "1.5px solid rgba(255,255,255,0.15)" }}
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm"
                    style={{
                      background: "var(--accent-purple)",
                      fontFamily: "'Syne', sans-serif",
                      fontWeight: 700,
                    }}
                  >
                    {displayName[0].toUpperCase()}
                  </div>
                )}
              </button>

              {showDropdown && (
                <div
                  className="absolute right-0 z-[9999]"
                  style={{
                    top: "calc(100% + 10px)",
                    width: "220px",
                    borderRadius: "14px",
                    background: "rgba(18,18,21,0.92)",
                    backdropFilter: "blur(20px) saturate(140%)",
                    border: "1px solid var(--border)",
                    boxShadow: "0 12px 40px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.04)",
                    padding: "6px",
                  }}
                >
                  <div className="px-3 py-2.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                    <p className="text-[13px] font-medium truncate" style={{ color: "var(--text-primary)" }}>{displayName}</p>
                    <p className="text-[11px] truncate" style={{ color: "var(--text-muted)" }}>{user.email}</p>
                  </div>
                  <button
                    onClick={() => {
                      setShowDropdown(false);
                      onOpenProfile(user.id);
                    }}
                    className="w-full text-left flex items-center gap-2.5 cursor-pointer transition-all"
                    style={{
                      padding: "9px 12px",
                      borderRadius: "10px",
                      color: "var(--text-muted)",
                      fontSize: "13px",
                      fontWeight: 500,
                      background: "none",
                      border: "none",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "rgba(255,255,255,0.1)";
                      e.currentTarget.style.color = "var(--text-primary)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "none";
                      e.currentTarget.style.color = "var(--text-muted)";
                    }}
                  >
                    View profile
                  </button>
                  <button
                    onClick={signOut}
                    className="w-full text-left flex items-center gap-2.5 cursor-pointer transition-all"
                    style={{
                      padding: "9px 12px",
                      borderRadius: "10px",
                      color: "var(--text-muted)",
                      fontSize: "13px",
                      fontWeight: 500,
                      background: "none",
                      border: "none",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "rgba(255,255,255,0.1)";
                      e.currentTarget.style.color = "var(--text-primary)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "none";
                      e.currentTarget.style.color = "var(--text-muted)";
                    }}
                  >
                    Sign out
                  </button>
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            <a
              href="/login"
              className="cursor-pointer transition-colors no-underline"
              style={{
                color: "var(--text-muted)",
                fontFamily: "'DM Sans', sans-serif",
                fontSize: "13px",
                fontWeight: 500,
                padding: "6px 10px",
                borderRadius: "6px",
              }}
            >
              Log in
            </a>
            <a
              href="/login"
              className="cursor-pointer transition-all no-underline"
              style={{
                background: "var(--accent-blue)",
                borderRadius: "100px",
                color: "white",
                fontFamily: "'DM Sans', sans-serif",
                fontSize: "13px",
                fontWeight: 600,
                padding: "7px 16px",
              }}
            >
              Sign up
            </a>
          </>
        )}
      </div>
    </nav>
  );
}
