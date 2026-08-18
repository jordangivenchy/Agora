"use client";

/* Sidebar Friends section — real data behind the MVP's friend-directory
   design (header + count, "+" add button, Friend List card with stacked
   avatars, slide-up overlay panel inside the sidebar).

   Friendship = mutual follow (get_friends). The panel shows presence
   (online / in a room via the global presence channel), favorites pinned
   first, per-friend actions (message, favorite, join room), an "Add back"
   strip for people who follow you, and a user search to add new friends. */

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase-browser";
import { getPresenceSnapshot, subscribePresence } from "@/lib/presence";
import { useUserMenu } from "../userMenuContext";
import UserAvatar from "../UserAvatar";
import useEscapeClose from "@/lib/useEscapeClose";
import { displayName } from "@/lib/names";

interface FriendRow {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
}

interface Props {
  container: HTMLElement | null;
  sidebar: HTMLElement | null;
}

export default function FriendsSection({ container, sidebar }: Props) {
  const [supabase] = useState(() => createClient());
  const { openUserMenu } = useUserMenu();
  const [me, setMe] = useState<string | null>(null);
  const [friends, setFriends] = useState<FriendRow[]>([]);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [followsMe, setFollowsMe] = useState<FriendRow[]>([]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<FriendRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const presence = useSyncExternalStore(subscribePresence, getPresenceSnapshot, () => getPresenceSnapshot());

  useEscapeClose(open, () => setOpen(false));

  const load = useCallback(async () => {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id ?? null;
    setMe(uid);
    if (!uid) return;
    const [friendsRes, favRes, followersRes] = await Promise.all([
      supabase.rpc("get_friends"),
      supabase.from("user_favorites").select("favorite_id"),
      supabase
        .from("user_follows")
        .select("follower:users!follower_id(id, username, display_name, avatar_url)")
        .eq("following_id", uid),
    ]);
    const fr = (friendsRes.data ?? []) as FriendRow[];
    setFriends(fr);
    setFavorites(new Set(((favRes.data ?? []) as { favorite_id: string }[]).map((f) => f.favorite_id)));
    const friendIds = new Set(fr.map((f) => f.id));
    setFollowsMe(
      ((followersRes.data ?? []) as unknown as { follower: FriendRow | null }[])
        .map((r) => r.follower)
        .filter((u): u is FriendRow => !!u && !friendIds.has(u.id))
    );
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (open) load();
  }, [open, load]);

  /* Add-friend search (any user, friends filtered out). */
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2 || !me) {
      setSearchResults([]);
      return;
    }
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from("users")
        .select("id, username, display_name, avatar_url")
        .ilike("username", `${q}%`)
        .neq("id", me)
        .limit(6);
      const friendIds = new Set(friends.map((f) => f.id));
      setSearchResults(((data ?? []) as FriendRow[]).filter((u) => !friendIds.has(u.id)));
    }, 250);
    return () => clearTimeout(t);
  }, [query, me, friends, supabase]);

  const follow = useCallback(
    async (u: FriendRow) => {
      setBusy(u.id);
      await supabase.rpc("follow_user", { p_target: u.id });
      setBusy(null);
      setQuery("");
      load();
    },
    [supabase, load]
  );



  const message = (u: FriendRow) =>
    window.dispatchEvent(new CustomEvent("agora:dm", { detail: { userId: u.id, username: u.username } }));

  const sorted = useMemo(() => {
    const rank = (f: FriendRow) => {
      const p = presence.get(f.id);
      return (favorites.has(f.id) ? 0 : 4) + (p?.room_id ? 0 : p ? 1 : 2);
    };
    return [...friends].sort((a, b) => rank(a) - rank(b) || displayName(a).localeCompare(displayName(b)));
  }, [friends, favorites, presence]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter(
      (f) => f.username.toLowerCase().includes(q) || displayName(f).toLowerCase().includes(q)
    );
  }, [sorted, query]);

  const onlineCount = friends.filter((f) => presence.has(f.id)).length;

  if (!container || !me) return null;

  const card = (
    <>
      <div className="friends-header">
        <h4 className="friends-title">
          Friends <span className="friends-count">{onlineCount}</span>
        </h4>
        <button className="friends-add-btn" title="Add friend" onClick={() => setOpen(true)}>
          +
        </button>
      </div>
      <div className="friend-directory-bar" onClick={() => setOpen(true)}>
        <div className="friend-directory-icon">👥</div>
        <div className="friend-directory-info">
          <span className="friend-directory-title">Friend List</span>
          <span className="friend-directory-sub">
            {friends.length} Friend{friends.length === 1 ? "" : "s"}
          </span>
        </div>
        <div className="friend-directory-avatars">
          {sorted.slice(0, 3).map((f) => (
            <div key={f.id} className="mini-avatar" style={{ overflow: "hidden", background: "#1c2430" }}>
              <UserAvatar size={26} username={f.username} avatarUrl={f.avatar_url} seed={f.id} />
            </div>
          ))}
        </div>
      </div>
    </>
  );

  const friendRow = (f: FriendRow, isFriend: boolean) => {
    const p = presence.get(f.id);
    const online = !!p;
    const inRoom = p?.room_id ?? null;
    return (
      <div key={f.id} className="friend-item">
        <div
          className="friend-avatar-wrap"
          style={{ cursor: "pointer" }}
          onClick={(e) => openUserMenu({ x: e.clientX, y: e.clientY }, { userId: f.id, username: f.username })}
        >
          <div className="friend-avatar" style={{ overflow: "hidden", background: "#1c2430" }}>
            <UserAvatar size={36} username={f.username} avatarUrl={f.avatar_url} seed={f.id} />
          </div>
          {online && <div className="friend-online-dot" />}
        </div>
        <div className="friend-info" style={{ minWidth: 0 }}>
          <span
            className="friend-name"
            style={{ cursor: "pointer" }}
            onClick={(e) => openUserMenu({ x: e.clientX, y: e.clientY }, { userId: f.id, username: f.username })}
          >
            {displayName(f)}
            {favorites.has(f.id) && <span style={{ marginLeft: 4 }}>⭐</span>}
          </span>
          <span className={`friend-status${online ? " online" : ""}`}>
            {online && (
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "#22c55e",
                  display: "inline-block",
                  flexShrink: 0,
                  marginRight: 4,
                }}
              />
            )}
            {inRoom ? "In a room" : online ? "Online" : "Offline"}
          </span>
        </div>
        <div style={{ display: "flex", gap: 5, alignItems: "center", flexShrink: 0 }}>
          {isFriend ? (
            <>
              {inRoom && (
                <button
                  className="friend-action-btn friend-action-btn--join"
                  title="Join their room"
                  onClick={() => {
                    window.location.href = `/agora/${inRoom}`;
                  }}
                >
                  Join
                </button>
              )}
              <button className="friend-action-btn" title="Message" onClick={() => message(f)}>
                💬
              </button>
            </>
          ) : (
            <button
              className="friend-action-btn friend-action-btn--join"
              disabled={busy === f.id}
              onClick={() => follow(f)}
            >
              Add
            </button>
          )}
        </div>
      </div>
    );
  };

  const overlay =
    open && sidebar
      ? createPortal(
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(10, 10, 18, 0.97)",
              backdropFilter: "blur(20px)",
              WebkitBackdropFilter: "blur(20px)",
              borderRadius: 14,
              zIndex: 200,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            <div className="friend-overlay-header">
              <h2 className="friend-overlay-title">
                Friend List <span className="friend-overlay-count">{friends.length}</span>
              </h2>
              <button
                onClick={() => setOpen(false)}
                style={{ background: "none", border: "none", color: "rgba(255,255,255,0.6)", cursor: "pointer", fontSize: 15 }}
              >
                ✕
              </button>
            </div>
            <div className="friend-search-wrap">
              <span className="friend-search-icon">🔍</span>
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search friends or add by username…"
                className="friend-search-input"
                autoFocus
              />
            </div>
            <div className="friend-overlay-list" style={{ flex: 1, overflowY: "auto" }}>
              {filtered.map((f) => friendRow(f, true))}
              {filtered.length === 0 && query.trim().length < 2 && (
                <p style={{ color: "#8b8b94", fontSize: 12, textAlign: "center", padding: "18px 12px" }}>
                  No friends yet — search a username above to add one.
                </p>
              )}

              {followsMe.length > 0 && query.trim().length < 2 && (
                <>
                  <p className="friend-list-divider">Follows you — add back</p>
                  {followsMe.map((f) => friendRow(f, false))}
                </>
              )}

              {searchResults.length > 0 && (
                <>
                  <p className="friend-list-divider">Add friend</p>
                  {searchResults.map((f) => friendRow(f, false))}
                </>
              )}
            </div>
          </div>,
          sidebar
        )
      : null;

  return (
    <>
      {createPortal(card, container)}
      {overlay}
    </>
  );
}
