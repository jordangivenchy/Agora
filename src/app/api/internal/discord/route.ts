import { NextRequest, NextResponse } from "next/server";
import { createAdminClient, hasAdminCredentials } from "@/lib/supabase-admin";
import { getAppConfig } from "@/lib/appConfig";
import {
  discordConfigured,
  discordWebhook,
  featuredPostMessage,
  postDiscord,
  recordingReadyMessage,
  roomLiveMessage,
  type DiscordUser,
} from "@/lib/discord";

/* Fired by the database (pg_net POST, migration 20260905) when a public
   room goes live, a recording lands, or a moderator features a post.
   The body only names the event and the row; the row is re-read here
   with the service role, so nothing in the payload is trusted and a
   room that ended in the seconds before delivery is skipped rather than
   announced. Posts to the channel's Discord webhook (lib/discord).

   Auth: Bearer <reminder_webhook_secret from app_config> — same
   contract as /api/internal/room-ended. */

const EVENTS = new Set(["room_live", "recording_ready", "post_featured"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function loadUser(id: string | null): Promise<DiscordUser | null> {
  if (!id) return null;
  const { data } = await createAdminClient()
    .from("users")
    .select("username, display_name, avatar_url")
    .eq("id", id)
    .maybeSingle();
  return (data as DiscordUser | null) ?? null;
}

async function loadCommunity(id: string | null): Promise<{ name: string | null } | null> {
  if (!id) return null;
  const { data } = await createAdminClient().from("communities").select("name").eq("id", id).maybeSingle();
  return (data as { name: string | null } | null) ?? null;
}

export async function POST(request: NextRequest) {
  try {
    if (!hasAdminCredentials()) {
      return NextResponse.json({ error: "not_configured" }, { status: 503 });
    }
    const cfg = await getAppConfig();
    const secret = cfg.reminder_webhook_secret;
    if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const { event, id } = (await request.json().catch(() => ({}))) as { event?: unknown; id?: unknown };
    if (typeof event !== "string" || !EVENTS.has(event) || typeof id !== "string" || !UUID_RE.test(id)) {
      return NextResponse.json({ error: "bad_request" }, { status: 400 });
    }
    if (!discordConfigured()) {
      return NextResponse.json({ ok: true, posted: false, skipped: "discord_not_configured" });
    }

    const origin = cfg.app_origin ?? "https://agorasphere.net";
    const admin = createAdminClient();

    if (event === "post_featured") {
      const { data: post } = await admin
        .from("community_posts")
        .select("id, title, body, author_id, featured_at")
        .eq("id", id)
        .maybeSingle();
      if (!post?.featured_at) {
        return NextResponse.json({ ok: true, posted: false, skipped: "not_featured" });
      }
      const url = discordWebhook("announcements");
      if (!url) return NextResponse.json({ ok: true, posted: false, skipped: "no_webhook" });
      const author = await loadUser(post.author_id);
      const posted = await postDiscord(url, featuredPostMessage(post, author, origin));
      return NextResponse.json({ ok: true, posted });
    }

    const { data: room } = await admin
      .from("debate_rooms")
      .select(
        "id, motion, status, is_private, host_id, community_id, started_at, ended_at, recording_url, recording_ended_at, pro_size, con_size"
      )
      .eq("id", id)
      .maybeSingle();
    if (!room || room.is_private) {
      return NextResponse.json({ ok: true, posted: false, skipped: room ? "private" : "no_room" });
    }

    if (event === "room_live") {
      if (room.status !== "live") {
        return NextResponse.json({ ok: true, posted: false, skipped: "not_live" });
      }
      const url = discordWebhook("live");
      if (!url) return NextResponse.json({ ok: true, posted: false, skipped: "no_webhook" });
      const [host, community] = await Promise.all([loadUser(room.host_id), loadCommunity(room.community_id)]);
      const posted = await postDiscord(url, roomLiveMessage(room, host, community, origin));
      return NextResponse.json({ ok: true, posted });
    }

    /* recording_ready */
    if (room.status !== "ended" || !room.recording_url) {
      return NextResponse.json({ ok: true, posted: false, skipped: "no_recording" });
    }
    const url = discordWebhook("recordings");
    if (!url) return NextResponse.json({ ok: true, posted: false, skipped: "no_webhook" });
    const [host, community] = await Promise.all([loadUser(room.host_id), loadCommunity(room.community_id)]);
    const posted = await postDiscord(url, recordingReadyMessage(room, host, community, origin));
    return NextResponse.json({ ok: true, posted });
  } catch (e) {
    console.error("[discord] route failed:", e);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
