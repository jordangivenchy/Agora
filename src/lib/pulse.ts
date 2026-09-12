/* Yesterday on the site, in numbers, for the morning digest. Server-only
   (service role): sign-ups, rooms held and their minutes, posts and
   comments, queue matches. */

import { createAdminClient } from "@/lib/supabase-admin";
import type { PulseCounts } from "@/lib/discord";

export async function pulseCounts(sinceIso: string): Promise<PulseCounts> {
  const admin = createAdminClient();
  const [users, rooms, posts, comments, matches] = await Promise.all([
    admin.from("users").select("id", { count: "exact", head: true }).gte("created_at", sinceIso),
    admin.from("debate_rooms").select("started_at, ended_at").eq("status", "ended").gte("started_at", sinceIso),
    admin.from("community_posts").select("id", { count: "exact", head: true }).gte("created_at", sinceIso),
    admin.from("community_comments").select("id", { count: "exact", head: true }).gte("created_at", sinceIso),
    admin.from("debate_rooms").select("id", { count: "exact", head: true }).eq("pro_size", 1).eq("con_size", 1).gte("created_at", sinceIso),
  ]);
  const held = (rooms.data ?? []) as Array<{ started_at: string | null; ended_at: string | null }>;
  const minutes = Math.round(
    held.reduce((acc, r) => {
      const ms = Date.parse(r.ended_at ?? "") - Date.parse(r.started_at ?? "");
      return acc + (Number.isFinite(ms) && ms > 0 ? ms : 0);
    }, 0) / 60_000
  );
  return {
    signups: users.count ?? 0,
    rooms: held.length,
    minutes,
    posts: posts.count ?? 0,
    comments: comments.count ?? 0,
    matches: matches.count ?? 0,
  };
}
