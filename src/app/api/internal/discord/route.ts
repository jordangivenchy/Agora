import { NextRequest, NextResponse } from "next/server";
import { createAdminClient, hasAdminCredentials } from "@/lib/supabase-admin";
import { getAppConfig } from "@/lib/appConfig";
import {
  callTroubleMessage,
  discordConfigured,
  discordWebhook,
  editDiscord,
  featuredPostMessage,
  postDiscord,
  recordingReadyMessage,
  reportMessage,
  roomCardMessage,
  roomPhase,
  type DiscordChannel,
  type DiscordMessage,
  type DiscordReport,
  type DiscordRoom,
  type DiscordUser,
  type TroubleEvent,
} from "@/lib/discord";

/* Fired by the database (pg_net POST, migrations 20260905, 20260906 and
   20260908) when a public room is scheduled, goes live, ends or is
   cancelled, when a recording lands, when a moderator features a post,
   when a call records trouble, or when someone files a report. The body
   only names the event and the row; the row is re-read here with the
   service role, so nothing in the payload is trusted and the card
   always shows the real state at delivery.

   Rooms get one card in #live-now, remembered in discord_cards and
   rewritten as the room moves along; a card is only ever created for a
   room that is scheduled or live, so a room that ended before anyone
   heard of it stays unannounced. Recordings get their own card in
   #past-discussions; featured posts theirs in #announcements. The team
   gets one card per room for call trouble, rewritten as events pile
   up, and one per report, both in #team.

   Auth: Bearer <reminder_webhook_secret from app_config> — same
   contract as /api/internal/room-ended. */

const EVENTS = new Set(["room_live", "room_changed", "recording_ready", "post_featured", "call_trouble", "user_report"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROOM_COLUMNS =
  "id, motion, status, is_private, host_id, community_id, scheduled_start, started_at, ended_at, recording_url, recording_ended_at, pro_size, con_size";
const TROUBLE = "event.in.(connect_fail,token_fail,reopened_after_unclean_exit),event.ilike.*fail*,event.ilike.*error*";

type Kind = "room" | "recording" | "post" | "call" | "report";
type RoomRow = DiscordRoom & { host_id: string | null; community_id: string | null };

async function loadUser(id: string | null | undefined): Promise<DiscordUser | null> {
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

async function loadRoom(id: string): Promise<RoomRow | null> {
  const { data } = await createAdminClient().from("debate_rooms").select(ROOM_COLUMNS).eq("id", id).maybeSingle();
  return (data as RoomRow | null) ?? null;
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

    if (event === "user_report") {
      const { data: report } = await admin
        .from("user_reports")
        .select("id, reporter_id, reported_user_id, reported_username, reason, description, context, room_id, message_content, status, created_at")
        .eq("id", id)
        .maybeSingle();
      if (!report) return NextResponse.json({ ok: true, posted: false, skipped: "no_report" });
      const [reporter, reportedUser, room] = await Promise.all([
        loadUser(report.reporter_id),
        loadUser(report.reported_user_id),
        report.room_id ? loadRoom(report.room_id) : Promise.resolve(null),
      ]);
      const reported = reportedUser ?? (report.reported_username ? { username: report.reported_username } : null);
      const result = await placeCard("report", report.id, "team", reportMessage(report as DiscordReport, reporter, reported, room, origin), true);
      return NextResponse.json({ ok: true, result });
    }

    if (event === "call_trouble") {
      const room = await loadRoom(id);
      if (!room) return NextResponse.json({ ok: true, posted: false, skipped: "no_room" });
      const { data: rows } = await admin
        .from("room_call_events")
        .select("event, reason, meta, created_at, user_id")
        .eq("room_id", id)
        .or(TROUBLE)
        .order("created_at", { ascending: false })
        .limit(20);
      const list = (rows ?? []) as Array<{ event: string; reason: string | null; meta: Record<string, unknown> | null; created_at: string; user_id: string | null }>;
      if (!list.length) return NextResponse.json({ ok: true, posted: false, skipped: "no_trouble" });
      const people = new Map<string, DiscordUser | null>();
      for (const uid of new Set(list.map((r) => r.user_id).filter((u): u is string => Boolean(u))).values()) {
        if (people.size >= 8) break;
        people.set(uid, await loadUser(uid));
      }
      const events: TroubleEvent[] = list.map((r) => ({ event: r.event, reason: r.reason, meta: r.meta, created_at: r.created_at, user: r.user_id ? (people.get(r.user_id) ?? null) : null }));
      const result = await placeCard("call", room.id, "team", callTroubleMessage(room, events, origin), true);
      return NextResponse.json({ ok: true, result, events: events.length });
    }

    const room = await loadRoom(id);
    if (!room || room.is_private) {
      return NextResponse.json({ ok: true, posted: false, skipped: room ? "private" : "no_room" });
    }
    const phase = roomPhase(room);
    if (!phase) return NextResponse.json({ ok: true, posted: false, skipped: "nothing_to_show" });

    const [host, community] = await Promise.all([loadUser(room.host_id), loadCommunity(room.community_id)]);

    /* The room's own card in #live-now, in whatever phase it is now.
       Only a scheduled or live room earns a new card. */
    const card = roomCardMessage(room, host, community, origin);
    const live = card ? await placeCard("room", room.id, "live", card, phase === "scheduled" || phase === "live") : "skipped";

    /* The recording's card in #past-discussions, once. */
    let recording: string = "skipped";
    if (event === "recording_ready" && phase === "recorded") {
      recording = await placeCard("recording", room.id, "recordings", recordingReadyMessage(room, host, community, origin), true);
    }

    return NextResponse.json({ ok: true, phase, live, recording });
  } catch (e) {
    console.error("[discord] route failed:", e);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
