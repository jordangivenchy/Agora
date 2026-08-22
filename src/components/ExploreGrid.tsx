"use client";

/* Explore results, rendered as the homepage's discussion blocks (RoomCard)
   instead of the MVP's legacy text cards. The Explore page's filter pills
   and search are still the vanilla machinery in mvp-home.js; its
   renderCards() now just tells us WHICH rooms survived the filters via
   `agora:explore-results` ({ ids }), and we draw them. Strangler step:
   the data + cards are React, the chrome is still MVP. */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase-browser";
import RoomCard, { type RoomCardRoom } from "./RoomCard";

export const EXPLORE_RESULTS_EVENT = "agora:explore-results";

export default function ExploreGrid({ container }: { container: HTMLElement | null }) {
  const [supabase] = useState(() => createClient());
  const [rooms, setRooms] = useState<Map<string, RoomCardRoom>>(new Map());
  const [ids, setIds] = useState<string[] | null>(null);

  /* Same room shape the homepage blocks use; refreshed on every filter
     pass so statuses/viewers stay current. */
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const { data } = await supabase
        .from("debate_rooms")
        .select("id, motion, topic_key, status, format, scheduled_start, viewer_count, thumbnail_url, host:users!host_id(id, username, display_name, avatar_url), community:communities!community_id(id, name, color)")
        .in("status", ["live", "created", "scheduled"])
        .limit(200);
      if (!alive) return;
      const map = new Map<string, RoomCardRoom>();
      for (const r of (data ?? []) as unknown as RoomCardRoom[]) map.set(r.id, r);
      setRooms(map);
    };
    load();
    const onResults = (e: Event) => {
      const detail = (e as CustomEvent<{ ids?: string[] }>).detail;
      setIds(Array.isArray(detail?.ids) ? detail.ids : []);
      load();
    };
    window.addEventListener(EXPLORE_RESULTS_EVENT, onResults);
    return () => { alive = false; window.removeEventListener(EXPLORE_RESULTS_EVENT, onResults); };
  }, [supabase]);

  if (!container) return null;
  const list = (ids ?? []).map((id) => rooms.get(id)).filter((r): r is RoomCardRoom => !!r);

  return createPortal(
    ids === null ? null : list.length === 0 ? (
      <div className="explore-empty">Nothing matches your filters</div>
    ) : (
      <div className="flex flex-wrap gap-3">
        {list.map((r) => <RoomCard key={r.id} room={r} />)}
      </div>
    ),
    container
  );
}
