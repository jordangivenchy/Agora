"use client";

/* /messages — the full-page messaging surface. Conversation rail on the
   left (DMs and group chats in one list, newest activity first), the
   open thread on the right — the shared DmThread for a person, the
   GroupThread for a group — on the same starfield glass as the dock
   (which suppresses itself on this route). Deep links land at
   /messages/<username> and /messages/g/<chat id>; picking a thread keeps
   the URL in step via replaceState. Narrow viewports collapse to a
   single pane. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { Icon } from "@/components/icons";
import UserAvatar from "@/components/UserAvatar";
import useEscapeClose from "@/lib/useEscapeClose";
import { displayName } from "@/lib/names";
import { pathFor } from "@/lib/routes";
import DmThread, {
  type DmThreadHandle,
  type Peer,
  type Thread,
  relTime,
  YELLOW,
  YELLOW_INK,
} from "./DmThread";
import GroupThread from "./GroupThread";
import GroupTile from "./GroupTile";
import NewGroupModal from "./NewGroupModal";
import { groupPreview, type GroupRow } from "./groups";

const WIDE_MIN = 900;

type RailItem = { kind: "dm"; at: string; t: Thread } | { kind: "group"; at: string; g: GroupRow };

export default function MessagesPage({
  initialUsername,
  initialGroupId,
}: {
  initialUsername?: string;
  initialGroupId?: string;
}) {
  const [supabase] = useState(() => createClient());
  const [me, setMe] = useState<string | null | undefined>(undefined); // undefined = loading
  const [wide, setWide] = useState(true);
  const [threads, setThreads] = useState<Thread[] | null>(null);
  const [groups, setGroups] = useState<GroupRow[] | null>(null);
  const [search, setSearch] = useState("");
  const [peer, setPeer] = useState<Peer | null>(null);
  const [group, setGroup] = useState<GroupRow | null>(null);
  const [newGroup, setNewGroup] = useState(false);
  const peerRef = useRef<Peer | null>(null);
  peerRef.current = peer;
  const groupRef = useRef<GroupRow | null>(null);
  groupRef.current = group;
  const threadRef = useRef<DmThreadHandle>(null);
  const groupThreadRef = useRef<DmThreadHandle>(null);
  const deepLinkedRef = useRef(false);

  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${WIDE_MIN}px)`);
    const apply = () => setWide(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setMe(data.user?.id ?? null));
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_e, s) => setMe(s?.user?.id ?? null));
    return () => subscription.unsubscribe();
  }, [supabase]);

  const loadThreads = useCallback(async () => {
    const { data } = await supabase.rpc("get_dm_threads");
    const ts = (data ?? []) as Thread[];
    setThreads(ts);
    return ts;
  }, [supabase]);

  /* Groups refresh the open one too (name, members) — and drop it when
     it's gone (left elsewhere, removed, last member out). */
  const loadGroups = useCallback(async () => {
    const { data } = await supabase.rpc("get_group_threads");
    const gs = (data ?? []) as GroupRow[];
    setGroups(gs);
    const open = groupRef.current;
    if (open) {
      const fresh = gs.find((g) => g.chat_id === open.chat_id);
      if (fresh) {
        if (fresh.name !== open.name || fresh.member_count !== open.member_count) {
          groupRef.current = fresh;
          setGroup(fresh);
        }
      } else {
        groupRef.current = null;
        setGroup(null);
        window.history.replaceState(null, "", pathFor.messages());
      }
    }
    return gs;
  }, [supabase]);

  const loadAll = useCallback(() => {
    void loadThreads();
    void loadGroups();
  }, [loadThreads, loadGroups]);

  const selectPeer = useCallback((p: Peer | null) => {
    peerRef.current = p;
    groupRef.current = null;
    setGroup(null);
    setPeer(p);
    window.history.replaceState(null, "", p ? pathFor.messages(p.username) : pathFor.messages());
  }, []);

  const selectGroup = useCallback((g: GroupRow | null) => {
    groupRef.current = g;
    peerRef.current = null;
    setPeer(null);
    setGroup(g);
    window.history.replaceState(null, "", g ? pathFor.messagesGroup(g.chat_id) : pathFor.messages());
  }, []);

  const open = !!peer || !!group;
  useEscapeClose(open, () => {
    const handle = group ? groupThreadRef.current : threadRef.current;
    if (handle?.consumeEscape()) return;
    if (!wide) {
      if (group) selectGroup(null);
      else selectPeer(null);
    }
  });

  /* Phones: while a thread is open the tab bar tucks away and the thread
     takes the full height (globals.css phone block, html.msgs-thread-open). */
  useEffect(() => {
    document.documentElement.classList.toggle("msgs-thread-open", open && !wide);
    return () => document.documentElement.classList.remove("msgs-thread-open");
  }, [open, wide]);

  /* Boot: load both lists, then honor the deep link (or land on the
     newest conversation in wide mode, like the dock does). */
  useEffect(() => {
    if (!me) return;
    (async () => {
      const [ts, gs] = await Promise.all([loadThreads(), loadGroups()]);
      if (deepLinkedRef.current || peerRef.current || groupRef.current) return;
      deepLinkedRef.current = true;
      /* Trust the live URL over the route param: a Back-restored history
         entry can replay a stale Next tree while the address bar already
         shows where the user really was. */
      const path = window.location.pathname;
      let targetGroup = initialGroupId ?? null;
      let target = initialUsername ?? null;
      const urlGroup = /^\/messages\/g\/([^/]+)/.exec(path)?.[1];
      const urlUser = urlGroup ? null : /^\/messages\/([^/]+)/.exec(path)?.[1];
      if (urlGroup) {
        targetGroup = decodeURIComponent(urlGroup);
        target = null;
      } else if (urlUser) {
        targetGroup = null;
        try {
          target = decodeURIComponent(urlUser);
        } catch {
          target = urlUser;
        }
      }
      if (targetGroup) {
        const g = gs.find((x) => x.chat_id === targetGroup);
        if (g) selectGroup(g);
        /* Unknown group (not a member): leave the rail on its placeholder. */
        return;
      }
      if (target) {
        const uname = target.toLowerCase();
        const t = ts.find((x) => x.peer_username.toLowerCase() === uname);
        if (t) {
          selectPeer({
            id: t.peer_id,
            username: t.peer_username,
            display_name: t.peer_display_name ?? null,
            avatarUrl: t.peer_avatar_url,
          });
          return;
        }
        const { data } = await supabase
          .from("users")
          .select("id, username, display_name, avatar_url")
          .ilike("username", uname.replace(/[\\%_]/g, "\\$&"))
          .maybeSingle();
        if (data) {
          const u = data as { id: string; username: string; display_name: string | null; avatar_url: string | null };
          selectPeer({ id: u.id, username: u.username, display_name: u.display_name, avatarUrl: u.avatar_url });
        }
        /* Unknown user: leave the rail on its placeholder rather than
           silently opening someone else's conversation. */
        return;
      }
      if (!window.matchMedia(`(min-width: ${WIDE_MIN}px)`).matches) return;
      const t = ts[0];
      const g = gs[0];
      if (g && (!t || g.last_at > t.last_at)) {
        selectGroup(g);
      } else if (t) {
        selectPeer({
          id: t.peer_id,
          username: t.peer_username,
          display_name: t.peer_display_name ?? null,
          avatarUrl: t.peer_avatar_url,
        });
      }
    })();
  }, [me, initialUsername, initialGroupId, loadThreads, loadGroups, selectPeer, selectGroup, supabase]);

  /* "Message" buttons anywhere on this page route land here, not in the
     suppressed dock. */
  useEffect(() => {
    const onDm = (e: Event) => {
      const d = (e as CustomEvent).detail as { userId: string; username: string; avatarUrl?: string | null };
      if (!d?.userId) return;
      selectPeer({ id: d.userId, username: d.username, avatarUrl: d.avatarUrl ?? null });
    };
    window.addEventListener("agora:dm", onDm);
    return () => window.removeEventListener("agora:dm", onDm);
  }, [selectPeer]);

  /* Thread-list freshness (per-thread realtime lives inside the thread
     views; unique topic — the browser client is a shared singleton).
     Group inserts arrive unfiltered: RLS only streams my groups' rows. */
  useEffect(() => {
    if (!me) return;
    const channel = supabase
      .channel("dm-page-inbox")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "direct_messages", filter: `recipient_id=eq.${me}` },
        () => {
          loadThreads();
        }
      )
      .on(
        "postgres_changes",
        /* Unsend anywhere refreshes previews (DELETE events can't be
           filtered; get_dm_threads is cheap). */
        { event: "DELETE", schema: "public", table: "direct_messages" },
        () => {
          loadThreads();
        }
      )
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "group_messages" }, () => {
        loadGroups();
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "group_messages" }, () => {
        loadGroups();
      })
      .on(
        "postgres_changes",
        /* Someone added me to a group. */
        { event: "INSERT", schema: "public", table: "group_chat_members", filter: `user_id=eq.${me}` },
        () => {
          loadGroups();
        }
      )
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "group_chat_members" }, () => {
        loadGroups();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [me, supabase, loadThreads, loadGroups]);

  const q = search.trim().toLowerCase();
  const items = useMemo<RailItem[]>(() => {
    const dms: RailItem[] = (threads ?? [])
      .filter(
        (t) =>
          !q ||
          t.peer_username.toLowerCase().includes(q) ||
          (t.peer_display_name ?? "").toLowerCase().includes(q)
      )
      .map((t) => ({ kind: "dm", at: t.last_at, t }));
    const gs: RailItem[] = (groups ?? [])
      .filter(
        (g) =>
          !q ||
          g.name.toLowerCase().includes(q) ||
          g.members.some(
            (m) => m.username.toLowerCase().includes(q) || (m.display_name ?? "").toLowerCase().includes(q)
          )
      )
      .map((g) => ({ kind: "group", at: g.last_at, g }));
    return [...dms, ...gs].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  }, [threads, groups, q]);
  const loaded = threads !== null && groups !== null;
  const total = (threads?.length ?? 0) + (groups?.length ?? 0);

  if (me === undefined) return null;
  if (me === null) {
    return (
      <div className="messages-beside-sidebar" style={{ paddingTop: 28 }}>
        <div style={{ textAlign: "center", padding: "80px 24px" }}>
          <p style={{ color: "#c9c9d4", fontSize: 14, margin: "0 0 14px" }}>Sign in to see your messages.</p>
          <a
            href="/login"
            className="no-underline"
            style={{
              display: "inline-block",
              padding: "8px 18px",
              borderRadius: 999,
              background: YELLOW,
              color: YELLOW_INK,
              fontWeight: 700,
              fontSize: 13,
              textDecoration: "none",
            }}
          >
            Sign in
          </a>
        </div>
      </div>
    );
  }

  /* The open conversation is a solid yellow block with dark ink — no
     tint, no accent border. */
  const rowStyle = (active: boolean): React.CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 11,
    padding: "11px 14px",
    cursor: "pointer",
    borderBottom: active ? `1px solid ${YELLOW}` : "1px solid rgba(255,255,255,0.04)",
    background: active ? YELLOW : "transparent",
    borderLeft: "2px solid transparent",
  });
  const nameInk = (active: boolean) => (active ? YELLOW_INK : "#f5f5f0");
  const metaInk = (active: boolean, unread: number) =>
    active ? "rgba(26,14,0,0.72)" : unread > 0 ? "#c9c9d4" : "#8b8b94";
  const timeInk = (active: boolean) => (active ? "rgba(26,14,0,0.7)" : "#6f6f7a");

  const unreadBadge = (n: number, active: boolean) =>
    n > 0 && (
      <span
        style={{
          background: active ? YELLOW_INK : YELLOW,
          color: active ? YELLOW : YELLOW_INK,
          borderRadius: 999,
          fontSize: 10.5,
          fontWeight: 700,
          minWidth: 18,
          height: 18,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "0 5px",
        }}
      >
        {n}
      </span>
    );

  const rail = (
    <div
      className="msgs-rail-pane"
      style={{
        width: wide ? 340 : "100%",
        flexShrink: 0,
        borderRight: wide ? "1px solid rgba(255,255,255,0.08)" : "none",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
      }}
    >
      <div style={{ padding: "14px 16px 10px", borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "0 0 10px" }}>
          <h1
            style={{
              margin: 0,
              color: "#f5f5f0",
              fontWeight: 700,
              fontSize: 17,
              fontFamily: "'Space Grotesk', sans-serif",
            }}
          >
            Messages
          </h1>
          <button
            type="button"
            onClick={() => setNewGroup(true)}
            aria-label="New group chat"
            title="New group"
            className="cursor-pointer"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              height: 30,
              padding: "0 11px",
              borderRadius: 999,
              background: "#0b0b0d",
              border: "1px solid rgba(255,255,255,0.14)",
              color: "#c9c9d2",
              fontSize: 12,
              fontWeight: 700,
              fontFamily: "inherit",
            }}
          >
            <Icon name="users" size={13} /> New group
          </button>
        </div>
        <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
          <span
            style={{
              position: "absolute",
              left: 10,
              display: "inline-flex",
              alignItems: "center",
              color: "rgba(255,255,255,0.4)",
              pointerEvents: "none",
            }}
          >
            <Icon name="search" size={13} />
          </span>
          <input className="msg-rail-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search conversations"
            aria-label="Search conversations"
            style={{
              width: "100%",
              boxSizing: "border-box",
              height: 32,
              borderRadius: 9,
              border: "1px solid rgba(255,255,255,0.1)",
              background: "rgba(255,255,255,0.05)",
              color: "white",
              fontSize: 12.5,
              padding: "0 10px 0 30px",
              outline: "none",
              fontFamily: "inherit",
            }}
          />
        </div>
      </div>
      <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
        {loaded && total === 0 && (
          <p style={{ color: "#8b8b94", fontSize: 12.5, textAlign: "center", padding: "32px 20px", lineHeight: 1.5 }}>
            No conversations yet. Open a friend&apos;s profile and hit <b>Message</b>, or start a group with{" "}
            <b>New group</b>.
          </p>
        )}
        {loaded && total > 0 && items.length === 0 && (
          <p style={{ color: "#8b8b94", fontSize: 12.5, textAlign: "center", padding: "28px 18px" }}>No matches.</p>
        )}
        {items.map((it) => {
          if (it.kind === "group") {
            const g = it.g;
            const active = group?.chat_id === g.chat_id;
            return (
              <div
                key={`g-${g.chat_id}`}
                onClick={() => {
                  if (!active) selectGroup(g);
                }}
                style={rowStyle(active)}
              >
                <GroupTile members={g.members} size={44} ring={active ? YELLOW : "#0b0b0d"} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                    <p
                      style={{
                        margin: 0,
                        flex: 1,
                        minWidth: 0,
                        color: nameInk(active),
                        fontSize: 14.5,
                        fontWeight: g.unread > 0 ? 700 : 500,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {g.name}
                    </p>
                    <span style={{ color: timeInk(active), fontSize: 11, flexShrink: 0 }}>{relTime(g.last_at)}</span>
                  </div>
                  <p
                    style={{
                      margin: 0,
                      color: metaInk(active, g.unread),
                      fontSize: 13,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {groupPreview(g)}
                  </p>
                </div>
                {unreadBadge(g.unread, active)}
              </div>
            );
          }
          const t = it.t;
          const active = peer?.id === t.peer_id;
          return (
            <div
              key={t.peer_id}
              onClick={() => {
                if (active) return;
                selectPeer({
                  id: t.peer_id,
                  username: t.peer_username,
                  display_name: t.peer_display_name ?? null,
                  avatarUrl: t.peer_avatar_url,
                });
              }}
              style={rowStyle(active)}
            >
              <UserAvatar size={44} username={t.peer_username} avatarUrl={t.peer_avatar_url} seed={t.peer_id} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                  <p
                    style={{
                      margin: 0,
                      flex: 1,
                      minWidth: 0,
                      color: nameInk(active),
                      fontSize: 14.5,
                      fontWeight: t.unread > 0 ? 700 : 500,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {displayName({ display_name: t.peer_display_name, username: t.peer_username })}
                  </p>
                  <span style={{ color: timeInk(active), fontSize: 11, flexShrink: 0 }}>{relTime(t.last_at)}</span>
                </div>
                <p
                  style={{
                    margin: 0,
                    color: metaInk(active, t.unread),
                    fontSize: 13,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {t.last_from_me ? "You: " : ""}
                  {t.last_content}
                </p>
              </div>
              {unreadBadge(t.unread, active)}
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    /* Top and bottom edges sit level with the sidebar rail (nav + 6px,
       and 12px off the bottom of the viewport — .sidebar in mvp-home.css). */
    <main className="messages-beside-sidebar" style={{ paddingTop: 6, paddingBottom: 12 }}>
      <div
        className="msgs-shell"
        style={{
          display: "flex",
          height: "calc(100vh - var(--nav-height, 60px) - 18px)",
          minHeight: 420,
          borderRadius: 18,
          /* Same starfield glass as the dock/friends panel. */
          background: "rgba(9,10,14,0.45)",
          border: "1px solid rgba(255,255,255,0.1)",
          overflow: "hidden",
          fontFamily: "'DM Sans', sans-serif",
        }}
      >
        {(wide || !open) && rail}
        {group ? (
          <div className="msgs-thread-pane" style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex" }}>
            <GroupThread
              ref={groupThreadRef}
              me={me}
              chat={group}
              topic="page"
              onBack={wide ? undefined : () => selectGroup(null)}
              onThreadsChanged={loadAll}
              onLeft={() => {
                selectGroup(null);
                void loadGroups();
              }}
            />
          </div>
        ) : peer ? (
          /* The wrapper is the phone slide-in surface (globals.css
             .msgs-thread-pane); it mounts with the thread. */
          <div className="msgs-thread-pane" style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex" }}>
            <DmThread
              ref={threadRef}
              me={me}
              peer={peer}
              variant="page"
              topic="page"
              onBack={wide ? undefined : () => selectPeer(null)}
              onThreadsChanged={loadThreads}
            />
          </div>
        ) : (
          wide && (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <p style={{ color: "#8b8b94", fontSize: 13, textAlign: "center", padding: 24 }}>
                {loaded && total === 0 ? "Your conversations will show up here." : "Pick a conversation."}
              </p>
            </div>
          )
        )}
      </div>
      {newGroup && (
        <NewGroupModal
          onClose={() => setNewGroup(false)}
          onCreated={(chatId) => {
            setNewGroup(false);
            loadGroups().then((gs) => {
              const g = gs.find((x) => x.chat_id === chatId);
              if (g) selectGroup(g);
            });
          }}
        />
      )}
    </main>
  );
}
