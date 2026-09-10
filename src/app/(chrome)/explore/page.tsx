/* /explore — every open room, with filters. The banner's figures are
   fetched here on the server so they are up with the page; the rooms
   themselves load as the viewer once the page is up. */

import type { Metadata } from "next";
import { createClient } from "@/lib/supabase-server";
import ExplorePage from "@/components/ExplorePage";

export const metadata: Metadata = { title: "Explore · AgoraSphere" };

export default async function ExploreRoute() {
  const supabase = await createClient();
  const [{ count: activeRooms }, { count: members }, { data: live }] = await Promise.all([
    supabase.from("debate_rooms").select("id", { count: "exact", head: true }).in("status", ["live", "created", "scheduled"]),
    supabase.from("users").select("id", { count: "exact", head: true }),
    supabase.from("debate_rooms").select("viewer_count").eq("status", "live"),
  ]);
  const watching = ((live ?? []) as { viewer_count: number | null }[]).reduce((s, r) => s + (r.viewer_count ?? 0), 0);
  return (
    <>
      <main className="main" style={{ marginTop: 0 }}>
        <ExplorePage stats={{ activeRooms: activeRooms ?? 0, members: members ?? 0, watching }} />
      </main>
    </>
  );
}
