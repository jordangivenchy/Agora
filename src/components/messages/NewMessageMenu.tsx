"use client";

/* Starting a conversation, from the rail's + (the phone's
   src/newMessage.tsx, in the site's clothes).

   The rail only ever listed people you had already written to, and its
   search only filtered those — so messaging someone new meant leaving
   Messages, finding their profile and coming back through it. This
   drops under the +: your friends, searchable, thread or no thread, and
   a group as its first row.

   A direct message needs the two of you to follow each other — the
   database enforces it — so friends come first and are always shown.
   Anyone else the search turns up is offered honestly: their profile,
   to follow them, rather than a conversation that would be refused. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";
import { Icon } from "@/components/icons";
import UserAvatar from "@/components/UserAvatar";
import useEscapeClose from "@/lib/useEscapeClose";
import { displayName } from "@/lib/names";
import { userPath } from "@/lib/urls";
import type { GroupMember } from "./groups";

export interface PickedPeer {
  id: string;
  username: string;
  display_name: string | null;
  avatarUrl: string | null;
}

type Person = { id: string; username: string; display_name: string | null; avatar_url: string | null };

const PANEL_H = 396;

export default function NewMessageMenu({ onClose, meId, onPick, onNewGroup }: {
  onClose: () => void;
  /** Me, for the search that reaches past my friends. */
  meId: string | null;
  onPick: (peer: PickedPeer) => void;
  onNewGroup: () => void;
}) {
  const [supabase] = useState(() => createClient());
  const router = useRouter();
  const [q, setQ] = useState("");
  const [friends, setFriends] = useState<GroupMember[] | null>(null);
  const [others, setOthers] = useState<Person[]>([]);
  const boxRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLInputElement>(null);
  useEscapeClose(true, onClose);

  /* Mounted only while it's open, so this runs once, on the way in. */
  useEffect(() => {
    let live = true;
    supabase.rpc("get_group_chat_candidates").then(({ data }) => {
      if (live) setFriends((data ?? []) as GroupMember[]);
    });
    fieldRef.current?.focus();
    return () => { live = false; };
  }, [supabase]);

  /* A click anywhere else closes it, as a menu should. */
  useEffect(() => {
    const away = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      /* The + closes it by toggling; closing here as well would close
         it on the way down and reopen it on the way up. */
      if (t?.closest("[data-new-message]")) return;
      if (boxRef.current && !boxRef.current.contains(t)) onClose();
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [onClose]);

  const needle = q.trim().toLowerCase();
  const mine = useMemo(
    () => (friends ?? []).filter((f) => !needle || f.username.toLowerCase().includes(needle) || (f.display_name ?? "").toLowerCase().includes(needle)),
    [friends, needle],
  );

  /* Past my own friends only once there's something to go on. Below
     that the results aren't cleared, they're simply not shown: state a
     render sets is state the next render has to undo. */
  const searching = !!meId && needle.length >= 2;
  useEffect(() => {
    if (!searching) return;
    let live = true;
    const timer = window.setTimeout(() => {
      void supabase
        .from("users")
        .select("id, username, display_name, avatar_url")
        .ilike("username", `${needle.replace(/[\\%_]/g, "\\$&")}%`)
        .neq("id", meId!)
        .limit(8)
        .then(({ data }) => { if (live) setOthers((data ?? []) as Person[]); });
    }, 220);
    return () => { live = false; window.clearTimeout(timer); };
  }, [searching, needle, meId, supabase]);

  const rows = useMemo(() => {
    const known = new Set(mine.map((f) => f.id));
    return [
      ...mine.map((person) => ({ friend: true, person: person as Person })),
      ...(searching ? others : []).filter((o) => !known.has(o.id)).map((person) => ({ friend: false, person })),
    ];
  }, [mine, others, searching]);

  const choose = useCallback((row: { friend: boolean; person: Person }) => {
    if (!row.friend) { router.push(userPath(row.person.username)); return; }
    onPick({ id: row.person.id, username: row.person.username, display_name: row.person.display_name, avatarUrl: row.person.avatar_url });
  }, [onPick, router]);

  const rowStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    padding: "7px 8px",
    borderRadius: 10,
    background: "transparent",
    border: "none",
    color: "inherit",
    font: "inherit",
    textAlign: "left",
    cursor: "pointer",
  };

  return (
    <div
      ref={boxRef}
      role="dialog"
      aria-label="New message"
      style={{
        position: "absolute",
        top: "calc(100% + 8px)",
        right: 0,
        width: 320,
        height: PANEL_H,
        display: "flex",
        flexDirection: "column",
        background: "#08080b",
        border: "1px solid #2e2e38",
        borderRadius: 14,
        boxShadow: "0 18px 44px rgba(0,0,0,0.55)",
        padding: 12,
        zIndex: 60,
        /* Falls from the button rather than appearing on top of it. */
        animation: "msg-new-drop 160ms cubic-bezier(0.2, 0.7, 0.3, 1)",
      }}
    >
      <input
        ref={fieldRef}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search people"
        aria-label="Search people"
        style={{
          height: 34, width: "100%", boxSizing: "border-box", borderRadius: 9,
          border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.05)",
          color: "white", fontSize: 12.5, padding: "0 10px", outline: "none", fontFamily: "inherit",
        }}
      />

      <button type="button" onClick={onNewGroup} style={{ ...rowStyle, marginTop: 8 }}>
        <span style={{ width: 34, height: 34, borderRadius: "50%", display: "inline-flex", alignItems: "center", justifyContent: "center", background: "#15151b", border: "1px solid #2e2e38", color: "#e2b96b" }}>
          <Icon name="users" size={15} />
        </span>
        <span style={{ flex: 1, color: "#f5f5f0", fontSize: 13.5, fontWeight: 600 }}>New group</span>
        <Icon name="chevron-right" size={14} />
      </button>

      <div style={{ height: 1, background: "rgba(255,255,255,0.06)", margin: "6px 2px" }} />

      {/* One height whatever the search turns up: the list scrolls
          inside the panel instead of the panel resizing under the
          pointer. */}
      <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
        {friends === null ? (
          <p style={{ color: "#8b8b94", fontSize: 12.5, padding: "12px 8px", margin: 0 }}>Looking…</p>
        ) : rows.length === 0 ? (
          <p style={{ color: "#8b8b94", fontSize: 12.5, lineHeight: 1.5, padding: "12px 8px", margin: 0 }}>
            {needle
              ? "Nobody by that name. You can message anyone who follows you back."
              : "No friends yet — follow someone, and message them once they follow you back."}
          </p>
        ) : (
          rows.map((row) => (
            <button
              key={`${row.friend ? "f" : "o"}-${row.person.id}`}
              type="button"
              onClick={() => choose(row)}
              style={rowStyle}
              onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.05)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              <UserAvatar username={row.person.username} avatarUrl={row.person.avatar_url} size={34} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", color: "#f5f5f0", fontSize: 13.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {displayName({ display_name: row.person.display_name, username: row.person.username })}
                </span>
                <span style={{ display: "block", color: "#8b8b94", fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  @{row.person.username}{row.friend ? "" : " · follow each other to message"}
                </span>
              </span>
              <Icon name={row.friend ? "message-square" : "user-plus"} size={14} />
            </button>
          ))
        )}
      </div>
    </div>
  );
}
