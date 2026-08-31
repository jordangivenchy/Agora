"use client";

/* Sidebar Friends section — data + behaviour. Presentation lives in
   FriendsPanel.tsx (compact card portaled into the sidebar slot, overlay
   portaled over the whole sidebar).

   Friendship = mutual follow (get_friends). The panel shows presence
   (online / in a room via the global presence channel), favorites pinned
   first, per-friend actions (message, favorite, join room), an "Add back"
   strip for people who follow you, and a user search to add new friends. */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase-browser";
import { getPresenceSnapshot, subscribePresence } from "@/lib/presence";
import { useUserMenu } from "../userMenuContext";
import { FriendsCard, FriendsOverlay, type FriendRowModel, type FriendUser } from "./FriendsPanel";
import useEscapeClose from "@/lib/useEscapeClose";
import { displayName } from "@/lib/names";

type FriendRow = FriendUser;

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
  const [closing, setClosing] = useState(false);
  const closeTimer = useRef<number | null>(null);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<FriendRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const presence = useSyncExternalStore(subscribePresence, getPresenceSnapshot, () => getPresenceSnapshot());

  /* Close plays the overlay's exit animation, then unmounts. */
  const close = useCallback(() => {
    if (closeTimer.current !== null) return;
    setClosing(true);
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      setOpen(false);
      setClosing(false);
    }, 170);
  }, []);
  const openOverlay = useCallback(() => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setClosing(false);
    setOpen(true);
  }, []);
  useEffect(
    () => () => {
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    },
    []
  );

  useEscapeClose(open, close);

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
      // room < queue < online < offline, favorites first within each band
      return (favorites.has(f.id) ? 0 : 4) + (p?.room_id ? 0 : p?.queued ? 0.5 : p ? 1 : 2);
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

  const toRow = (f: FriendRow, isFriend: boolean): FriendRowModel => {
    const p = presence.get(f.id);
    return { user: f, online: !!p, roomId: p?.room_id ?? null, queued: !!p?.queued, favorite: favorites.has(f.id), isFriend };
  };
  const onlineRows = filtered.filter((f) => presence.has(f.id)).map((f) => toRow(f, true));
  const offlineRows = filtered.filter((f) => !presence.has(f.id)).map((f) => toRow(f, true));
  const searching = query.trim().length >= 2;

  const overlay =
    open && sidebar
      ? createPortal(
          <FriendsOverlay
            friendCount={friends.length}
            query={query}
            onQueryChange={setQuery}
            onClose={close}
            closing={closing}
            online={onlineRows}
            offline={offlineRows}
            addBack={searching ? [] : followsMe.map((f) => toRow(f, false))}
            results={searchResults.map((f) => toRow(f, false))}
            busyId={busy}
            onMessage={message}
            onAdd={follow}
            onJoin={(roomId) => {
              window.location.href = `/agora/${roomId}`;
            }}
            onMore={(at, u) => openUserMenu(at, { userId: u.id, username: u.username })}
          />,
          sidebar
        )
      : null;

  return (
    <>
      {createPortal(<FriendsCard friends={sorted} onlineCount={onlineCount} onOpen={openOverlay} />, container)}
      {overlay}
    </>
  );
}
