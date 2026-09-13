/* A room as the amphitheater page reads it (app/agora/[id]/page.tsx):
   the row with its host, the gate that says why it can't be read, the
   speaker queue, the stage invites, the frame, and the site's API for
   the recording. Everything writes the same rows the website writes. */
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { apiFetch, SITE, type ApiAuth } from "./api";
import type { RoomHost } from "./rooms";
import type { Seat } from "./stageModel";

export interface RoomFraming {
  about?: string | null;
  about_by?: string | null;
  about_at?: string | null;
  stances?: Record<string, { text: string; at: string }> | null;
}

export interface RoomDetail {
  id: string;
  motion: string;
  status: string;
  scheduled_start: string | null;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
  viewer_count: number | null;
  host_id: string;
  topic_key: string | null;
  community_id: string | null;
  pro_size: number | null;
  con_size: number | null;
  speaker_requests_locked: boolean | null;
  queue_auto_advance: boolean | null;
  mic_user_id: string | null;
  thumbnail_url: string | null;
  hls_url: string | null;
  recording_url: string | null;
  framing: RoomFraming | null;
  host_left_at: string | null;
  is_private: boolean | null;
  access_mode: string | null;
  host: RoomHost | RoomHost[] | null;
}

export const ROOM_SELECT =
  "id, motion, status, scheduled_start, started_at, ended_at, created_at, viewer_count, host_id, topic_key, community_id, pro_size, con_size, " +
  "speaker_requests_locked, queue_auto_advance, mic_user_id, thumbnail_url, hls_url, recording_url, framing, host_left_at, is_private, access_mode, " +
  "host:users!host_id(username, display_name, avatar_url)";

export function roomHost(room: RoomDetail): RoomHost | null {
  return Array.isArray(room.host) ? room.host[0] ?? null : room.host;
}

/** The row, or null when it doesn't exist or this visitor may not read it. Throws on a failed request. */
export async function fetchRoom(supabase: SupabaseClient, id: string): Promise<RoomDetail | null> {
  const { data, error } = await supabase.from("debate_rooms").select(ROOM_SELECT).eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as unknown as RoomDetail | null) ?? null;
}

export interface Gate {
  room_exists: boolean;
  allowed: boolean;
  motion: string | null;
  host_username: string | null;
  access_mode: string | null;
  status: string | null;
  community_name: string | null;
}

/** Gone, or off-limits: the answer when the row came back empty. Null when the question failed. */
export async function fetchGate(supabase: SupabaseClient, id: string): Promise<Gate | null> {
  const { data, error } = await supabase.rpc("get_room_gate", { p_room: id });
  if (error) return null;
  const g = (Array.isArray(data) ? data[0] : data) as Gate | null;
  return g ?? { room_exists: false, allowed: false, motion: null, host_username: null, access_mode: null, status: null, community_name: null };
}

export function gateCopy(g: Gate): string {
  const who = g.host_username ? `@${g.host_username}` : "the host";
  if (g.access_mode === "friends") return `This room is open to ${who}'s friends only.`;
  if (g.access_mode === "followers") return `This room is open to people who follow ${who}.`;
  if (g.access_mode === "community") return `This room is for members of ${g.community_name ?? "its community"} — join the community to enter.`;
  return "This room is invite-only — enter the code to join.";
}

/** The invite code is the key; on success join_private_room seats us. */
export async function joinWithCode(supabase: SupabaseClient, code: string): Promise<{ roomId?: string; error?: string }> {
  const { data, error } = await supabase.rpc("join_private_room", { p_code: code.trim().toUpperCase(), p_role: "spectator" });
  if (error) {
    const msg = error.message || "";
    return {
      error: msg.includes("invalid_or_expired") ? "That code doesn't match a live room."
        : msg.includes("banned_from_room") ? "You've been removed from this room."
        : "Couldn't join with that code — try again.",
    };
  }
  const row = (Array.isArray(data) ? data[0] : data) as { room_id?: string } | null;
  return row?.room_id ? { roomId: row.room_id } : { error: "That code doesn't match a live room." };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A route param is a uuid, or a pretty slug ending in an 8-char id prefix (lib/urls.ts). */
export function parseRoomParam(param: string): { uuid?: string; prefix?: string } {
  const dec = decodeURIComponent(param);
  if (UUID_RE.test(dec)) return { uuid: dec.toLowerCase() };
  const m = dec.match(/([0-9a-f]{8})$/i);
  return m ? { prefix: m[1].toLowerCase() } : {};
}

export async function resolvePrefix(supabase: SupabaseClient, prefix: string): Promise<string | null> {
  const { data } = await supabase.rpc("resolve_room_prefix", { p_prefix: prefix });
  return typeof data === "string" ? data : null;
}

export function roomSlug(motion: string | null | undefined): string {
  return (motion ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
}

/** The room's link on the site, the pretty form. */
export function roomLink(room: { id: string; motion?: string | null }): string {
  const slug = roomSlug(room.motion);
  const short = room.id.slice(0, 8);
  return `${SITE}/agora/${slug ? `${slug}-${short}` : short}`;
}

export function fmtElapsed(fromIso: string | null): string {
  if (!fromIso) return "00:00:00";
  const ms = Date.now() - new Date(fromIso).getTime();
  if (ms < 0) return "00:00:00";
  const s = Math.floor(ms / 1000);
  const hh = String(Math.floor(s / 3600)).padStart(2, "0");
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

/* ── The speaker queue (the DB timestamps are the queue) ─────────── */
export const stepDownFromMic = (supabase: SupabaseClient, roomId: string) => supabase.rpc("step_down_from_mic", { p_room: roomId });
export const advanceQueue = (supabase: SupabaseClient, roomId: string) => supabase.rpc("advance_speaker_queue", { p_room: roomId });

/* ── Coming back after the screen locked ─────────────────────────── */
export const touchSeat = (supabase: SupabaseClient, roomId: string) => supabase.rpc("touch_seat", { p_room: roomId }).then(undefined, () => undefined);
export const clearHostLeft = (supabase: SupabaseClient, roomId: string) => supabase.rpc("clear_host_left", { p_room: roomId }).then(undefined, () => undefined);

/** A seat stamped out while we were away comes back; one stamped out before the absence (a removal) stands. */
export async function restoreSeat(supabase: SupabaseClient, roomId: string, userId: string, awaySince: number): Promise<void> {
  try {
    const { data: mine } = await supabase.from("debate_participants").select("id, left_at").eq("room_id", roomId).eq("user_id", userId).maybeSingle();
    if (!mine?.left_at) return;
    if (new Date(mine.left_at).getTime() < awaySince - 60_000) return;
    await supabase.from("debate_participants").update({ left_at: null, joined_at: new Date().toISOString() }).eq("id", mine.id);
  } catch {
    /* seating is cosmetic */
  }
}

/* ── Stage invites: the consent moment ───────────────────────────── */
export interface PendingInvite { id: string; inviterName: string }

export async function inviterName(supabase: SupabaseClient, inviterId: string): Promise<string> {
  try {
    const { data } = await supabase.from("users").select("username, display_name").eq("id", inviterId).maybeSingle();
    const u = data as { username?: string | null; display_name?: string | null } | null;
    return u?.display_name?.trim() || u?.username || "The host";
  } catch {
    return "The host";
  }
}

export async function fetchPendingInvite(supabase: SupabaseClient, roomId: string, userId: string): Promise<PendingInvite | null> {
  try {
    const { data } = await supabase.from("stage_invites").select("id, inviter_id").eq("room_id", roomId).eq("invitee_id", userId).eq("status", "pending").order("created_at", { ascending: false }).limit(1);
    const row = (data as { id: string; inviter_id: string }[] | null)?.[0];
    if (!row) return null;
    return { id: row.id, inviterName: await inviterName(supabase, row.inviter_id) };
  } catch {
    return null;
  }
}

export function watchInvites(supabase: SupabaseClient, roomId: string, userId: string, onInvite: (inv: PendingInvite) => void): () => void {
  const channel: RealtimeChannel = supabase
    .channel(`app-invites-${roomId}-${userId}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "stage_invites", filter: `invitee_id=eq.${userId}` }, (payload) => {
      const row = payload.new as { id: string; room_id: string; inviter_id: string; status: string };
      if (row.room_id !== roomId || row.status !== "pending") return;
      void inviterName(supabase, row.inviter_id).then((name) => onInvite({ id: row.id, inviterName: name }));
    })
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}

/** Accepting promotes this participant to speaker; declining just records the answer. */
export async function respondToInvite(supabase: SupabaseClient, inviteId: string, accept: boolean, roomId: string, userId: string, seat: Seat | null): Promise<void> {
  await supabase.from("stage_invites").update({ status: accept ? "accepted" : "declined", responded_at: new Date().toISOString() }).eq("id", inviteId);
  if (!accept) return;
  if (seat) await supabase.from("debate_participants").update({ stage_role: "speaker", hand_raised_at: null }).eq("id", seat.id);
  else await supabase.from("debate_participants").insert({ room_id: roomId, user_id: userId, role: "spectator", stance: null, stage_role: "speaker" });
}

export const sendInvite = (supabase: SupabaseClient, roomId: string, inviterId: string, inviteeId: string) =>
  supabase.from("stage_invites").insert({ room_id: roomId, inviter_id: inviterId, invitee_id: inviteeId });

/* ── The host's room-level switches ──────────────────────────────── */
export const setAutoAdvance = (supabase: SupabaseClient, roomId: string, on: boolean) => supabase.from("debate_rooms").update({ queue_auto_advance: on }).eq("id", roomId);
export const muteAllSpeakers = (supabase: SupabaseClient, roomId: string) =>
  supabase.from("debate_participants").update({ mic_muted: true }).eq("room_id", roomId).eq("stage_role", "speaker").is("left_at", null);
export const endDiscussion = (supabase: SupabaseClient, roomId: string) => supabase.from("debate_rooms").update({ status: "ended", ended_at: new Date().toISOString() }).eq("id", roomId);
export const setSeatMuted = (supabase: SupabaseClient, seatId: string, muted: boolean) => supabase.from("debate_participants").update({ mic_muted: muted }).eq("id", seatId);
export const removeFromRoom = (supabase: SupabaseClient, seatId: string) => supabase.from("debate_participants").update({ left_at: new Date().toISOString() }).eq("id", seatId);

/* ── The frame: what is being argued, and where people stand ─────── */
export const ABOUT_MAX = 1200;
export const STANCE_MAX = 200;
export const FRAME_MAX_LINES = 16;
export function frameLength(md: string): number {
  return md.replace(/\r/g, "").replace(/\n{2,}/g, "\n").length;
}
export function frameLines(md: string): number {
  const t = md.replace(/\r/g, "").trim();
  return t ? t.split("\n").length : 0;
}
export function frameNewsKey(f: RoomFraming | null | undefined): string {
  const stanceTimes = Object.values(f?.stances ?? {}).map((s) => s.at).sort().join(",");
  return `${f?.about_at ?? ""}|${stanceTimes}`;
}
export function frameIsEmpty(f: RoomFraming | null | undefined): boolean {
  return !f?.about?.trim() && Object.keys(f?.stances ?? {}).length === 0;
}
async function frameCall(supabase: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<{ framing?: RoomFraming; error?: string }> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return { error: error.message.replace(/^.*?:\s*/, "") };
  return { framing: (data && typeof data === "object" ? data : {}) as RoomFraming };
}
export const setRoomFrame = (supabase: SupabaseClient, roomId: string, about: string) => frameCall(supabase, "set_room_frame", { p_room: roomId, p_about: about });
export const setRoomStance = (supabase: SupabaseClient, roomId: string, text: string) => frameCall(supabase, "set_room_stance", { p_room: roomId, p_text: text });
export const clearRoomStance = (supabase: SupabaseClient, roomId: string, userId: string) => frameCall(supabase, "clear_room_stance", { p_room: roomId, p_user: userId });

/* ── Reports and notes ───────────────────────────────────────────── */
export async function requestCommunityNote(supabase: SupabaseClient, room: RoomDetail, text: string): Promise<string | null> {
  const { error } = await supabase.rpc("submit_report", {
    p_reported: room.host_id, p_reason: "other", p_description: `[Community note request] ${text.trim()}`, p_context: "room", p_room: room.id, p_message: null,
  });
  return error ? "Couldn't send the request — try again." : null;
}

/* ── Following the host ──────────────────────────────────────────── */
export async function isFollowing(supabase: SupabaseClient, meId: string, hostId: string): Promise<boolean> {
  const { data } = await supabase.from("user_follows").select("following_id").eq("follower_id", meId).eq("following_id", hostId).maybeSingle();
  return !!data;
}
export const setFollowing = (supabase: SupabaseClient, hostId: string, follow: boolean) => supabase.rpc(follow ? "follow_user" : "unfollow_user", { p_target: hostId });

export async function fetchCommunityName(supabase: SupabaseClient, communityId: string): Promise<string | null> {
  const { data } = await supabase.from("communities").select("name").eq("id", communityId).maybeSingle();
  return (data as { name?: string } | null)?.name ?? null;
}

/* ── The site's recording API (/api/egress), the host's own ──────── */
export type EgressAction =
  | { action: "status" }
  | { action: "start"; rtmpUrl: string; portrait: boolean }
  | { action: "start_hls" }
  | { action: "stop"; egressId: string }
  | { action: "stop_all" };

export async function egress(auth: ApiAuth, roomId: string, body: EgressAction): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const res = await apiFetch("/api/egress", auth, { method: "POST", body: JSON.stringify({ roomId, ...body }) }).catch(() => null);
  if (!res) return { ok: false, data: { error: "unreachable" } };
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, data };
}
