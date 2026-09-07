"use client";

/* Group info: rename, who's in it, add friends, leave. The owner can
   also remove people. Opened from the thread header. */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase-browser";
import { Icon } from "@/components/icons";
import UserAvatar from "@/components/UserAvatar";
import { displayName } from "@/lib/names";
import useEscapeClose from "@/lib/useEscapeClose";
import { YELLOW } from "./DmThread";
import GroupTile from "./GroupTile";
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
  pillQuiet,
  pillYellow,
  rowStyle,
  type GroupMember,
  type GroupMemberRow,
} from "./groups";

export default function GroupInfoModal({
  chatId,
  name,
  me,
  members,
  onClose,
  onRenamed,
  onMembersChanged,
  onLeft,
}: {
  chatId: string;
  name: string;
  me: string;
  members: GroupMemberRow[];
  onClose: () => void;
  onRenamed: (name: string) => void;
  onMembersChanged: () => void;
  onLeft: () => void;
}) {
  const [supabase] = useState(() => createClient());
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [adding, setAdding] = useState(false);
  const [candidates, setCandidates] = useState<GroupMember[] | null>(null);
  const [added, setAdded] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEscapeClose(true, onClose);

  const iOwn = members.some((m) => m.id === me && m.is_owner);
  const others = members.filter((m) => m.id !== me);
  const tileMembers = [...others, ...members.filter((m) => m.id === me)];

  useEffect(() => {
    if (!adding) return;
    let live = true;
    supabase.rpc("get_group_chat_candidates", { p_chat: chatId }).then(({ data }) => {
      if (live) setCandidates((data ?? []) as GroupMember[]);
    });
    return () => {
      live = false;
    };
  }, [adding, chatId, supabase]);

  const fail = (msg: string | undefined) => setError(groupErrorText(msg));

  const saveName = async () => {
    const next = draft.trim();
    if (!next || next === name) {
      setEditing(false);
      setDraft(name);
      return;
    }
    setBusy("rename");
    setError(null);
    const { error: err } = await supabase.rpc("rename_group_chat", { p_chat: chatId, p_name: next });
    setBusy(null);
    if (err) {
      fail(err.message);
      return;
    }
    onRenamed(next);
    setEditing(false);
  };

  const add = async (u: GroupMember) => {
    setBusy(u.id);
    setError(null);
    const { error: err } = await supabase.rpc("add_group_members", { p_chat: chatId, p_members: [u.id] });
    setBusy(null);
    if (err) {
      fail(err.message);
      return;
    }
    setAdded((cur) => new Set(cur).add(u.id));
    onMembersChanged();
  };

  const remove = async (u: GroupMemberRow) => {
    setBusy(u.id);
    setError(null);
    const { error: err } = await supabase.rpc("remove_group_member", { p_chat: chatId, p_user: u.id });
    setBusy(null);
    if (err) {
      fail(err.message);
      return;
    }
    onMembersChanged();
  };

  const leave = async () => {
    setBusy("leave");
    setError(null);
    const { error: err } = await supabase.rpc("leave_group_chat", { p_chat: chatId });
    setBusy(null);
    if (err) {
      fail(err.message);
      return;
    }
    onLeft();
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
        aria-label="Group info"
        className="w-full"
        style={{ ...modalCard, maxHeight: "min(88vh, 720px)", display: "flex", flexDirection: "column" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between" style={{ marginBottom: 14, flexShrink: 0 }}>
          <h2 style={modalTitle}>Group info</h2>
          <button type="button" onClick={onClose} aria-label="Close" style={modalClose}>
            <Icon name="x" size={14} />
          </button>
        </div>

        <div style={{ overflowY: "auto", minHeight: 0, display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Name */}
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <GroupTile members={tileMembers} size={48} ring="#000" />
            {editing ? (
              <div style={{ flex: 1, minWidth: 0, display: "flex", gap: 6 }}>
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value.slice(0, GROUP_NAME_MAX))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void saveName();
                    }
                    if (e.key === "Escape") {
                      e.stopPropagation();
                      setEditing(false);
                      setDraft(name);
                    }
                  }}
                  autoFocus
                  maxLength={GROUP_NAME_MAX}
                  aria-label="Group name"
                  style={{ ...fieldStyle, height: 36, flex: 1, minWidth: 0 }}
                />
                <button type="button" onClick={() => void saveName()} disabled={busy === "rename"} style={{ ...pillYellow, height: 36 }}>
                  Save
                </button>
              </div>
            ) : (
              <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 17, fontWeight: 700, color: "#f5f5f0", fontFamily: "'Space Grotesk', sans-serif", letterSpacing: "-0.01em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {name}
                  </span>
                  <span style={{ display: "block", fontSize: 12, color: "#8b8b94", marginTop: 2 }}>
                    {members.length} member{members.length === 1 ? "" : "s"}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setDraft(name);
                    setEditing(true);
                  }}
                  aria-label="Rename group"
                  title="Rename"
                  style={{ ...modalClose, width: 30, height: 30, borderRadius: 999 }}
                >
                  <Icon name="pencil" size={13} />
                </button>
              </div>
            )}
          </div>

          {/* Members */}
          <div>
            <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
              <span style={{ ...modalLabel, marginBottom: 0 }}>Members</span>
              <button
                type="button"
                onClick={() => {
                  setCandidates(null);
                  setAdding((a) => !a);
                }}
                style={{ ...(adding ? pillYellow : pillDark), height: 28, padding: "0 12px", fontSize: 12 }}
              >
                <Icon name="user-plus" size={13} /> {adding ? "Done" : "Add friends"}
              </button>
            </div>

            {adding && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10, padding: 8, borderRadius: 14, border: "1px solid rgba(255,183,0,0.35)" }}>
                {candidates === null && (
                  <p style={{ margin: 0, fontSize: 12, color: "rgba(238,238,245,0.4)", padding: "4px 2px" }}>Finding friends…</p>
                )}
                {candidates !== null && candidates.length === 0 && (
                  <p style={{ margin: 0, fontSize: 12, color: "rgba(238,238,245,0.5)", padding: "6px 2px", lineHeight: 1.45 }}>
                    All your friends are already here. Anyone you follow back can be added.
                  </p>
                )}
                {candidates?.map((c) => {
                  const done = added.has(c.id);
                  return (
                    <div key={c.id} style={rowStyle}>
                      <UserAvatar size={30} username={c.username} avatarUrl={c.avatar_url} seed={c.id} />
                      <span style={{ minWidth: 0, flex: 1 }}>
                        <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#eeeef5", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {displayName(c)}
                        </span>
                        <span style={{ display: "block", fontSize: 11, color: "rgba(238,238,245,0.45)" }}>@{c.username}</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => !done && void add(c)}
                        disabled={done || busy === c.id}
                        style={{ ...(done ? pillQuiet : pillYellow), height: 30, padding: "0 12px", fontSize: 12 }}
                      >
                        {done ? (
                          <>
                            <Icon name="check" size={12} /> Added
                          </>
                        ) : busy === c.id ? (
                          "Adding…"
                        ) : (
                          "Add"
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {members.map((m) => {
                const isMe = m.id === me;
                return (
                  <div key={m.id} style={rowStyle}>
                    <UserAvatar size={30} username={m.username} avatarUrl={m.avatar_url} seed={m.id} />
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#eeeef5", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {displayName(m)}
                        {isMe && <span style={{ fontWeight: 500, color: "rgba(238,238,245,0.45)" }}> · you</span>}
                      </span>
                      <span style={{ display: "block", fontSize: 11, color: "rgba(238,238,245,0.45)" }}>
                        @{m.username}
                        {m.is_owner && <span style={{ color: YELLOW, fontWeight: 700 }}> · owner</span>}
                      </span>
                    </span>
                    {!isMe && (
                      <a
                        href={`/users/${m.username}`}
                        className="no-underline"
                        style={{ ...pillDark, height: 28, padding: "0 11px", fontSize: 12, textDecoration: "none" }}
                      >
                        Profile
                      </a>
                    )}
                    {iOwn && !isMe && (
                      <button
                        type="button"
                        onClick={() => void remove(m)}
                        disabled={busy === m.id}
                        aria-label={`Remove @${m.username}`}
                        title="Remove from group"
                        style={{ ...modalClose, width: 28, height: 28, color: "#ff8a80" }}
                      >
                        <Icon name="user-minus" size={13} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {error && <p style={errorNote}>{error}</p>}

          {/* Leave */}
          <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 12 }}>
            {confirmLeave ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ flex: 1, minWidth: 160, fontSize: 12.5, color: "#c9c9d4", lineHeight: 1.4 }}>
                  Leave “{name}”? You&rsquo;ll stop getting its messages.
                </span>
                <button type="button" onClick={() => setConfirmLeave(false)} style={{ ...pillDark, height: 30 }}>
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void leave()}
                  disabled={busy === "leave"}
                  style={{ ...pillYellow, height: 30, background: "#e05a5a", border: "1px solid #e05a5a", color: "#fff" }}
                >
                  {busy === "leave" ? "Leaving…" : "Leave"}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmLeave(true)}
                className="cursor-pointer"
                style={{ background: "none", border: "none", padding: 0, color: "#ff8a80", fontSize: 13, fontWeight: 600, fontFamily: "inherit", display: "inline-flex", alignItems: "center", gap: 6 }}
              >
                <Icon name="log-out" size={14} /> Leave group
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
