"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { visibleActions, type MenuActionId } from "@/lib/userMenuPermissions";
import {
  UserMenuCtx,
  type OpenMenuOptions,
  type UserMenuApi,
} from "./userMenuContext";
import ReportModal, { type ReportTarget } from "./ReportModal";
import UserProfileModal from "./UserProfileModal";

export { useUserMenu } from "./userMenuContext";
export type { MenuRoomContext, MenuChatContext, OpenMenuOptions } from "./userMenuContext";

/* ── Row metadata ───────────────────────────────────────────── */

const ROW_META: Record<MenuActionId, { emoji: string; label: string; danger?: boolean; soon?: boolean }> = {
  view_profile:     { emoji: "👤", label: "View profile" },
  whisper:          { emoji: "💬", label: "Whisper", soon: true },
  follow:           { emoji: "🔔", label: "Follow" }, // label swapped dynamically
  mute_audio:       { emoji: "🔇", label: "Mute their audio" },
  hide_camera:      { emoji: "📷", label: "Hide their camera" },
  block:            { emoji: "🚫", label: "Block user", danger: true },
  report:           { emoji: "🚩", label: "Report user", danger: true },
  copy_link:        { emoji: "🔗", label: "Copy profile link" },
  host_stage_pro:   { emoji: "🎤", label: "Bring on stage — PRO" },
  host_stage_con:   { emoji: "🎤", label: "Bring on stage — CON" },
  host_to_audience: { emoji: "👥", label: "Move to audience" },
  host_mute_mic:    { emoji: "🔇", label: "Mute microphone" },
  host_disable_cam: { emoji: "🎥", label: "Disable camera" },
  host_end_turn:    { emoji: "⏭", label: "End speaking turn" },
  host_give_turn:   { emoji: "🎙", label: "Give speaking turn" },
  host_timeout:     { emoji: "⏱", label: "Timeout (5 min)", danger: true },
  host_kick:        { emoji: "🚪", label: "Remove from room", danger: true },
  host_ban:         { emoji: "🚫", label: "Ban from debate", danger: true },
  mod_panel:        { emoji: "📋", label: "Reports & history" },
  mod_warn:         { emoji: "⚠️", label: "Warn user" },
  mod_suspend:      { emoji: "⛔", label: "Suspend account", danger: true },
  mod_ban_account:  { emoji: "🔨", label: "Ban account", danger: true },
};

interface MenuState {
  x: number;
  y: number;
  target: { userId: string; username: string };
  opts: OpenMenuOptions;
}

interface Relationship {
  following: boolean;
  followedBy: boolean;
  blocked: boolean;
}

/* ── Provider ───────────────────────────────────────────────── */

export default function UserMenuProvider({ children }: { children: React.ReactNode }) {
  const supabase = createClient();

  const [menu, setMenu] = useState<MenuState | null>(null);
  const [me, setMe] = useState<{ id: string; isModerator: boolean } | null>(null);
  const [rel, setRel] = useState<Relationship | null>(null);
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  const [modPanelTarget, setModPanelTarget] = useState<{ userId: string; username: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }, []);

  // Track who I am (+ moderator flag) once.
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_e, session) => {
      if (!session?.user) {
        setMe(null);
        return;
      }
      const { data } = await supabase
        .from("users")
        .select("is_moderator")
        .eq("id", session.user.id)
        .single();
      setMe({ id: session.user.id, isModerator: !!data?.is_moderator });
    });
    return () => subscription.unsubscribe();
  }, [supabase]);

  /** Single-instance open: replaces any currently open menu. */
  const openUserMenu = useCallback<UserMenuApi["openUserMenu"]>(
    (at, target, opts = {}) => {
      setRel(null);
      setMenu({ x: at.x, y: at.y, target, opts });

      // Relationship data loads async; rows depending on it enable when ready.
      (async () => {
        const [{ data: prof }, { data: blocks }] = await Promise.all([
          supabase.rpc("get_user_profile", { p_user: target.userId }),
          supabase.from("user_blocks").select("blocked_id").eq("blocked_id", target.userId),
        ]);
        const row = Array.isArray(prof) ? prof[0] : prof;
        setRel({
          following: !!row?.is_following,
          followedBy: !!row?.is_followed_by,
          blocked: !!blocks && blocks.length > 0,
        });
      })();
    },
    [supabase]
  );

  const close = useCallback(() => setMenu(null), []);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!menu) return;
    function onDoc(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) close();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu, close]);

  // Clamp inside the viewport.
  useLayoutEffect(() => {
    if (!menu || !menuRef.current) return;
    const el = menuRef.current;
    const r = el.getBoundingClientRect();
    const x = Math.min(menu.x, window.innerWidth - r.width - 8);
    const y = Math.min(menu.y, window.innerHeight - r.height - 8);
    el.style.left = `${Math.max(8, x)}px`;
    el.style.top = `${Math.max(8, y)}px`;
  }, [menu]);

  /* ── Action handlers ────────────────────────────────────── */

  async function run(id: MenuActionId) {
    if (!menu) return;
    const { target, opts } = menu;
    const room = opts.room;

    const rpcToast = async (fn: string, params: Record<string, unknown>, ok: string) => {
      const { error } = await supabase.rpc(fn, params);
      if (error) showToast("Failed: " + (error.message || fn));
      else showToast(ok);
    };

    switch (id) {
      case "view_profile":
        setProfileUserId(target.userId);
        break;

      case "whisper":
        return; // disabled row; no-op

      case "follow": {
        if (!rel) return;
        const fn = rel.following ? "unfollow_user" : "follow_user";
        const { error } = await supabase.rpc(fn, { p_target: target.userId });
        if (error) showToast("Failed: " + error.message);
        else {
          showToast(rel.following ? `Unfollowed @${target.username}` : `Following @${target.username}`);
          window.dispatchEvent(new CustomEvent("profile-updated"));
        }
        break;
      }

      case "mute_audio":
        room?.onToggleLocalMute?.();
        break;

      case "hide_camera":
        room?.onToggleHideCamera?.();
        break;

      case "block": {
        if (!rel) return;
        if (rel.blocked) {
          await rpcToast("unblock_user", { p_target: target.userId }, `Unblocked @${target.username}`);
        } else {
          if (!window.confirm(`Block @${target.username}? You'll unfollow each other and stop seeing their chat messages.`)) return;
          await rpcToast("block_user", { p_target: target.userId }, `Blocked @${target.username}`);
        }
        window.dispatchEvent(new CustomEvent("blocks-updated"));
        window.dispatchEvent(new CustomEvent("profile-updated"));
        break;
      }

      case "report":
        setReportTarget({
          userId: target.userId,
          username: target.username,
          context: opts.chat ? "chat" : room ? "room" : "profile",
          roomId: opts.chat?.roomId ?? room?.roomId ?? null,
          messageId: opts.chat?.messageId ?? null,
          messagePreview: opts.chat?.messagePreview ?? null,
        });
        break;

      case "copy_link":
        try {
          await navigator.clipboard.writeText(`${window.location.origin}/?profile=${target.userId}`);
          showToast("Profile link copied");
        } catch {
          showToast("Could not copy link");
        }
        break;

      /* ── Host ── */
      case "host_stage_pro":
      case "host_stage_con": {
        if (!room) return;
        const stance = id === "host_stage_pro" ? "PRO" : "CON";
        await rpcToast(
          "host_set_participant_role",
          { p_room: room.roomId, p_user: target.userId, p_role: "debater", p_stance: stance },
          `@${target.username} is now debating ${stance}`
        );
        break;
      }

      case "host_to_audience":
        if (!room) return;
        await rpcToast(
          "host_set_participant_role",
          { p_room: room.roomId, p_user: target.userId, p_role: "spectator", p_stance: null },
          `@${target.username} moved to the audience`
        );
        break;

      case "host_mute_mic":
      case "host_disable_cam": {
        if (!room) return;
        const kind = id === "host_mute_mic" ? "audio" : "video";
        const res = await fetch("/api/host-mute", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ roomId: room.roomId, targetUserId: target.userId, kind }),
        });
        showToast(res.ok
          ? kind === "audio" ? `Muted @${target.username}'s mic` : `Disabled @${target.username}'s camera`
          : "Failed — are you still the host?");
        break;
      }

      case "host_end_turn":
        if (room?.onForceTurn && room.targetStance)
          room.onForceTurn(room.targetStance === "PRO" ? "CON" : "PRO");
        break;

      case "host_give_turn":
        if (room?.onForceTurn && room.targetStance) room.onForceTurn(room.targetStance);
        break;

      case "host_timeout":
        if (!room) return;
        if (!window.confirm(`Timeout @${target.username} for 5 minutes? They'll be removed and can't rejoin until it expires.`)) return;
        await rpcToast(
          "host_ban_user",
          { p_room: room.roomId, p_user: target.userId, p_minutes: 5 },
          `@${target.username} timed out for 5 minutes`
        );
        break;

      case "host_kick":
        if (!room) return;
        if (!window.confirm(`Remove @${target.username} from this room? They can rejoin unless you ban them.`)) return;
        await rpcToast(
          "host_kick_user",
          { p_room: room.roomId, p_user: target.userId },
          `@${target.username} removed`
        );
        break;

      case "host_ban":
        if (!room) return;
        if (!window.confirm(`Ban @${target.username} from this debate? They will not be able to rejoin.`)) return;
        await rpcToast(
          "host_ban_user",
          { p_room: room.roomId, p_user: target.userId, p_minutes: null },
          `@${target.username} banned from this debate`
        );
        break;

      /* ── Moderator ── */
      case "mod_panel":
        setModPanelTarget(target);
        break;

      case "mod_warn": {
        const reason = window.prompt(`Warning reason for @${target.username}:`);
        if (reason === null) return;
        await rpcToast("mod_warn_user", { p_user: target.userId, p_reason: reason }, "Warning recorded");
        break;
      }

      case "mod_suspend":
        if (!window.confirm(`Suspend @${target.username}'s account for 7 days?`)) return;
        await rpcToast("mod_suspend_user", { p_user: target.userId, p_days: 7 }, "Account suspended for 7 days");
        break;

      case "mod_ban_account":
        if (!window.confirm(`PERMANENTLY ban @${target.username}'s account?`)) return;
        await rpcToast("mod_suspend_user", { p_user: target.userId, p_days: null }, "Account banned");
        break;
    }
    close();
  }

  /* ── Render ─────────────────────────────────────────────── */

  const sections = menu
    ? visibleActions({
        signedIn: !!me,
        isSelf: me?.id === menu.target.userId,
        inRoom: !!menu.opts.room,
        targetIsDebater: !!menu.opts.room?.targetIsDebater,
        targetIsSpectator: !!menu.opts.room?.targetIsSpectator,
        isHost: !!menu.opts.room?.isHost,
        timerActive: !!menu.opts.room?.timerActive,
        targetHasTurn: !!menu.opts.room?.targetHasTurn,
        isModerator: !!me?.isModerator,
        hideViewProfile: menu.opts.hideViewProfile,
      })
    : null;

  function rowLabel(id: MenuActionId): string {
    if (!menu) return ROW_META[id].label;
    if (id === "follow") {
      if (!rel) return "Follow…";
      if (rel.following) return "Unfollow";
      if (rel.followedBy) return "Follow back (add friend)";
      return "Follow";
    }
    if (id === "block" && rel?.blocked) return "Unblock user";
    if (id === "mute_audio" && menu.opts.room?.audioMutedLocally) return "Unmute their audio";
    if (id === "hide_camera" && menu.opts.room?.cameraHiddenLocally) return "Show their camera";
    return ROW_META[id].label;
  }

  function rowDisabled(id: MenuActionId): boolean {
    if (ROW_META[id].soon) return true;
    if ((id === "follow" || id === "block") && !rel) return true;
    return false;
  }

  const renderRows = (ids: MenuActionId[]) =>
    ids.map((id) => (
      <button
        key={id}
        className={`user-menu-row${ROW_META[id].danger ? " danger" : ""}`}
        disabled={rowDisabled(id)}
        onClick={() => run(id)}
      >
        <span className="user-menu-emoji">{ROW_META[id].emoji}</span>
        {rowLabel(id)}
        {ROW_META[id].soon && <span className="user-menu-soon">soon</span>}
      </button>
    ));

  const api: UserMenuApi = { openUserMenu };

  return (
    <UserMenuCtx.Provider value={api}>
      {children}

      {menu && sections && (
        <div
          ref={menuRef}
          className="user-menu"
          style={{ left: menu.x, top: menu.y }}
          role="menu"
        >
          <div className="user-menu-header">@{menu.target.username}</div>
          {renderRows(sections.standard)}
          {sections.host.length > 0 && (
            <>
              <div className="user-menu-divider" />
              <div className="user-menu-section-label">Host controls</div>
              {renderRows(sections.host)}
            </>
          )}
          {sections.moderator.length > 0 && (
            <>
              <div className="user-menu-divider" />
              <div className="user-menu-section-label">Moderation</div>
              {renderRows(sections.moderator)}
            </>
          )}
        </div>
      )}

      <ReportModal target={reportTarget} onClose={() => setReportTarget(null)} />

      <UserProfileModal
        userId={profileUserId}
        onClose={() => setProfileUserId(null)}
        onOpenProfile={(id) => setProfileUserId(id)}
      />

      {modPanelTarget && (
        <ModerationPanel
          target={modPanelTarget}
          onClose={() => setModPanelTarget(null)}
        />
      )}

      {toast && <div className="user-menu-toast">{toast}</div>}
    </UserMenuCtx.Provider>
  );
}

/* ── Moderation panel (reports, notes, history) ─────────────── */

interface ModData {
  suspended_until: string | null;
  reports: {
    id: string; reason: string; context: string; description: string | null;
    message_content: string | null; status: string; created_at: string;
  }[];
  notes: { note: string; created_at: string; author: string | null }[];
}

function ModerationPanel({
  target,
  onClose,
}: {
  target: { userId: string; username: string };
  onClose: () => void;
}) {
  const supabase = createClient();
  const [data, setData] = useState<ModData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const { data: d, error: e } = await supabase.rpc("mod_get_user_moderation", {
      p_user: target.userId,
    });
    if (e) setError(e.message);
    else setData(d as ModData);
  }, [supabase, target.userId]);

  useEffect(() => {
    load();
  }, [load]);

  async function addNote() {
    if (!note.trim()) return;
    setSaving(true);
    const { error: e } = await supabase.rpc("mod_add_note", {
      p_user: target.userId,
      p_note: note.trim(),
    });
    setSaving(false);
    if (e) setError(e.message);
    else {
      setNote("");
      load();
    }
  }

  async function unsuspend() {
    await supabase.rpc("mod_unsuspend_user", { p_user: target.userId });
    load();
  }

  const suspended =
    data?.suspended_until && new Date(data.suspended_until).getTime() > Date.now();

  return (
    <div
      className="fixed inset-0 z-[1250] flex items-center justify-center p-5"
      style={{ background: "rgba(0,0,0,0.8)", backdropFilter: "blur(4px)", animation: "modalIn 0.2s ease" }}
      onClick={onClose}
    >
      <div
        className="w-full overflow-y-auto"
        style={{
          maxWidth: 520,
          maxHeight: "85vh",
          background: "rgba(18,18,21,0.97)",
          border: "1px solid var(--border)",
          borderRadius: 20,
          padding: "22px 22px 20px",
          boxShadow: "0 24px 80px rgba(0,0,0,0.6)",
          animation: "modalPanelIn 0.25s cubic-bezier(0.25,0.46,0.45,0.94)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 17, fontWeight: 700, letterSpacing: "-0.02em", color: "var(--text-primary)" }}>
            Moderation — @{target.username}
          </h2>
          <button
            onClick={onClose}
            className="flex items-center justify-center cursor-pointer"
            style={{ width: 28, height: 28, borderRadius: 8, color: "var(--text-muted)", background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)" }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {error && (
          <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 10, color: "#fca5a5", fontSize: 12.5, padding: "9px 12px", marginBottom: 14 }}>
            {error}
          </div>
        )}

        {!data && !error && (
          <div className="py-8 text-center" style={{ color: "var(--text-muted)", fontSize: 13 }}>Loading…</div>
        )}

        {data && (
          <>
            {suspended && (
              <div className="flex items-center justify-between gap-3" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 10, padding: "9px 12px", marginBottom: 14 }}>
                <span style={{ color: "#fca5a5", fontSize: 12.5 }}>
                  Suspended until{" "}
                  {new Date(data.suspended_until!).getFullYear() > 9000
                    ? "forever (banned)"
                    : new Date(data.suspended_until!).toLocaleString()}
                </span>
                <button
                  onClick={unsuspend}
                  className="cursor-pointer shrink-0"
                  style={{ padding: "5px 12px", borderRadius: 100, background: "rgba(255,255,255,0.06)", border: "1px solid var(--border)", color: "var(--text-primary)", fontSize: 11.5, fontWeight: 600 }}
                >
                  Lift suspension
                </button>
              </div>
            )}

            <SectionTitle>Reports ({data.reports.length})</SectionTitle>
            {data.reports.length === 0 ? (
              <EmptyLine>No reports against this user.</EmptyLine>
            ) : (
              <div className="flex flex-col gap-2 mb-4">
                {data.reports.slice(0, 10).map((r) => (
                  <div key={r.id} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)", borderRadius: 10, padding: "9px 12px" }}>
                    <div className="flex items-center gap-2" style={{ fontSize: 12, marginBottom: 2 }}>
                      <span style={{ color: "#fca5a5", fontWeight: 600 }}>{r.reason.replace(/_/g, " ")}</span>
                      <span style={{ color: "var(--text-dim)" }}>· {r.context} · {r.status}</span>
                      <span style={{ color: "var(--text-dim)", marginLeft: "auto" }}>{new Date(r.created_at).toLocaleDateString()}</span>
                    </div>
                    {r.message_content && (
                      <div style={{ color: "var(--text-muted)", fontSize: 12, fontStyle: "italic" }}>&ldquo;{r.message_content}&rdquo;</div>
                    )}
                    {r.description && (
                      <div style={{ color: "var(--text-muted)", fontSize: 12 }}>{r.description}</div>
                    )}
                  </div>
                ))}
              </div>
            )}

            <SectionTitle>Moderation history & notes ({data.notes.length})</SectionTitle>
            {data.notes.length === 0 ? (
              <EmptyLine>No notes yet.</EmptyLine>
            ) : (
              <div className="flex flex-col gap-1.5 mb-4">
                {data.notes.slice(0, 15).map((n, i) => (
                  <div key={i} style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.5 }}>
                    <span style={{ color: "var(--text-dim)" }}>
                      {new Date(n.created_at).toLocaleDateString()} {n.author ? `· @${n.author}` : ""} —{" "}
                    </span>
                    {n.note}
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-2 mt-3">
              <input
                value={note}
                onChange={(e) => setNote(e.target.value.slice(0, 2000))}
                placeholder="Add a moderator note…"
                className="flex-1 outline-none"
                style={{ height: 38, padding: "0 12px", background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)", borderRadius: 10, color: "var(--text-primary)", fontSize: 13 }}
                onKeyDown={(e) => { if (e.key === "Enter") addNote(); }}
              />
              <button
                onClick={addNote}
                disabled={saving || !note.trim()}
                className="cursor-pointer disabled:opacity-50 shrink-0"
                style={{ padding: "0 18px", borderRadius: 100, background: "var(--accent-blue)", border: "none", color: "#fff", fontSize: 13, fontWeight: 600 }}
              >
                {saving ? "…" : "Add"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "rgba(255,255,255,0.4)", marginBottom: 8 }}>
      {children}
    </div>
  );
}

function EmptyLine({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 12.5, color: "var(--text-dim)", marginBottom: 14 }}>{children}</div>;
}
