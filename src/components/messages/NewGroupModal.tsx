"use client";

/* Start a group chat: a name and at least one friend. Groups are for
   people who follow each other, same as DMs, so the list is your
   friends (get_group_chat_candidates). Portaled over the page. */

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase-browser";
import { Icon } from "@/components/icons";
import UserAvatar from "@/components/UserAvatar";
import { displayName } from "@/lib/names";
import useEscapeClose from "@/lib/useEscapeClose";
import { YELLOW, YELLOW_INK } from "./DmThread";
import {
  GROUP_NAME_MAX,
  errorNote,
  fieldStyle,
  groupErrorText,
  modalCard,
  modalClose,
  modalLabel,
  modalOverlay,
  modalTitle,
  pillDark,
  pillYellow,
  type GroupMember,
} from "./groups";

export default function NewGroupModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (chatId: string) => void;
}) {
  const [supabase] = useState(() => createClient());
  const [name, setName] = useState("");
  const [q, setQ] = useState("");
  const [friends, setFriends] = useState<GroupMember[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEscapeClose(true, onClose);

  useEffect(() => {
    let live = true;
    supabase.rpc("get_group_chat_candidates").then(({ data }) => {
      if (live) setFriends((data ?? []) as GroupMember[]);
    });
    return () => {
      live = false;
    };
  }, [supabase]);

  const needle = q.trim().toLowerCase();
  const shown = useMemo(
    () =>
      (friends ?? []).filter(
        (f) =>
          !needle ||
          f.username.toLowerCase().includes(needle) ||
          (f.display_name ?? "").toLowerCase().includes(needle)
      ),
    [friends, needle]
  );

  const toggle = (id: string) =>
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const canCreate = !busy && name.trim().length > 0 && picked.size > 0;

  const create = async () => {
    if (!canCreate) return;
    setBusy(true);
    setError(null);
    const { data, error: err } = await supabase.rpc("create_group_chat", {
      p_name: name.trim(),
      p_members: [...picked],
    });
    setBusy(false);
    if (err || !data) {
      setError(groupErrorText(err?.message));
      return;
    }
    onCreated(data as string);
  };

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[1200] flex items-center justify-center p-5 crm-overlay"
      style={modalOverlay}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="New group"
        className="w-full"
        style={modalCard}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between" style={{ marginBottom: 14 }}>
          <h2 style={modalTitle}>New group</h2>
          <button type="button" onClick={onClose} aria-label="Close" style={modalClose}>
            <Icon name="x" size={14} />
          </button>
        </div>

        <label style={modalLabel} htmlFor="new-group-name">Name</label>
        <input
          id="new-group-name"
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, GROUP_NAME_MAX))}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void create();
            }
          }}
          placeholder="What's the group called?"
          autoFocus
          maxLength={GROUP_NAME_MAX}
          style={{ ...fieldStyle, marginBottom: 16 }}
        />

        <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
          <span style={{ ...modalLabel, marginBottom: 0 }}>Friends</span>
          <span style={{ fontSize: 11.5, color: picked.size ? YELLOW : "rgba(238,238,245,0.4)", fontWeight: 600 }}>
            {picked.size ? `${picked.size} picked` : "Pick at least one"}
          </span>
        </div>
        {friends !== null && friends.length > 4 && (
          <div style={{ position: "relative", display: "flex", alignItems: "center", marginBottom: 8 }}>
            <span style={{ position: "absolute", left: 11, display: "inline-flex", color: "rgba(255,255,255,0.4)", pointerEvents: "none" }}>
              <Icon name="search" size={13} />
            </span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search friends"
              aria-label="Search friends"
              style={{ ...fieldStyle, height: 34, paddingLeft: 32, fontSize: 13 }}
            />
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: "min(320px, 42vh)", overflowY: "auto" }}>
          {friends === null && (
            <p style={{ margin: 0, fontSize: 12, color: "rgba(238,238,245,0.4)", padding: "8px 2px" }}>Finding friends…</p>
          )}
          {friends !== null && friends.length === 0 && (
            <div style={{ padding: "18px 12px", textAlign: "center", borderRadius: 12, background: "#0b0b0d", border: "1px solid rgba(255,255,255,0.08)" }}>
              <Icon name="users" size={18} style={{ color: "rgba(238,238,245,0.4)" }} />
              <p style={{ margin: "6px 0 0", fontSize: 12.5, color: "rgba(238,238,245,0.6)" }}>No friends to add yet.</p>
              <p style={{ margin: "4px 0 0", fontSize: 11.5, color: "rgba(238,238,245,0.4)", lineHeight: 1.45 }}>
                Group chats are for people who follow each other. Follow someone back and they&rsquo;ll show up here.
              </p>
            </div>
          )}
          {friends !== null && friends.length > 0 && shown.length === 0 && (
            <p style={{ margin: 0, fontSize: 12, color: "rgba(238,238,245,0.4)", padding: "8px 2px" }}>No matches.</p>
          )}
          {shown.map((f) => {
            const on = picked.has(f.id);
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => toggle(f.id)}
                aria-pressed={on}
                className="cursor-pointer"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "7px 10px 7px 8px",
                  borderRadius: 12,
                  background: "#0b0b0d",
                  border: `1px solid ${on ? "rgba(255,183,0,0.5)" : "rgba(255,255,255,0.08)"}`,
                  color: "inherit",
                  fontFamily: "inherit",
                  textAlign: "left",
                  width: "100%",
                }}
              >
                <UserAvatar size={30} username={f.username} avatarUrl={f.avatar_url} seed={f.id} />
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#eeeef5", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {displayName(f)}
                  </span>
                  <span style={{ display: "block", fontSize: 11, color: "rgba(238,238,245,0.45)" }}>@{f.username}</span>
                </span>
                <span
                  aria-hidden="true"
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: "50%",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    background: on ? YELLOW : "#0b0b0d",
                    border: `1px solid ${on ? YELLOW : "rgba(255,255,255,0.2)"}`,
                    color: YELLOW_INK,
                  }}
                >
                  {on && <Icon name="check" size={13} />}
                </span>
              </button>
            );
          })}
        </div>

        {error && <p style={{ ...errorNote, marginTop: 12 }}>{error}</p>}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
          <button type="button" onClick={onClose} style={pillDark}>
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void create()}
            disabled={!canCreate}
            style={{ ...pillYellow, opacity: canCreate ? 1 : 0.45, cursor: canCreate ? "pointer" : "default" }}
          >
            {busy ? "Creating…" : "Create group"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
