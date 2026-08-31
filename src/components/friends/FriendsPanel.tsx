"use client";

/* Presentation for the sidebar Friends UI — the compact sidebar card and the
   full overlay. Pure: everything comes in via props so FriendsSection (data)
   and dev scratch pages can drive it. Styles are inline, on the MessagesDock
   / profile-menu palette; hover states live in globals.css under
   `.friends-ui-*`. */

import type { CSSProperties, MouseEvent, ReactNode } from "react";
import { Icon } from "@/components/icons";
import UserAvatar from "../UserAvatar";
import { displayName } from "@/lib/names";

export interface FriendUser {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
}

export interface FriendRowModel {
  user: FriendUser;
  online: boolean;
  roomId: string | null;
  /** Waiting in a debate queue (distinct from being in a room). */
  queued: boolean;
  favorite: boolean;
  /** Friends get message (or Join when in a room) + ⋯; others get the gold "Add" pill. */
  isFriend: boolean;
}

export const FRIENDS_UI = {
  /* A light unblurred tint over the rail's own glass: the starfield stays
     visible through the panel (blur would smear the stars away). The
     sidebar content beneath fades out while the overlay is open —
     `.friends-overlay-open` in globals.css. */
  panelBg: "rgba(9,10,14,0.35)",
  /* Solid stand-in where a translucent ring would look broken (dot ring). */
  panelBgSolid: "#10131b",
  border: "1px solid rgba(255,255,255,0.10)",
  text: "#f5f5f0",
  secondary: "#8b8b94",
  muted: "#6b6b74",
  gold: "#e2b96b",
  green: "#22c55e",
  live: "#e05a5a",
  body: "'DM Sans', system-ui, sans-serif",
  title: "'Space Grotesk', 'DM Sans', system-ui, sans-serif",
} as const;

const iconBtn: CSSProperties = {
  width: 24,
  height: 24,
  borderRadius: "50%",
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(255,255,255,0.05)",
  color: FRIENDS_UI.text,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  padding: 0,
  flexShrink: 0,
};

const pill: CSSProperties = {
  height: 22,
  padding: "0 9px",
  borderRadius: 999,
  border: "none",
  background: FRIENDS_UI.gold,
  color: "#14110a",
  fontFamily: FRIENDS_UI.body,
  fontWeight: 700,
  fontSize: 11.5,
  letterSpacing: 0.2,
  cursor: "pointer",
  flexShrink: 0,
};

/* ─── Sidebar card ─── */

export function FriendsCard({
  friends,
  onlineCount,
  onOpen,
}: {
  friends: FriendUser[];
  onlineCount: number;
  onOpen: () => void;
}) {
  const total = friends.length;
  return (
    <button
      type="button"
      className="friends-ui-card"
      onClick={onOpen}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        width: "calc(100% - 24px)",
        margin: "0 12px",
        padding: "8px 8px 8px 9px",
        borderRadius: 12,
        border: FRIENDS_UI.border,
        background: "rgba(255,255,255,0.03)",
        color: FRIENDS_UI.text,
        cursor: "pointer",
        textAlign: "left",
        fontFamily: FRIENDS_UI.body,
        boxSizing: "border-box",
      }}
    >
      <span
        style={{
          width: 32,
          height: 32,
          borderRadius: 9,
          background: "rgba(226,185,107,0.12)",
          color: FRIENDS_UI.gold,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <Icon name="users" size={16} />
      </span>
      <span style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1, gap: 1 }}>
        <span style={{ fontFamily: FRIENDS_UI.title, fontWeight: 700, fontSize: 13, lineHeight: "16px" }}>
          Friends
        </span>
        <span style={{ fontSize: 10.5, color: FRIENDS_UI.secondary, lineHeight: "14px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {total === 0 ? (
            "Find friends"
          ) : (
            <>
              <span style={{ color: onlineCount ? FRIENDS_UI.green : FRIENDS_UI.secondary }}>{onlineCount} online</span>
              {" · "}
              {total} friend{total === 1 ? "" : "s"}
            </>
          )}
        </span>
      </span>
      {total > 0 && (
        <span style={{ display: "flex", flexShrink: 0 }}>
          {friends.slice(0, 3).map((f, i) => (
            <span
              key={f.id}
              style={{
                width: 26,
                height: 26,
                borderRadius: "50%",
                overflow: "hidden",
                background: "#1c2430",
                boxShadow: "0 0 0 1.5px #0f1117",
                marginLeft: i === 0 ? 0 : -9,
                position: "relative",
                zIndex: 3 - i,
                display: "block",
              }}
            >
              <UserAvatar size={26} username={f.username} avatarUrl={f.avatar_url} seed={f.id} />
            </span>
          ))}
        </span>
      )}
      <span style={{ color: FRIENDS_UI.muted, display: "inline-flex", flexShrink: 0 }}>
        <Icon name="chevron-right" size={14} />
      </span>
    </button>
  );
}

/* ─── Overlay ─── */

export interface FriendsOverlayProps {
  friendCount: number;
  query: string;
  onQueryChange: (q: string) => void;
  onClose: () => void;
  online: FriendRowModel[];
  offline: FriendRowModel[];
  addBack: FriendRowModel[];
  results: FriendRowModel[];
  busyId: string | null;
  onMessage: (u: FriendUser) => void;
  onAdd: (u: FriendUser) => void;
  onJoin: (roomId: string) => void;
  onMore: (at: { x: number; y: number }, u: FriendUser) => void;
  /** True while the exit animation plays; the parent unmounts after it. */
  closing?: boolean;
  /** position: "absolute" inset 0 by default; scratch pages can override. */
  style?: CSSProperties;
}

function SectionLabel({ children }: { children: string }) {
  return (
    <div
      style={{
        padding: "12px 14px 5px",
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: 1,
        textTransform: "uppercase",
        color: FRIENDS_UI.muted,
        fontFamily: FRIENDS_UI.body,
      }}
    >
      {children}
    </div>
  );
}

function EmptyHint({ children }: { children: ReactNode }) {
  return (
    <p style={{ margin: 0, padding: "4px 14px 8px", fontSize: 11.5, color: FRIENDS_UI.muted, lineHeight: 1.45 }}>
      {children}
    </p>
  );
}

function Dot({ color, size = 6 }: { color: string; size?: number }) {
  return (
    <span
      style={{ width: size, height: size, borderRadius: "50%", background: color, display: "inline-block", flexShrink: 0 }}
    />
  );
}

export function FriendRow({
  row,
  busy,
  onMessage,
  onAdd,
  onJoin,
  onMore,
}: {
  row: FriendRowModel;
  busy: boolean;
  onMessage: (u: FriendUser) => void;
  onAdd: (u: FriendUser) => void;
  onJoin: (roomId: string) => void;
  onMore: (at: { x: number; y: number }, u: FriendUser) => void;
}) {
  const { user, online, roomId, queued, favorite, isFriend } = row;
  const href = `/users/${user.username}`;
  const openMore = (e: MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    onMore({ x: r.left, y: r.bottom + 4 }, user);
  };
  return (
    <div
      className="friends-ui-row"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 9,
        padding: "6px 8px",
        margin: "0 4px",
        borderRadius: 10,
        fontFamily: FRIENDS_UI.body,
      }}
    >
      <a href={href} style={{ position: "relative", flexShrink: 0, display: "block", width: 44, height: 44 }}>
        <span style={{ display: "block", width: 44, height: 44, borderRadius: "50%", overflow: "hidden", background: "#1c2430" }}>
          <UserAvatar size={44} username={user.username} avatarUrl={user.avatar_url} seed={user.id} />
        </span>
        {online && (
          <span
            style={{
              position: "absolute",
              right: 0,
              bottom: 0,
              width: 11,
              height: 11,
              borderRadius: "50%",
              background: FRIENDS_UI.green,
              boxShadow: `0 0 0 2px ${FRIENDS_UI.panelBgSolid}`,
            }}
          />
        )}
      </a>
      <div style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1, gap: 2 }}>
        <a
          href={href}
          className="friends-ui-name"
          style={{
            color: FRIENDS_UI.text,
            fontSize: 13,
            fontWeight: 600,
            lineHeight: "16px",
            textDecoration: "none",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            maxWidth: "100%",
          }}
        >
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{displayName(user)}</span>
          {favorite && (
            <Icon name="star" size={11} style={{ color: FRIENDS_UI.gold, fill: "currentColor", flexShrink: 0 }} />
          )}
        </a>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            fontSize: 11,
            lineHeight: "13px",
            whiteSpace: "nowrap",
            color: roomId ? FRIENDS_UI.live : queued ? FRIENDS_UI.gold : online ? FRIENDS_UI.secondary : FRIENDS_UI.muted,
            fontWeight: roomId || queued ? 600 : 400,
          }}
        >
          {roomId ? (
            <>
              <Dot color={FRIENDS_UI.live} size={5} />
              In a room
            </>
          ) : queued ? (
            <>
              <Dot color={FRIENDS_UI.gold} size={5} />
              In queue
            </>
          ) : online ? (
            <>
              <Dot color={FRIENDS_UI.green} />
              Online
            </>
          ) : (
            "Offline"
          )}
        </span>
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
        {isFriend ? (
          <>
            {roomId ? (
              <button type="button" className="friends-ui-pill" style={pill} title="Join their room" onClick={() => onJoin(roomId)}>
                Join
              </button>
            ) : (
              <button type="button" className="friends-ui-iconbtn" style={iconBtn} title="Message" aria-label="Message" onClick={() => onMessage(user)}>
                <Icon name="message-circle" size={12} />
              </button>
            )}
            <button type="button" className="friends-ui-iconbtn" style={iconBtn} title="More" aria-label="More options" onClick={openMore}>
              <Icon name="more-horizontal" size={13} />
            </button>
          </>
        ) : (
          <button
            type="button"
            className="friends-ui-pill"
            style={{ ...pill, opacity: busy ? 0.55 : 1, cursor: busy ? "default" : "pointer" }}
            disabled={busy}
            onClick={() => onAdd(user)}
          >
            {busy ? "Adding…" : "Add"}
          </button>
        )}
      </div>
    </div>
  );
}

export function FriendsOverlay(p: FriendsOverlayProps) {
  const searching = p.query.trim().length >= 2;
  const rowProps = { onMessage: p.onMessage, onAdd: p.onAdd, onJoin: p.onJoin, onMore: p.onMore };
  const list = (rows: FriendRowModel[]) =>
    rows.map((r) => <FriendRow key={r.user.id} row={r} busy={p.busyId === r.user.id} {...rowProps} />);
  const nothingAtAll = p.friendCount === 0 && p.addBack.length === 0 && !searching;

  return (
    <div
      role="dialog"
      aria-label="Friends"
      className={`friends-ui-overlay${p.closing ? " friends-ui-overlay-closing" : ""}`}
      style={{
        position: "absolute",
        inset: 0,
        background: FRIENDS_UI.panelBg,
        borderRadius: 18,
        zIndex: 200,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        color: FRIENDS_UI.text,
        fontFamily: FRIENDS_UI.body,
        ...p.style,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "12px 10px 10px 14px",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          flexShrink: 0,
        }}
      >
        <h2 style={{ margin: 0, fontFamily: FRIENDS_UI.title, fontWeight: 700, fontSize: 15, lineHeight: "20px", flex: 1, display: "flex", alignItems: "center", gap: 8 }}>
          Friends
          <span
            style={{
              fontFamily: FRIENDS_UI.body,
              fontSize: 10.5,
              fontWeight: 700,
              lineHeight: "18px",
              padding: "0 7px",
              borderRadius: 999,
              background: "rgba(255,255,255,0.08)",
              color: FRIENDS_UI.secondary,
            }}
          >
            {p.friendCount}
          </span>
        </h2>
        <button type="button" className="friends-ui-iconbtn" style={iconBtn} aria-label="Close" onClick={p.onClose}>
          <Icon name="x" size={14} />
        </button>
      </div>

      {/* Search — mirrors the DM dock field */}
      <div style={{ padding: "8px 10px", borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0 }}>
        <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
          <span style={{ position: "absolute", left: 9, display: "inline-flex", alignItems: "center", color: "rgba(255,255,255,0.4)", pointerEvents: "none" }}>
            <Icon name="search" size={13} />
          </span>
          <input
            value={p.query}
            onChange={(e) => p.onQueryChange(e.target.value)}
            placeholder="Search friends or add by username"
            aria-label="Search friends"
            autoFocus
            style={{
              width: "100%",
              boxSizing: "border-box",
              height: 30,
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.1)",
              background: "rgba(255,255,255,0.05)",
              color: "white",
              fontSize: 12.5,
              lineHeight: "28px",
              padding: p.query ? "0 28px 0 28px" : "0 10px 0 28px",
              outline: "none",
              fontFamily: "inherit",
            }}
          />
          {p.query && (
            <button
              type="button"
              onClick={() => p.onQueryChange("")}
              aria-label="Clear search"
              style={{ position: "absolute", right: 4, width: 22, height: 22, display: "inline-flex", alignItems: "center", justifyContent: "center", border: "none", background: "none", color: "rgba(255,255,255,0.5)", cursor: "pointer", padding: 0, borderRadius: 6 }}
            >
              <Icon name="x" size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Sections */}
      <div style={{ flex: 1, overflowY: "auto", paddingBottom: 10 }}>
        {nothingAtAll ? (
          <div style={{ padding: "28px 18px", textAlign: "center" }}>
            <div style={{ color: FRIENDS_UI.gold, marginBottom: 8 }}>
              <Icon name="user-plus" size={22} />
            </div>
            <div style={{ fontFamily: FRIENDS_UI.title, fontWeight: 700, fontSize: 13, marginBottom: 4 }}>No friends yet</div>
            <div style={{ fontSize: 11.5, color: FRIENDS_UI.secondary, lineHeight: 1.45 }}>
              Friends are people you follow who follow you back. Search a username above to add one.
            </div>
          </div>
        ) : (
          <>
            {(p.online.length > 0 || (!searching && p.friendCount > 0)) && (
              <>
                <SectionLabel>Online</SectionLabel>
                {p.online.length ? list(p.online) : <EmptyHint>No one online right now.</EmptyHint>}
              </>
            )}
            {(p.offline.length > 0 || (!searching && p.friendCount > 0)) && (
              <>
                <SectionLabel>Offline</SectionLabel>
                {p.offline.length ? list(p.offline) : <EmptyHint>Everyone is online.</EmptyHint>}
              </>
            )}
            {searching && p.online.length + p.offline.length === 0 && p.friendCount > 0 && (
              <EmptyHint>No friends match that name.</EmptyHint>
            )}
            {p.addBack.length > 0 && (
              <>
                <SectionLabel>Follows you — add back</SectionLabel>
                {list(p.addBack)}
              </>
            )}
            {searching && (
              <>
                <SectionLabel>Add friend</SectionLabel>
                {p.results.length ? list(p.results) : <EmptyHint>No users found for “{p.query.trim()}”.</EmptyHint>}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
