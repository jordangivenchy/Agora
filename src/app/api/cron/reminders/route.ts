import { NextRequest, NextResponse } from "next/server";
import { createAdminClient, hasAdminCredentials } from "@/lib/supabase-admin";
import { getAppConfig } from "@/lib/appConfig";
import { debateReminderEmail, emailConfigured, sendEmail } from "@/lib/email";
import { roomPath } from "@/lib/urls";
import { sendPushToUsers } from "@/lib/webPush";

/* Email + web-push fanout for one scheduled debate whose doors just
   opened. Triggered by the pg_cron job (send_due_room_reminders → pg_net
   POST), which also writes the in-app bell notifications and marks the
   reminders sent — so this route fires at most once per room.

   Auth: Bearer <reminder_webhook_secret from app_config> — no env needed. */

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

    const { roomId } = await request.json();
    if (typeof roomId !== "string" || !roomId) {
      return NextResponse.json({ error: "Missing roomId" }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data: room } = await admin
      .from("debate_rooms")
      .select("id, motion, scheduled_start, status")
      .eq("id", roomId)
      .maybeSingle();
    if (!room || !room.scheduled_start || room.status === "ended") {
      return NextResponse.json({ ok: true, skipped: "room_gone" });
    }

    const { data: signups } = await admin
      .from("room_reminders")
      .select("user_id, user:users(email, username, display_name)")
      .eq("room_id", roomId);
    const users = (signups ?? []) as unknown as {
      user_id: string;
      user: { email: string | null; username: string; display_name: string | null } | null;
    }[];
    if (!users.length) return NextResponse.json({ ok: true, skipped: "no_signups" });

    const origin = cfg.app_origin ?? "https://agorasphere.net";
    const roomUrl = `${origin}${roomPath({ id: room.id, motion: room.motion })}`;
    const startsAt = new Date(room.scheduled_start);

    // Email (no-op until Resend is configured)
    let emailed = 0;
    if (emailConfigured()) {
      const { subject, html } = debateReminderEmail(room.motion, startsAt, roomUrl);
      for (const s of users) {
        if (s.user?.email && (await sendEmail({ to: s.user.email, subject, html }))) emailed++;
      }
    }

    // Web push (shared sender — prunes dead subscriptions)
    const payload = {
      title: "Starting in 30 minutes",
      body: `“${room.motion}” — doors are open, take your seat.`,
      url: roomUrl,
    };
    const pushed = await sendPushToUsers(admin, cfg, users.map((s) => s.user_id), () => payload);

    return NextResponse.json({ ok: true, signups: users.length, emailed, pushed });
  } catch {
    return NextResponse.json({ error: "reminder_dispatch_failed" }, { status: 500 });
  }
}
