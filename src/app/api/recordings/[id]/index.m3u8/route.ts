import { NextResponse } from "next/server";
import { createAdminClient, hasAdminCredentials } from "@/lib/supabase-admin";
import { isRoomUuid } from "@/lib/roomLifecycle";
import { partFiles, readParts, stitchPlaylists } from "@/lib/recordingParts";

/* The replay of a recording in parts (lib/recordingParts): every part's
   index.m3u8 from the bucket, stitched in order. recording_url points
   here once a room has a second part; a one-part recording plays
   straight from the bucket. The parts are public files at room-derived
   addresses already, so this answers anyone (src/proxy.ts exempts it:
   the app's native player carries no beta pass). */

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isRoomUuid(id)) return new NextResponse("Not found", { status: 404 });
  const base = process.env.HLS_PUBLIC_BASE_URL?.replace(/\/$/, "");
  if (!base || !hasAdminCredentials()) return new NextResponse("Not configured", { status: 503 });

  const { data: room } = await createAdminClient()
    .from("debate_rooms")
    .select("status, recording_url, recording_parts")
    .eq("id", id)
    .maybeSingle();
  if (!room?.recording_url) return new NextResponse("Not found", { status: 404 });

  const parts = readParts(room.recording_parts, room.recording_url);
  const playlists = await Promise.all(
    parts.map(async (p) => {
      const url = `${base}/${partFiles(id, p.n).playlistName}`;
      try {
        const res = await fetch(url, { cache: "no-store" });
        return { url, text: res.ok ? await res.text() : null };
      } catch {
        return { url, text: null };
      }
    })
  );
  const body = stitchPlaylists(playlists, room.status === "ended");
  const final = body.includes("#EXT-X-ENDLIST");
  return new NextResponse(body, {
    headers: {
      "content-type": "application/vnd.apple.mpegurl",
      /* A finished recording never changes; one still growing is re-read. */
      "cache-control": final ? "public, max-age=300, s-maxage=86400" : "no-store",
      "access-control-allow-origin": "*",
    },
  });
}
