/* Clips, the site's rows (app/(chrome)/clips/[id]/page.tsx,
   components/clips/ClipTile.tsx, components/agora/ClipEditor.tsx): a
   window of a room's recording, or an uploaded file; the most watched
   across the Agora; one view per clip per launch. */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface ClipHost { id: string; username: string; display_name: string | null; avatar_url: string | null; verified: boolean }
export interface ClipRow {
  id: string;
  title: string;
  duration_seconds: number | null;
  video_url: string | null;
  start_seconds: number | null;
  end_seconds: number | null;
  room_id: string | null;
  uploader_id: string;
  view_count: number;
  created_at: string;
  uploader: { username: string; display_name: string | null; avatar_url: string | null } | null;
  room: { id: string; motion: string; recording_url: string | null; status: string; topic_key: string | null; host: ClipHost | ClipHost[] | null } | null;
}
export interface ClipTileData {
  id: string;
  title: string;
  duration_seconds: number | null;
  view_count: number;
  thumb_gradient: string | null;
  thumbnail_url: string | null;
  room_id: string | null;
  uploader: { username: string; display_name: string | null; avatar_url: string | null } | null;
}

const CLIP_SELECT =
  "id, title, duration_seconds, video_url, start_seconds, end_seconds, room_id, uploader_id, view_count, created_at, " +
  "uploader:users!clips_uploader_id_fkey(username, display_name, avatar_url), " +
  "room:debate_rooms(id, motion, recording_url, status, topic_key, host:users!debate_rooms_host_id_fkey(id, username, display_name, avatar_url, verified))";
const MORE_SELECT =
  "id, title, duration_seconds, view_count, thumb_gradient, room_id, " +
  "uploader:users!clips_uploader_id_fkey(username, display_name, avatar_url), room:debate_rooms(thumbnail_url)";

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

type RawClip = Omit<ClipRow, "uploader" | "room"> & { uploader: ClipRow["uploader"] | ClipRow["uploader"][]; room: NonNullable<ClipRow["room"]> | NonNullable<ClipRow["room"]>[] | null };

export async function fetchClip(supabase: SupabaseClient, id: string): Promise<ClipRow | null> {
  const { data } = await supabase.from("clips").select(CLIP_SELECT).eq("id", id).maybeSingle();
  if (!data) return null;
  const row = data as unknown as RawClip;
  const room = one(row.room);
  return { ...row, uploader: one(row.uploader), room: room ? { ...room, host: one(room.host) } : null };
}

function tileOf(r: { id: string; title: string; duration_seconds: number | null; view_count: number | null; thumb_gradient: string | null; room_id: string | null; uploader: ClipTileData["uploader"] | ClipTileData["uploader"][]; room: { thumbnail_url: string | null } | { thumbnail_url: string | null }[] | null }): ClipTileData {
  return { id: r.id, title: r.title, duration_seconds: r.duration_seconds, view_count: r.view_count ?? 0, thumb_gradient: r.thumb_gradient, thumbnail_url: one(r.room)?.thumbnail_url ?? null, room_id: r.room_id, uploader: one(r.uploader) };
}

/** The most watched, newest first among equals; `exclude` and `sameRoomFirst` shape the clip page's row. */
export async function fetchClips(supabase: SupabaseClient, opts: { exclude?: string; sameRoomFirst?: string | null; limit?: number } = {}): Promise<ClipTileData[]> {
  let q = supabase.from("clips").select(MORE_SELECT).order("view_count", { ascending: false }).order("created_at", { ascending: false }).limit(opts.limit ?? 24);
  if (opts.exclude) q = q.neq("id", opts.exclude);
  const { data } = await q;
  const rows = ((data ?? []) as unknown as Parameters<typeof tileOf>[0][]).map(tileOf);
  if (!opts.sameRoomFirst) return rows;
  const same = rows.filter((r) => r.room_id === opts.sameRoomFirst);
  return [...same, ...rows.filter((r) => !same.includes(r))];
}

export async function fetchUserClips(supabase: SupabaseClient, uid: string): Promise<ClipTileData[]> {
  const { data } = await supabase.from("clips").select(MORE_SELECT).eq("uploader_id", uid).order("created_at", { ascending: false }).limit(40);
  return ((data ?? []) as unknown as Parameters<typeof tileOf>[0][]).map(tileOf);
}

const viewed = new Set<string>();
export function bumpClipView(supabase: SupabaseClient, id: string): boolean {
  if (viewed.has(id)) return false;
  viewed.add(id);
  void supabase.rpc("bump_clip_view", { p_clip: id }).then(undefined, () => undefined);
  return true;
}

export async function saveClip(supabase: SupabaseClient, uid: string, roomId: string, title: string, start: number, end: number): Promise<{ id?: string; error?: string }> {
  const s = Math.floor(start), e = Math.ceil(end);
  const { data, error } = await supabase.from("clips").insert({ uploader_id: uid, title: title.trim() || "Clip", room_id: roomId, start_seconds: s, end_seconds: e, duration_seconds: Math.max(1, e - s) }).select("id").single();
  if (error) return { error: "Couldn't save the clip — try again." };
  return { id: (data as { id: string }).id };
}

const GRADIENTS: [string, string][] = [["#0d1b4b", "#2d1b69"], ["#0a2e1a", "#1a4d3a"], ["#1a0a00", "#3d2200"], ["#0d0a2e", "#2a1a5a"], ["#2e0a0a", "#5a1a1a"], ["#0a2a2e", "#1a4a5a"]];
export function clipColors(seed: string, gradient: string | null): [string, string] {
  const m = gradient?.match(/#[0-9a-f]{6}/gi);
  if (m && m.length >= 2) return [m[0], m[1]];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return GRADIENTS[Math.abs(h) % GRADIENTS.length];
}
export function formatClipDuration(seconds: number | null | undefined): string | null {
  if (seconds == null || seconds <= 0) return null;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
export function formatViews(n: number): string {
  const short = n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, "")}k` : String(n);
  return `${short} view${n === 1 ? "" : "s"}`;
}
export function agoLong(iso: string): string {
  const mins = Math.floor((Date.now() - +new Date(iso)) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
  return `${Math.floor(days / 365)} year${Math.floor(days / 365) === 1 ? "" : "s"} ago`;
}

const CLIP_LINK = /\/clips\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
const CLIP_URL_TOKEN = /\S*\/clips\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\S*/gi;
/** The clip id a post body links to, or null. */
export function clipIdInBody(body: string | null | undefined): string | null {
  if (!body) return null;
  const m = body.match(CLIP_LINK);
  return m ? m[1].toLowerCase() : null;
}
/** The body without its clip link (the clip is shown as a chip). */
export function stripClipLink(body: string | null | undefined): string {
  if (!body) return "";
  if (!clipIdInBody(body)) return body;
  return body.replace(CLIP_URL_TOKEN, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
