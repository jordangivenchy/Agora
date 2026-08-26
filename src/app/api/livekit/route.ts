import { NextRequest, NextResponse } from "next/server";
import { AccessToken, RoomServiceClient } from "livekit-server-sdk";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient, hasAdminCredentials } from "@/lib/supabase-admin";
import {
  audienceThresholdFromEnv,
  decideAudienceMode,
  handFastLaneCapFromEnv,
} from "@/lib/audienceMode";

/* LiveKit token mint. Identity is server-verified: the Supabase cookie
   session decides who you are — the client's claimed userId is never
   trusted, so nobody can join the call wearing someone else's id. Guests
   (no session) get a guest- identity and are subscribe-only.

   Scheduled rooms enforce the 30-minute door here too: the room page
   gates the UI, but a token is the thing that actually admits you. */

const DOOR_MS = 30 * 60 * 1000;

export async function POST(request: NextRequest) {
  try {
    const { roomId, userId: claimedId, role } = await request.json();

    if (!roomId) {
      return NextResponse.json({ error: "Missing roomId" }, { status: 400 });
    }

    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    if (!apiKey || !apiSecret) {
      return NextResponse.json({ error: "LiveKit not configured" }, { status: 500 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    let identity: string;
    let name: string;
    let canPublish = false;

    if (user) {
      identity = user.id;
      const { data: profile } = await supabase
        .from("users")
        .select("username, display_name")
        .eq("id", user.id)
        .maybeSingle();
      name =
        profile?.display_name?.trim() ||
        profile?.username ||
        user.email?.split("@")[0] ||
        "User";
      canPublish = role === "debater";
    } else {
      /* Keep the client's guest id when it looks like one (harmless — no
         publish rights, no user mapping), so its local bookkeeping lines up. */
      identity =
        typeof claimedId === "string" && /^guest-[a-z0-9-]{4,40}$/i.test(claimedId)
          ? claimedId
          : `guest-${crypto.randomUUID().slice(0, 8)}`;
      name = "Guest";
    }

    /* This read is the access gate. debate_rooms RLS (20260866) only
       returns a followers/friends room to eligible viewers, so an
       ineligible user gets null here and is turned away — no separate
       can_enter_room call needed, and the cookie-scoped client (not admin)
       is what makes RLS apply. */
    const { data: room } = await supabase
      .from("debate_rooms")
      .select("host_id, status, scheduled_start, hls_url")
      .eq("id", roomId)
      .maybeSingle();
    if (!room) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }
    if (room.status === "ended") {
      return NextResponse.json({ error: "room_ended" }, { status: 403 });
    }
    if (
      room.scheduled_start &&
      room.status !== "live" &&
      (!user || user.id !== room.host_id)
    ) {
      const opensAt = new Date(room.scheduled_start).getTime() - DOOR_MS;
      if (Date.now() < opensAt) {
        return NextResponse.json(
          { error: "room_not_open", opensAt: new Date(opensAt).toISOString() },
          { status: 403 }
        );
      }
    }

    /* ── Audience overflow → HLS ─────────────────────────────────────
       Above a spectator ceiling, NEW audience members watch the room's
       composited HLS stream (already produced by default recording,
       R2-delivered, free egress) instead of taking a LiveKit WebRTC
       seat. Stage roles always get WebRTC; existing WebRTC viewers are
       never migrated (they never re-request a token mid-session). The
       decision is evaluated fresh per request — never cached — so a
       room dipping under the ceiling admits newcomers over WebRTC
       again by itself; that is the hysteresis, no floor constant
       needed. Any LiveKit hiccup fails open to a normal token. */
    if (room.status === "live" && room.hls_url) {
      let isStage = false;
      let handRaised = false;
      if (user) {
        if (user.id === room.host_id) {
          isStage = true;
        } else {
          /* Mirror the client's deriveStageRole: explicit stage_role
             promotion, or the debater role, means on-stage. Guests are
             always audience. */
          const { data: seat } = await supabase
            .from("debate_participants")
            .select("role, stage_role, hand_raised_at")
            .eq("room_id", roomId)
            .eq("user_id", user.id)
            .is("left_at", null)
            .maybeSingle();
          isStage =
            !!seat &&
            (seat.role === "debater" ||
              ["host", "cohost", "speaker"].includes(seat.stage_role ?? ""));
          handRaised = !isStage && !!seat?.hand_raised_at;
        }
      }
      if (!isStage) {
        /* Raised-hand fast lane: whoever is near the front of the speaker
           queue may be brought up any moment — they need the live edge,
           not a ~10s-behind broadcast. Rank comes from the same ordering
           every client and advance_speaker_queue use (hand_raised_at asc,
           user_id tiebreak): fetch the first cap-many raised hands and
           look for ourselves. Capped so mass hand-raising in a 20k room
           can't stampede back onto billed WebRTC seats. */
        let handQueueRank: number | null = null;
        const handFastLaneCap = handFastLaneCapFromEnv(process.env.HLS_HAND_FAST_LANE_CAP);
        if (user && handRaised && handFastLaneCap > 0) {
          const { data: lane } = await supabase
            .from("debate_participants")
            .select("user_id")
            .eq("room_id", roomId)
            .is("left_at", null)
            .not("hand_raised_at", "is", null)
            .order("hand_raised_at", { ascending: true })
            .order("user_id", { ascending: true })
            .limit(handFastLaneCap);
          const idx = (lane ?? []).findIndex((r) => r.user_id === user.id);
          if (idx >= 0) handQueueRank = idx;
        }
        /* In the fast lane the decision is WebRTC no matter the crowd
           size — skip the LiveKit head-count round-trip entirely. */
        if (handQueueRank === null) {
          try {
            const lkUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL;
            if (!lkUrl) throw new Error("no livekit url");
            const svc = new RoomServiceClient(
              lkUrl.replace(/^wss?:\/\//, "https://"),
              apiKey,
              apiSecret
            );
            const parts = await svc.listParticipants(roomId);
            /* Audience = connected non-publishers. Publish rights track the
               stage exactly (tokens above), and the filter also drops the
               hidden egress recorder so it never pads the count. */
            const audienceCount = parts.filter(
              (p) =>
                !p.permission?.canPublish &&
                !p.permission?.hidden &&
                !p.permission?.recorder
            ).length;
            const decision = decideAudienceMode({
              isStage,
              audienceCount,
              hlsUrl: room.hls_url,
              threshold: audienceThresholdFromEnv(process.env.HLS_AUDIENCE_THRESHOLD),
              handQueueRank,
              handFastLaneCap,
            });
            if (decision.mode === "hls") {
              return NextResponse.json({
                mode: "hls",
                url: decision.url,
                viewerCount: audienceCount,
              });
            }
          } catch {
            /* LiveKit unreachable (or room not yet created there) —
               fail open: mint the WebRTC token as always. */
          }
        }
      }
    }

    /* Opportunistic ghost-seat sweep — keyed to arrivals, so stale rows
       clear whenever a room is actually being used. Fire-and-forget. */
    if (hasAdminCredentials()) {
      createAdminClient()
        .rpc("sweep_ghost_seats")
        .then(undefined, () => {});
    }

    const at = new AccessToken(apiKey, apiSecret, {
      identity,
      name,
      ttl: "1h",
    });
    at.addGrant({
      room: roomId,
      roomJoin: true,
      canPublish,
      canSubscribe: true,
      canPublishData: true,
    });

    const token = await at.toJwt();
    return NextResponse.json({ token });
  } catch {
    return NextResponse.json({ error: "Failed to generate token" }, { status: 500 });
  }
}
