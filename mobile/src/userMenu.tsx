/* The person menu, the site's context menu (components/UserContextMenu.tsx,
   lib/userMenuPermissions.ts): one provider at the root; openUserMenu
   from any avatar. The rows a person sees come from the same permission
   rules — standard, then the host's controls in a room, then the
   moderator's — and run the same RPCs. */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ComponentProps, type ReactNode } from "react";
import { Alert, Modal, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "./supabase";
import { useSession } from "./session";
import { useMe } from "./me";
import { apiFetch, SITE } from "./api";
import { showToast } from "./toast";
import { ReportSheet, type ReportTarget } from "./report";
import { colors, fonts } from "./theme";

export type MenuActionId =
  | "view_profile" | "message" | "follow" | "favorite" | "invite_room" | "mute_audio" | "hide_camera" | "block" | "report" | "copy_link"
  | "host_stage_pro" | "host_stage_con" | "host_to_audience" | "host_mute_mic" | "host_disable_cam" | "host_end_turn" | "host_give_turn" | "host_timeout" | "host_kick" | "host_ban"
  | "mod_panel" | "mod_warn" | "mod_suspend" | "mod_ban_account";

export interface MenuRoomContext {
  roomId: string;
  isHost: boolean;
  targetIsDebater: boolean;
  targetIsSpectator: boolean;
  targetStance?: "PRO" | "CON" | null;
  timerActive?: boolean;
  targetHasTurn?: boolean;
  audioMutedLocally?: boolean;
  cameraHiddenLocally?: boolean;
  onToggleLocalMute?: () => void;
  onToggleHideCamera?: () => void;
  onForceTurn?: (stance: "PRO" | "CON") => void;
}
export interface MenuChatContext { roomId: string; messageId: string; messagePreview: string }
export interface OpenMenuOptions { room?: MenuRoomContext; chat?: MenuChatContext; hideViewProfile?: boolean }
export interface MenuTarget { userId: string; username: string; displayName?: string | null }

interface Sections { standard: MenuActionId[]; host: MenuActionId[]; moderator: MenuActionId[] }

/* The single source of truth for which rows a person sees. */
export function visibleActions(p: { signedIn: boolean; isSelf: boolean; inRoom: boolean; targetIsDebater: boolean; targetIsSpectator: boolean; isHost: boolean; timerActive: boolean; targetHasTurn: boolean; isModerator: boolean; hideViewProfile?: boolean }): Sections {
  const standard: MenuActionId[] = [];
  const host: MenuActionId[] = [];
  const moderator: MenuActionId[] = [];
  if (p.isSelf) {
    if (!p.hideViewProfile) standard.push("view_profile");
    standard.push("copy_link");
    return { standard, host, moderator };
  }
  if (!p.hideViewProfile) standard.push("view_profile");
  if (p.signedIn) {
    standard.push("message", "follow", "favorite");
    if (p.inRoom) standard.push("invite_room");
    if (p.inRoom && p.targetIsDebater) standard.push("mute_audio", "hide_camera");
    standard.push("block", "report");
  }
  standard.push("copy_link");
  if (p.signedIn && p.isHost && p.inRoom) {
    if (p.targetIsSpectator) host.push("host_stage_pro", "host_stage_con");
    if (p.targetIsDebater) {
      host.push("host_to_audience", "host_mute_mic", "host_disable_cam");
      if (p.timerActive) host.push(p.targetHasTurn ? "host_end_turn" : "host_give_turn");
    }
    if (p.targetIsDebater || p.targetIsSpectator) host.push("host_timeout", "host_kick", "host_ban");
  }
  if (p.signedIn && p.isModerator) moderator.push("mod_panel", "mod_warn", "mod_suspend", "mod_ban_account");
  return { standard, host, moderator };
}

type Icon = ComponentProps<typeof Ionicons>["name"];
const ROW_META: Record<MenuActionId, { icon: Icon; label: string; danger?: boolean }> = {
  view_profile: { icon: "person-outline", label: "View profile" },
  message: { icon: "chatbubble-outline", label: "Message" },
  favorite: { icon: "star-outline", label: "Add to favorites" },
  invite_room: { icon: "paper-plane-outline", label: "Invite to this room" },
  follow: { icon: "notifications-outline", label: "Follow" },
  mute_audio: { icon: "volume-mute-outline", label: "Mute their audio" },
  hide_camera: { icon: "videocam-off-outline", label: "Hide their camera" },
  block: { icon: "ban-outline", label: "Block user", danger: true },
  report: { icon: "flag-outline", label: "Report user", danger: true },
  copy_link: { icon: "link-outline", label: "Copy profile link" },
  host_stage_pro: { icon: "mic-outline", label: "Bring on stage — PRO" },
  host_stage_con: { icon: "mic-outline", label: "Bring on stage — CON" },
  host_to_audience: { icon: "people-outline", label: "Move to audience" },
  host_mute_mic: { icon: "mic-off-outline", label: "Mute microphone" },
  host_disable_cam: { icon: "videocam-off-outline", label: "Disable camera" },
  host_end_turn: { icon: "play-skip-forward-outline", label: "End speaking turn" },
  host_give_turn: { icon: "mic-outline", label: "Give speaking turn" },
  host_timeout: { icon: "timer-outline", label: "Timeout (5 min)", danger: true },
  host_kick: { icon: "exit-outline", label: "Remove from room", danger: true },
  host_ban: { icon: "ban-outline", label: "Ban from discussion", danger: true },
  mod_panel: { icon: "clipboard-outline", label: "Reports & history" },
  mod_warn: { icon: "warning-outline", label: "Warn user" },
  mod_suspend: { icon: "close-circle-outline", label: "Suspend account", danger: true },
  mod_ban_account: { icon: "hammer-outline", label: "Ban account", danger: true },
};

interface Relationship { following: boolean; followedBy: boolean; blocked: boolean; favorite: boolean }
interface UserMenuApi { openUserMenu(target: MenuTarget, opts?: OpenMenuOptions): void }
const Ctx = createContext<UserMenuApi | null>(null);

export function useUserMenu(): UserMenuApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useUserMenu outside UserMenuProvider");
  return v;
}

const confirm = (title: string, message: string, label: string) =>
  new Promise<boolean>((resolve) =>
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
      { text: label, style: "destructive", onPress: () => resolve(true) },
    ])
  );

export function UserMenuProvider({ children }: { children: ReactNode }) {
  const { session, pass } = useSession();
  const me = useMe();
  const meId = session?.user.id ?? null;
  const [menu, setMenu] = useState<{ target: MenuTarget; opts: OpenMenuOptions } | null>(null);
  const [rel, setRel] = useState<Relationship | null>(null);
  const [targetName, setTargetName] = useState<string | null>(null);
  const [report, setReport] = useState<ReportTarget | null>(null);
  const [modTarget, setModTarget] = useState<MenuTarget | null>(null);

  const openUserMenu = useCallback<UserMenuApi["openUserMenu"]>((target, opts = {}) => {
    setRel(null);
    setTargetName(target.displayName ?? null);
    setMenu({ target, opts });
    void (async () => {
      const [{ data: prof }, { data: blocks }, { data: favs }] = await Promise.all([
        supabase.rpc("get_user_profile", { p_user: target.userId }),
        supabase.from("user_blocks").select("blocked_id").eq("blocked_id", target.userId),
        supabase.from("user_favorites").select("favorite_id").eq("favorite_id", target.userId),
      ]);
      const row = (Array.isArray(prof) ? prof[0] : prof) as { display_name?: string | null; is_following?: boolean; is_followed_by?: boolean } | null;
      setTargetName(row?.display_name ?? target.displayName ?? null);
      setRel({ following: !!row?.is_following, followedBy: !!row?.is_followed_by, blocked: !!blocks && blocks.length > 0, favorite: !!favs && favs.length > 0 });
    })();
  }, []);
  const api = useMemo(() => ({ openUserMenu }), [openUserMenu]);
  const close = () => setMenu(null);

  async function run(id: MenuActionId) {
    if (!menu) return;
    const { target, opts } = menu;
    const room = opts.room;
    close();
    const rpcToast = async (fn: string, params: Record<string, unknown>, ok: string) => {
      const { error } = await supabase.rpc(fn, params);
      showToast(error ? "Failed: " + (error.message || fn) : ok);
    };
    /* Sheets and alerts after the menu's modal is down. */
    const later = (f: () => void) => setTimeout(f, 320);
    switch (id) {
      case "view_profile":
        later(() => router.push({ pathname: "/u/[username]", params: { username: target.username } }));
        break;
      case "message":
        later(() => router.push({ pathname: "/messages/[username]", params: { username: target.username } }));
        break;
      case "favorite": {
        if (!meId) return;
        if (rel?.favorite) {
          await supabase.from("user_favorites").delete().eq("user_id", meId).eq("favorite_id", target.userId);
          showToast(`Removed @${target.username} from favorites`);
        } else {
          const { error } = await supabase.from("user_favorites").insert({ user_id: meId, favorite_id: target.userId });
          if (error) showToast(error.message.includes("row-level security") ? "Favorites are for friends — you both need to follow each other." : "Failed: " + error.message);
          else showToast(`⭐ @${target.username} added to favorites`);
        }
        break;
      }
      case "invite_room": {
        if (!room) return;
        const { error } = await supabase.rpc("invite_friend_to_room", { p_user: target.userId, p_room: room.roomId });
        showToast(error ? (error.message.includes("not_friends") ? "You can only invite friends (you both follow each other)." : "Couldn't send the invite.") : `Invite sent to @${target.username}`);
        break;
      }
      case "follow": {
        if (!rel) return;
        const { error } = await supabase.rpc(rel.following ? "unfollow_user" : "follow_user", { p_target: target.userId });
        showToast(error ? "Failed: " + error.message : rel.following ? `Unfollowed @${target.username}` : `Following @${target.username}`);
        break;
      }
      case "mute_audio": room?.onToggleLocalMute?.(); break;
      case "hide_camera": room?.onToggleHideCamera?.(); break;
      case "block": {
        if (!rel) return;
        if (rel.blocked) { await rpcToast("unblock_user", { p_target: target.userId }, `Unblocked @${target.username}`); break; }
        later(async () => {
          if (!(await confirm(`Block @${target.username}?`, "You'll unfollow each other and stop seeing their chat messages.", "Block"))) return;
          await rpcToast("block_user", { p_target: target.userId }, `Blocked @${target.username}`);
        });
        break;
      }
      case "report":
        later(() => setReport({
          userId: target.userId, username: target.username,
          context: opts.chat ? "chat" : room ? "room" : "profile",
          roomId: opts.chat?.roomId ?? room?.roomId ?? null,
          messageId: opts.chat?.messageId ?? null,
          messagePreview: opts.chat?.messagePreview ?? null,
        }));
        break;
      case "copy_link": {
        const isHandle = /^[A-Za-z0-9_]{1,30}$/.test(target.username);
        const link = isHandle ? `${SITE}/users/${encodeURIComponent(target.username)}` : `${SITE}/?profile=${target.userId}`;
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const Clipboard = require("expo-clipboard") as typeof import("expo-clipboard");
          await Clipboard.setStringAsync(link);
          showToast("Profile link copied");
        } catch {
          showToast("Could not copy link");
        }
        break;
      }
      case "host_stage_pro":
      case "host_stage_con": {
        if (!room) return;
        const stance = id === "host_stage_pro" ? "PRO" : "CON";
        await rpcToast("host_set_participant_role", { p_room: room.roomId, p_user: target.userId, p_role: "debater", p_stance: stance }, `@${target.username} is now speaking ${stance}`);
        break;
      }
      case "host_to_audience":
        if (!room) return;
        await rpcToast("host_set_participant_role", { p_room: room.roomId, p_user: target.userId, p_role: "spectator", p_stance: null }, `@${target.username} moved to the audience`);
        break;
      case "host_mute_mic":
      case "host_disable_cam": {
        if (!room) return;
        const kind = id === "host_mute_mic" ? "audio" : "video";
        const res = await apiFetch("/api/host-mute", { token: session?.access_token, pass }, { method: "POST", body: JSON.stringify({ roomId: room.roomId, targetUserId: target.userId, kind }) }).catch(() => null);
        showToast(res?.ok ? (kind === "audio" ? `Muted @${target.username}'s mic` : `Disabled @${target.username}'s camera`) : "Failed — are you still the host?");
        break;
      }
      case "host_end_turn":
        if (room?.onForceTurn && room.targetStance) room.onForceTurn(room.targetStance === "PRO" ? "CON" : "PRO");
        break;
      case "host_give_turn":
        if (room?.onForceTurn && room.targetStance) room.onForceTurn(room.targetStance);
        break;
      case "host_timeout":
        if (!room) return;
        later(async () => {
          if (!(await confirm(`Timeout @${target.username} for 5 minutes?`, "They'll be removed and can't rejoin until it expires.", "Timeout"))) return;
          await rpcToast("host_ban_user", { p_room: room.roomId, p_user: target.userId, p_minutes: 5 }, `@${target.username} timed out for 5 minutes`);
        });
        break;
      case "host_kick":
        if (!room) return;
        later(async () => {
          if (!(await confirm(`Remove @${target.username} from this room?`, "They can rejoin unless you ban them.", "Remove"))) return;
          await rpcToast("host_kick_user", { p_room: room.roomId, p_user: target.userId }, `@${target.username} removed`);
        });
        break;
      case "host_ban":
        if (!room) return;
        later(async () => {
          if (!(await confirm(`Ban @${target.username} from this discussion?`, "They will not be able to rejoin.", "Ban"))) return;
          await rpcToast("host_ban_user", { p_room: room.roomId, p_user: target.userId, p_minutes: null }, `@${target.username} banned from this discussion`);
        });
        break;
      case "mod_panel":
        later(() => setModTarget(target));
        break;
      case "mod_warn":
        later(() => Alert.prompt(`Warn @${target.username}`, "The reason for the warning:", [
          { text: "Cancel", style: "cancel" },
          { text: "Record warning", onPress: (reason?: string) => void rpcToast("mod_warn_user", { p_user: target.userId, p_reason: reason ?? "" }, "Warning recorded") },
        ], "plain-text"));
        break;
      case "mod_suspend":
        later(async () => {
          if (!(await confirm(`Suspend @${target.username}?`, "Their account is suspended for 7 days.", "Suspend"))) return;
          await rpcToast("mod_suspend_user", { p_user: target.userId, p_days: 7 }, "Account suspended for 7 days");
        });
        break;
      case "mod_ban_account":
        later(async () => {
          if (!(await confirm(`Ban @${target.username}'s account?`, "This is permanent.", "Ban account"))) return;
          await rpcToast("mod_suspend_user", { p_user: target.userId, p_days: null }, "Account banned");
        });
        break;
    }
  }

  const sections = menu ? visibleActions({
    signedIn: !!meId,
    isSelf: meId === menu.target.userId,
    inRoom: !!menu.opts.room,
    targetIsDebater: !!menu.opts.room?.targetIsDebater,
    targetIsSpectator: !!menu.opts.room?.targetIsSpectator,
    isHost: !!menu.opts.room?.isHost,
    timerActive: !!menu.opts.room?.timerActive,
    targetHasTurn: !!menu.opts.room?.targetHasTurn,
    isModerator: !!me?.is_moderator,
    hideViewProfile: menu.opts.hideViewProfile,
  }) : null;

  function rowLabel(id: MenuActionId): string {
    if (!menu) return ROW_META[id].label;
    if (id === "favorite") {
      if (!rel) return "Favorites…";
      if (rel.favorite) return "Remove from favorites";
      if (!(rel.following && rel.followedBy)) return "Add to favorites (friends only)";
      return "Add to favorites";
    }
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
    if ((id === "follow" || id === "block" || id === "favorite") && !rel) return true;
    if (id === "favorite" && rel && !rel.favorite && !(rel.following && rel.followedBy)) return true;
    return false;
  }

  return (
    <Ctx.Provider value={api}>
      {children}
      <MenuSheet
        open={!!menu}
        onClose={close}
        name={targetName?.trim() || (menu ? `@${menu.target.username}` : "")}
        sub={targetName?.trim() && menu ? `@${menu.target.username}` : undefined}
        sections={sections}
        rowLabel={rowLabel}
        rowDisabled={rowDisabled}
        onRun={(id) => void run(id)}
      />
      <ReportSheet target={report} onClose={() => setReport(null)} />
      {modTarget && <ModPanel target={modTarget} onClose={() => setModTarget(null)} />}
    </Ctx.Provider>
  );
}

function MenuSheet({ open, onClose, name, sub, sections, rowLabel, rowDisabled, onRun }: { open: boolean; onClose: () => void; name: string; sub?: string; sections: Sections | null; rowLabel: (id: MenuActionId) => string; rowDisabled: (id: MenuActionId) => boolean; onRun: (id: MenuActionId) => void }) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const row = (id: MenuActionId) => {
    const meta = ROW_META[id];
    const off = rowDisabled(id);
    return (
      <Pressable key={id} onPress={() => onRun(id)} disabled={off} accessibilityRole="menuitem" style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 11, paddingHorizontal: 12, borderRadius: 10, backgroundColor: pressed ? (meta.danger ? "#2a1414" : "#1a1a20") : "transparent", opacity: off ? 0.45 : 1 })}>
        <Ionicons name={meta.icon} size={16} color={meta.danger ? "#f08a8a" : colors.muted} />
        <Text style={{ color: meta.danger ? "#f08a8a" : colors.text, fontFamily: fonts.medium, fontSize: 14 }}>{rowLabel(id)}</Text>
      </Pressable>
    );
  };
  const label = (t: string) => <Text style={{ color: colors.faint, fontFamily: fonts.semi, fontSize: 10.5, letterSpacing: 0.8, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 4 }}>{t.toUpperCase()}</Text>;
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)" }} />
      <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 18, borderTopRightRadius: 18, borderWidth: 1, borderBottomWidth: 0, borderColor: colors.border, paddingHorizontal: 10, paddingTop: 14, paddingBottom: 10 + insets.bottom, maxHeight: Math.round(height * 0.86) }}>
        <View style={{ paddingHorizontal: 12, paddingBottom: 10, borderBottomWidth: 1, borderColor: colors.hairline, marginBottom: 6 }}>
          <Text numberOfLines={1} style={{ color: colors.text, fontFamily: fonts.title, fontSize: 15 }}>{name}</Text>
          {!!sub && <Text numberOfLines={1} style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 12, marginTop: 1 }}>{sub}</Text>}
        </View>
        <ScrollView bounces={false}>
          {sections?.standard.map(row)}
          {!!sections?.host.length && (<><View style={{ height: 1, backgroundColor: colors.hairline, marginVertical: 4 }} />{label("Host controls")}{sections.host.map(row)}</>)}
          {!!sections?.moderator.length && (<><View style={{ height: 1, backgroundColor: colors.hairline, marginVertical: 4 }} />{label("Moderation")}{sections.moderator.map(row)}</>)}
        </ScrollView>
        <Pressable onPress={onClose} style={{ height: 40, alignItems: "center", justifyContent: "center", marginTop: 4 }}>
          <Text style={{ color: colors.muted, fontFamily: fonts.semi, fontSize: 13.5 }}>Cancel</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

/* Reports, notes and history for a moderator. */
interface ModData {
  suspended_until: string | null;
  reports: { id: string; reason: string; context: string; description: string | null; message_content: string | null; status: string; created_at: string }[];
  notes: { note: string; created_at: string; author: string | null }[];
}

function ModPanel({ target, onClose }: { target: MenuTarget; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [data, setData] = useState<ModData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const load = useCallback(async () => {
    const { data: d, error: e } = await supabase.rpc("mod_get_user_moderation", { p_user: target.userId });
    if (e) setError(e.message);
    else setData(d as ModData);
  }, [target.userId]);
  useEffect(() => { void load(); }, [load]);
  async function addNote() {
    if (!note.trim()) return;
    setSaving(true);
    const { error: e } = await supabase.rpc("mod_add_note", { p_user: target.userId, p_note: note.trim() });
    setSaving(false);
    if (e) setError(e.message);
    else { setNote(""); void load(); }
  }
  const suspended = !!data?.suspended_until && new Date(data.suspended_until).getTime() > Date.now();
  const title = (t: string) => <Text style={{ color: colors.faint, fontFamily: fonts.semi, fontSize: 11, letterSpacing: 0.8, marginBottom: 8, marginTop: 6 }}>{t.toUpperCase()}</Text>;
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)" }} />
      <View style={{ backgroundColor: "#121215", borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, borderBottomWidth: 0, borderColor: colors.border, paddingHorizontal: 20, paddingTop: 18, paddingBottom: 16 + insets.bottom, maxHeight: Math.round(height * 0.86) }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <Text style={{ color: colors.text, fontFamily: fonts.bold, fontSize: 17 }}>Moderation — @{target.username}</Text>
          <Pressable onPress={onClose} hitSlop={8} style={{ width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border }}>
            <Ionicons name="close" size={14} color={colors.muted} />
          </Pressable>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled">
          {error && <Text style={{ color: "#fca5a5", fontFamily: fonts.body, fontSize: 12.5, marginBottom: 12 }}>{error}</Text>}
          {!data && !error && <Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 13, textAlign: "center", paddingVertical: 24 }}>Loading…</Text>}
          {data && (
            <>
              {suspended && (
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, backgroundColor: "#1c1010", borderWidth: 1, borderColor: "#5a2a2a", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, marginBottom: 14 }}>
                  <Text style={{ color: "#fca5a5", fontFamily: fonts.body, fontSize: 12.5, flex: 1 }}>Suspended until {new Date(data.suspended_until!).getFullYear() > 9000 ? "forever (banned)" : new Date(data.suspended_until!).toLocaleString()}</Text>
                  <Pressable onPress={() => void supabase.rpc("mod_unsuspend_user", { p_user: target.userId }).then(() => load())} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border }}>
                    <Text style={{ color: colors.text, fontFamily: fonts.semi, fontSize: 11.5 }}>Lift suspension</Text>
                  </Pressable>
                </View>
              )}
              {title(`Reports (${data.reports.length})`)}
              {data.reports.length === 0 ? <Text style={{ color: colors.faint, fontFamily: fonts.body, fontSize: 12.5, marginBottom: 14 }}>No reports against this user.</Text> : data.reports.slice(0, 10).map((r) => (
                <View key={r.id} style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, marginBottom: 8 }}>
                  <Text style={{ fontFamily: fonts.body, fontSize: 12, marginBottom: 2 }}>
                    <Text style={{ color: "#fca5a5", fontFamily: fonts.semi }}>{r.reason.replace(/_/g, " ")}</Text>
                    <Text style={{ color: colors.faint }}> · {r.context} · {r.status} · {new Date(r.created_at).toLocaleDateString()}</Text>
                  </Text>
                  {!!r.message_content && <Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 12, fontStyle: "italic" }}>“{r.message_content}”</Text>}
                  {!!r.description && <Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 12 }}>{r.description}</Text>}
                </View>
              ))}
              {title(`Moderation history & notes (${data.notes.length})`)}
              {data.notes.length === 0 ? <Text style={{ color: colors.faint, fontFamily: fonts.body, fontSize: 12.5, marginBottom: 14 }}>No notes yet.</Text> : data.notes.slice(0, 15).map((n, i) => (
                <Text key={i} style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 12.5, lineHeight: 18, marginBottom: 6 }}>
                  <Text style={{ color: colors.faint }}>{new Date(n.created_at).toLocaleDateString()}{n.author ? ` · @${n.author}` : ""} — </Text>{n.note}
                </Text>
              ))}
              <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
                <TextInput value={note} onChangeText={(t) => setNote(t.slice(0, 2000))} placeholder="Add a moderator note…" placeholderTextColor={colors.faint} onSubmitEditing={() => void addNote()} style={{ flex: 1, height: 38, paddingHorizontal: 12, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 10, color: colors.text, fontFamily: fonts.body, fontSize: 13 }} />
                <Pressable onPress={() => void addNote()} disabled={saving || !note.trim()} style={{ paddingHorizontal: 18, borderRadius: 999, backgroundColor: colors.blue, alignItems: "center", justifyContent: "center", opacity: saving || !note.trim() ? 0.5 : 1 }}>
                  <Text style={{ color: "#fff", fontFamily: fonts.semi, fontSize: 13 }}>{saving ? "…" : "Add"}</Text>
                </Pressable>
              </View>
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}
