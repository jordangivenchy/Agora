/* POST /api/clips/<id>/export — the clip as a file to post.

   A clip is a start and an end on a room's recording; this renders that
   stretch upright, with the words burned on and the motion across the
   top, puts it in the recordings bucket and hands back the link. One
   render per clip: the second person to ask gets the same file.

   Who may: anyone who can read the clip. The rendering is ours, not the
   caller's — the recording is public, the transcript is what the replay
   already shows. */

import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient, hasAdminCredentials } from "@/lib/supabase-admin";
import { putObject, readHlsEnv } from "@/lib/recordingEgress";
import { assCaptions, cropdetectArgs, exportArgs, exportKey, layoutFor, parseCropdetect, parseFrameSize, type Box } from "@/lib/clipExport";

const run = promisify(execFile);

/* A minute of video is a few seconds of work; the ceiling is for a long
   clip on a cold machine. */
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/** The longest stretch worth rendering: past this it isn't a clip. */
const MAX_CLIP_SECONDS = 180;

interface ClipRow {
  id: string;
  room_id: string;
  title: string | null;
  start_seconds: number | null;
  end_seconds: number | null;
  export_url: string | null;
  room: { motion: string | null; recording_url: string | null; recording_started_at: string | null } | null;
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const hls = readHlsEnv();
  if (!hls) return NextResponse.json({ error: "Exports aren't set up on this deployment." }, { status: 503 });
  if (!ffmpegPath) return NextResponse.json({ error: "No renderer on this deployment." }, { status: 503 });

  const supabase = await createClient();
  const { data } = await supabase
    .from("clips")
    .select("id, room_id, title, start_seconds, end_seconds, export_url, room:debate_rooms(motion, recording_url, recording_started_at)")
    .eq("id", id)
    .maybeSingle();
  const clip = data as unknown as ClipRow | null;
  if (!clip) return NextResponse.json({ error: "That clip isn't there." }, { status: 404 });

  /* Rendered before: the same file, at once. */
  if (clip.export_url) return NextResponse.json({ url: clip.export_url, rendered: false });

  const src = clip.room?.recording_url ?? null;
  if (!src) return NextResponse.json({ error: "That discussion has no recording to cut from." }, { status: 409 });
  const start = Math.max(0, clip.start_seconds ?? 0);
  const end = clip.end_seconds ?? start + 30;
  if (end <= start) return NextResponse.json({ error: "That clip has no length." }, { status: 409 });
  if (end - start > MAX_CLIP_SECONDS) {
    return NextResponse.json({ error: `Clips longer than ${MAX_CLIP_SECONDS / 60} minutes can't be exported.` }, { status: 409 });
  }

  const dir = await mkdtemp(path.join(tmpdir(), "clip-"));
  try {
    /* What the picture occupies, and so how to lay it out. cropdetect
       writes its findings to stderr and exits non-zero on the null
       muxer, so both paths are read the same way. */
    let box: Box | null = null;
    let probed = "";
    try {
      probed = (await run(ffmpegPath, cropdetectArgs(src, start + Math.min(2, (end - start) / 2)), { maxBuffer: 1 << 24 })).stderr;
    } catch (e) {
      probed = String((e as { stderr?: string }).stderr ?? "");
    }
    /* A room where nobody turned a camera on is nearly black, and there
       is nothing for cropdetect to find: take the whole frame. */
    box = parseCropdetect(probed) ?? parseFrameSize(probed);
    if (!box) return NextResponse.json({ error: "Couldn't read that recording." }, { status: 502 });

    /* The words over this stretch, if the discussion has any. Offsets
       are counted from the recording's start, as the replay counts them. */
    const { data: said } = await supabase
      .from("debate_utterances")
      .select("content, created_at")
      .eq("room_id", clip.room_id)
      .order("created_at", { ascending: true })
      .limit(2000);
    const startedAt = clip.room?.recording_started_at ? Date.parse(clip.room.recording_started_at) : null;
    const lines = ((said ?? []) as { content: string; created_at: string }[])
      .map((u) => ({
        content: u.content,
        offset_seconds: startedAt ? Math.max(0, (Date.parse(u.created_at) - startedAt) / 1000) : 0,
      }))
      .filter((l) => !!startedAt && l.content.trim().length > 0);

    let assPath: string | null = null;
    if (lines.length) {
      const ass = assCaptions(lines, start, end);
      if (ass.includes("Dialogue:")) {
        assPath = path.join(dir, "captions.ass");
        await writeFile(assPath, ass, "utf8");
      }
    }

    const outPath = path.join(dir, "clip.mp4");
    await run(
      ffmpegPath,
      exportArgs({
        src,
        startSeconds: start,
        endSeconds: end,
        box,
        layout: layoutFor(box),
        motion: clip.room?.motion || clip.title || "AgoraSphere",
        assPath,
        outPath,
      }),
      { maxBuffer: 1 << 26 },
    );

    const bytes = await readFile(outPath);
    const key = exportKey(clip.id);
    await putObject(hls, key, bytes, "video/mp4");
    const url = `${hls.publicBase.replace(/\/$/, "")}/${key}`;

    /* Remembered on the clip, so it renders once. Written with the
       service role: the file is ours, not the caller's. */
    if (hasAdminCredentials()) {
      await createAdminClient().from("clips").update({ export_url: url }).eq("id", clip.id);
    }
    return NextResponse.json({ url, rendered: true, seconds: end - start });
  } catch (e) {
    const detail = String((e as { stderr?: string }).stderr ?? (e as Error).message ?? e).slice(0, 300);
    console.error("clip export failed", detail);
    return NextResponse.json({ error: "Couldn't make the file — try again." }, { status: 500 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
