"use client";

/* Inline replay player for a room's discussion post. Rooms point at
   their thread via debate_rooms.discussion_post_id, so the post detail
   can reverse-look-up the recording and embed the VOD player directly
   instead of leaving readers a bare /agora link. Renders nothing for
   ordinary posts (the lookup misses) or while the recording is still
   finalizing, so it's safe to mount on every open post. */

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import ReplayPlayer from "@/components/agora/ReplayPlayer";
import { Icon } from "@/components/icons";

export default function ReplayEmbed({ postId }: { postId: string }) {
  const [supabase] = useState(() => createClient());
  const [rec, setRec] = useState<{ roomId: string; url: string } | null>(null);

  useEffect(() => {
    let alive = true;
    setRec(null);
    supabase
      .from("debate_rooms")
      .select("id, recording_url, status")
      .eq("discussion_post_id", postId)
      .maybeSingle()
      .then(({ data }) => {
        if (alive && data?.recording_url && data.status === "ended") {
          setRec({ roomId: data.id, url: data.recording_url });
        }
      });
    return () => { alive = false; };
  }, [postId, supabase]);

  if (!rec) return null;
  return (
    <div className="mt-2">
      {/* If the playlist can't load (still finalizing, pruned) the player
          renders nothing and the pointer link below carries the thread. */}
      <ReplayPlayer src={rec.url} style={{ border: "0.5px solid #2e2e38", maxHeight: 480 }} />
      <a
        href={`/agora/${rec.roomId}`}
        className="inline-flex items-center gap-1.5 mt-1.5 text-[11px] no-underline"
        style={{ color: "#8b8b94" }}
      >
        Open the full replay — transcript, click-to-seek <Icon name="arrow-up-right" size={11} />
      </a>
    </div>
  );
}
