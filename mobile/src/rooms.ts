/* Rooms as the home screen needs them: what is live, what is coming.
   Read straight from the tables under the user's own row security, the
   way the website does (lib/homeData.ts). */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface RoomHost {
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
}

export interface RoomRow {
  id: string;
  motion: string;
  status: string;
  scheduled_start: string | null;
  viewer_count: number | null;
  host_id: string;
  topic_key: string | null;
  created_at: string;
  host: RoomHost | RoomHost[] | null;
}

export function hostOf(room: RoomRow): RoomHost | null {
  return Array.isArray(room.host) ? room.host[0] ?? null : room.host;
}

export function hostName(room: RoomRow): string {
  const h = hostOf(room);
  return h?.display_name?.trim() || (h?.username ? `@${h.username}` : "Someone");
}

export async function fetchRooms(supabase: SupabaseClient): Promise<{ live: RoomRow[]; scheduled: RoomRow[] }> {
  const { data, error } = await supabase
    .from("debate_rooms")
    .select("id, motion, status, scheduled_start, viewer_count, host_id, topic_key, created_at, host:users!host_id(username, display_name, avatar_url)")
    .in("status", ["live", "created", "scheduled"])
    .order("created_at", { ascending: false })
    .limit(60);
  if (error) throw error;
  const rows = (data ?? []) as unknown as RoomRow[];
  const live = rows.filter((r) => r.status === "live").sort((a, b) => (b.viewer_count ?? 0) - (a.viewer_count ?? 0));
  const scheduled = rows
    .filter((r) => r.status !== "live" && r.scheduled_start)
    .sort((a, b) => (a.scheduled_start ?? "").localeCompare(b.scheduled_start ?? ""));
  return { live, scheduled };
}

export function whenLabel(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (sameDay) return `Today ${time}`;
  return `${d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })} ${time}`;
}
