import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { isRoomUuid } from "@/lib/roomLifecycle";

/* A recording's playlist text, from our own origin, for the replay page's
   transcript timing (components/agora/hlsTimeline). The bucket serves
   playlists without CORS headers, so the page can play them but can't
   read them. Only rooms the caller can see (RLS), and only playlists in
   the recordings bucket. */

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const base = process.env.HLS_PUBLIC_BASE_URL?.replace(/\/$/, "");
  if (!isRoomUuid(id) || !base) return new NextResponse("Not found", { status: 404 });
  const supabase = await createClient();
  const { data: room } = await supabase.from("debate_rooms").select("recording_url").eq("id", id).maybeSingle();
  const url = room?.recording_url as string | null | undefined;
  if (!url || !url.startsWith(`${base}/`)) return new NextResponse("Not found", { status: 404 });
  const res = await fetch(url, { cache: "no-store" }).catch(() => null);
  if (!res?.ok) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(await res.text(), {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "private, max-age=60" },
  });
}
