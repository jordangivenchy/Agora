"use client";

/* /replays/<motion-slug>-<short8> — the replay's own front door.
   Renders DebateReplay directly: no 3D scene, no LiveKit, no live-room
   machinery in the bundle, so a replay link opens instantly instead of
   "entering the Agora" first. Ended rooms reached via /agora/<id> still
   render the replay there, so old links keep working. */

import { use, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";
import DebateReplay from "@/components/agora/DebateReplay";
import { parseRoomParam } from "@/lib/urls";

export default function ReplayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawParam } = use(params);
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const parsed = useMemo(() => parseRoomParam(rawParam), [rawParam]);
  const [roomId, setRoomId] = useState<string | null>(parsed.uuid ?? null);

  useEffect(() => {
    if (parsed.uuid) { setRoomId(parsed.uuid); return; }
    if (!parsed.prefix) { router.replace("/"); return; }
    let alive = true;
    supabase.rpc("resolve_room_prefix", { p_prefix: parsed.prefix }).then(({ data }) => {
      if (!alive) return;
      if (data) setRoomId(data as string);
      else router.replace("/");
    });
    return () => { alive = false; };
  }, [parsed, supabase, router]);

  if (!roomId) {
    return (
      <div className="dr-loading-page">
        <div className="dr-spinner" />
        <span>Opening the replay…</span>
      </div>
    );
  }
  return <DebateReplay roomId={roomId} />;
}
