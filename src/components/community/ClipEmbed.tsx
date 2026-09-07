"use client";

/* Inline clip player for community posts. A post created from a clip's
   "Post to community" button carries the clip URL as its body; this
   component spots a /clips/<uuid> link in the body, fetches the clip,
   and embeds the range player. Renders nothing for ordinary posts, so
   it's safe to mount on every open post. */

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import ReplayPlayer from "@/components/agora/ReplayPlayer";

const CLIP_LINK = /\/clips\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

/** The clip id a post body links to, or null. */
export function clipIdInBody(body: string | null | undefined): string | null {
  if (!body) return null;
  const m = body.match(CLIP_LINK);
  return m ? m[1].toLowerCase() : null;
}

const CLIP_URL_TOKEN = /\S*\/clips\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\S*/gi;

/** The body without its clip link: the clip is shown as a player or a
    chip wherever the post renders, so the bare URL would only repeat it
    as a line of text. Empty string when the link was all there was. */
export function stripClipLink(body: string | null | undefined): string {
  if (!body) return "";
  if (!clipIdInBody(body)) return body;
  return body
    .replace(CLIP_URL_TOKEN, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export default function ClipEmbed({ body }: { body: string | null | undefined }) {
  const [supabase] = useState(() => createClient());
  const clipId = clipIdInBody(body);
  const [clip, setClip] = useState<{
    src: string | null;
    range: { start: number; end: number } | null;
    href: string;
  } | null>(null);

  useEffect(() => {
    if (!clipId) { setClip(null); return; }
    let alive = true;
    supabase
      .from("clips")
      .select("id, video_url, start_seconds, end_seconds, room:debate_rooms(recording_url)")
      .eq("id", clipId)
      .maybeSingle()
      .then(({ data }) => {
        if (!alive || !data) return;
        const row = data as unknown as {
          video_url: string | null; start_seconds: number | null; end_seconds: number | null;
          room: { recording_url: string | null } | null;
        };
        const src = row.video_url ?? row.room?.recording_url ?? null;
        if (!src) return;
        setClip({
          src,
          range: !row.video_url && row.start_seconds !== null && row.end_seconds !== null
            ? { start: row.start_seconds, end: row.end_seconds }
            : null,
          href: `/clips/${clipId}`,
        });
      });
    return () => { alive = false; };
  }, [clipId, supabase]);

  if (!clip) return null;
  return (
    <div className="mt-2">
      <ReplayPlayer src={clip.src} range={clip.range} />
      <a href={clip.href} style={{ display: "inline-block", marginTop: 6, fontSize: 12, color: "#8b8b94", textDecoration: "none" }}>
        Open clip page →
      </a>
    </div>
  );
}
