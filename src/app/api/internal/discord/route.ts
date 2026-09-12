import { NextRequest, NextResponse } from "next/server";
import { createAdminClient, hasAdminCredentials } from "@/lib/supabase-admin";
import { getAppConfig } from "@/lib/appConfig";
import {
  discordConfigured,
  discordWebhook,
  editDiscord,
  featuredPostMessage,
  postDiscord,
  recordingReadyMessage,
  roomCardMessage,
  roomPhase,
  type DiscordChannel,
  type DiscordMessage,
  type DiscordRoom,
  type DiscordUser,
} from "@/lib/discord";

/* Fired by the database (pg_net POST, migrations 20260905 and 20260906)
   when a public room is scheduled, goes live, ends or is cancelled,
   when a recording lands, or when a moderator features a post. The
   body only names the event and the row; the row is re-read here with
   the service role, so nothing in the payload is trusted and the card
   always shows the room's real state at delivery.

   Rooms get one card in #live-now, remembered in discord_cards and
   rewritten as the room moves along; a card is only ever created for a
   room that is scheduled or live, so a room that ended before anyone
   heard of it stays unannounced. Recordings get their own card in
   #past-discussions; featured posts theirs in #announcements.

   Auth: Bearer <reminder_webhook_secret from app_config> — same
   contract as /api/internal/room-ended. */

const EVENTS = new Set(["room_live", "room_changed", "recording_ready", "post_featured"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Kind = "room" | "recording" | "post";

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

/* The card for (kind, ref): rewrite it if we have one, else post it when
   `create` allows. Returns what happened, for the response. */
async function placeCard(
  kind: Kind,
  refId: string,
  channel: DiscordChannel,
  message: DiscordMessage,
  create: boolean
): Promise<"edited" | "posted" | "skipped" | "failed"> {
  const url = discordWebhook(channel);
  if (!url) return "skipped";
  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("discord_cards")
    .select("message_id")
    .eq("kind", kind)
    .eq("ref_id", refId)
    .maybeSingle();

  if (existing?.message_id) {
    const r = await editDiscord(url, existing.message_id, message);
    if (r === "ok") {
      await admin.from("discord_cards").update({ updated_at: new Date().toISOString() }).eq("kind", kind).eq("ref_id", refId);
      return "edited";
    }
    if (r === "failed") return "failed";
    /* Gone: someone deleted it in Discord. Post again below if allowed. */
    if (!create) {
      await admin.from("discord_cards").delete().eq("kind", kind).eq("ref_id", refId);
      return "skipped";
    }
  } else if (!create) {
    return "skipped";
  }

  const { ok, id } = await postDiscord(url, message);
  if (!ok) return "failed";
  if (id) {
    await admin
      .from("discord_cards")
      .upsert({ kind, ref_id: refId, channel, message_id: id, updated_at: new Date().toISOString() }, { onConflict: "kind,ref_id" });
  }
  return "posted";
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
      const author = await loadUser(post.author_id);
      const result = await placeCard("post", post.id, "announcements", featuredPostMessage(post, author, origin), true);
      return NextResponse.json({ ok: true, result });
    }

    const { data: room } = await admin
      .from("debate_rooms")
      .select(
        "id, motion, status, is_private, host_id, community_id, scheduled_start, started_at, ended_at, recording_url, recording_ended_at, pro_size, con_size"
      )
      .eq("id", id)
      .maybeSingle();
    if (!room || room.is_private) {
      return NextResponse.json({ ok: true, posted: false, skipped: room ? "private" : "no_room" });
    }
    const typed = room as DiscordRoom & { host_id: string | null; community_id: string | null };
    const phase = roomPhase(typed);
    if (!phase) return NextResponse.json({ ok: true, posted: false, skipped: "nothing_to_show" });

    const [host, community] = await Promise.all([loadUser(typed.host_id), loadCommunity(typed.community_id)]);

    /* The room's own card in #live-now, in whatever phase it is now.
       Only a scheduled or live room earns a new card. */
    const card = roomCardMessage(typed, host, community, origin);
    const live = card ? await placeCard("room", typed.id, "live", card, phase === "scheduled" || phase === "live") : "skipped";

    /* The recording's card in #past-discussions, once. */
    let recording: string = "skipped";
    if (event === "recording_ready" && phase === "recorded") {
      recording = await placeCard("recording", typed.id, "recordings", recordingReadyMessage(typed, host, community, origin), true);
    }

    return NextResponse.json({ ok: true, phase, live, recording });
  } catch (e) {
    console.error("[discord] route failed:", e);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
