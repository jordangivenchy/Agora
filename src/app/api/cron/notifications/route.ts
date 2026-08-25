import { NextRequest, NextResponse } from "next/server";
import { createAdminClient, hasAdminCredentials } from "@/lib/supabase-admin";
import { getAppConfig } from "@/lib/appConfig";
import { debateReplayReadyEmail, emailConfigured, sendEmail } from "@/lib/email";
import { roomPath } from "@/lib/urls";
import { sendPushToUsers } from "@/lib/webPush";
import { displayName } from "@/lib/names";
import { notificationBatchEmail } from "@/lib/email";
import { notifDetail, notifHref, notifText } from "@/lib/notifications";
import {
  RAW_NOTIF_SELECT, emailEnabledFor, toNotifRow, unsubUrl,
  type EmailSettings, type RawNotif,
} from "@/lib/emailNotif";

/* Out-of-app delivery for the social notification types that deserve
   it: followed_live / followed_scheduled / debate_replay_ready go out as
   web push (same sender as the 30-minute reminders), and replay-ready
   also as email. Triggered every minute by pg_cron
   (dispatch_notification_push → pg_net POST) only when undelivered rows
   exist; each row is stamped delivered_at so nothing goes twice.

   Email (20260854): every row whose type the recipient emails
   (email_prefs / defaults) is folded into ONE message per user per run,
   at most one per user per 10 minutes; rows are stamped emailed_at either
   way so they never match again.

   Auth: Bearer <reminder_webhook_secret from app_config> — no env. */

const PUSH_TYPES = ["followed_live", "followed_scheduled", "debate_replay_ready"] as const;
type PushType = (typeof PUSH_TYPES)[number];

type Row = {
  id: string;
  user_id: string;
  type: PushType;
  meta: Record<string, unknown> | null;
  room: { id: string; motion: string; scheduled_start: string | null } | null;
  actor: { username: string; display_name: string | null } | null;
  user: { email: string | null } | null;
};

function whenLabel(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "UTC", timeZoneName: "short",
  });
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

    const admin = createAdminClient();
    const since = new Date(Date.now() - 30 * 60_000).toISOString();
    const { data } = await admin
      .from("notifications")
      .select(
        "id, user_id, type, meta, room:debate_rooms(id, motion, scheduled_start), actor:users!notifications_actor_id_fkey(username, display_name), user:users!notifications_user_id_fkey(email)"
      )
      .is("delivered_at", null)
      .in("type", [...PUSH_TYPES])
      .gt("created_at", since)
      .order("created_at", { ascending: true })
      .limit(500);
    const rows = (data ?? []) as unknown as Row[];
    const origin = cfg.app_origin ?? "https://agorasphere.net";
    if (!rows.length) {
      const batch = await emailPending(admin, { origin, secret, since });
      return NextResponse.json({ ok: true, skipped: "nothing_pending", ...batch });
    }

    const payloads = new Map<string, { title: string; body: string; url: string }>();
    for (const r of rows) {
      if (!r.room) continue;
      const url = `${origin}${roomPath({ id: r.room.id, motion: r.room.motion })}`;
      const who = r.actor ? displayName(r.actor) || `@${r.actor.username}` : "Someone you follow";
      const motion = `“${r.room.motion}”`;
      if (r.type === "followed_live") {
        payloads.set(r.user_id, { title: `${who} is live`, body: `${motion} — join the amphitheater.`, url });
      } else if (r.type === "followed_scheduled") {
        const when = whenLabel(r.room.scheduled_start);
        payloads.set(r.user_id, {
          title: `${who} scheduled a discussion`,
          body: `${motion}${when ? ` · ${when}` : ""}`,
          url,
        });
      } else {
        payloads.set(r.user_id, { title: "Your replay is ready", body: `${motion} — watch it back.`, url });
      }
    }

    const pushed = await sendPushToUsers(admin, cfg, [...payloads.keys()], (uid) => payloads.get(uid) ?? null);

    let emailed = 0;
    if (emailConfigured()) {
      for (const r of rows) {
        if (r.type !== "debate_replay_ready" || !r.room || !r.user?.email) continue;
        const url = `${origin}${roomPath({ id: r.room.id, motion: r.room.motion })}`;
        const { subject, html } = debateReplayReadyEmail(r.room.motion, url);
        if (await sendEmail({ to: r.user.email, subject, html })) emailed++;
      }
    }

    await admin
      .from("notifications")
      .update({ delivered_at: new Date().toISOString() })
      .in("id", rows.map((r) => r.id));

    const batch = await emailPending(admin, { origin, secret, since });

    return NextResponse.json({ ok: true, rows: rows.length, pushed, emailed, ...batch });
  } catch {
    return NextResponse.json({ error: "notification_dispatch_failed" }, { status: 500 });
  }
}

/* ── Social email batch ────────────────────────────────────── */

const EMAIL_RATE_MS = 10 * 60_000;

async function emailPending(
  admin: ReturnType<typeof createAdminClient>,
  ctx: { origin: string; secret: string; since: string },
): Promise<{ emailBatches: number; emailStamped: number; emailSkipped?: string }> {
  const { data } = await admin
    .from("notifications")
    .select(RAW_NOTIF_SELECT)
    .is("emailed_at", null)
    .gt("created_at", ctx.since)
    .order("created_at", { ascending: true })
    .limit(500);
  const raws = (data ?? []) as unknown as RawNotif[];
  if (!raws.length) return { emailBatches: 0, emailStamped: 0 };

  const userIds = [...new Set(raws.map((r) => r.user_id))];
  const [{ data: settingsRows }, { data: userRows }, { data: recent }] = await Promise.all([
    admin.from("user_settings")
      .select("user_id, email_prefs, email_digest, email_unsubscribed_at, last_digest_at")
      .in("user_id", userIds),
    admin.from("users").select("id, email").in("id", userIds),
    admin.from("notifications").select("user_id")
      .in("user_id", userIds)
      .gt("emailed_at", new Date(Date.now() - EMAIL_RATE_MS).toISOString()),
  ]);
  const settings = new Map<string, EmailSettings>();
  for (const s of (settingsRows ?? []) as (EmailSettings & { user_id: string })[]) settings.set(s.user_id, s);
  const emails = new Map<string, string | null>();
  for (const u of (userRows ?? []) as { id: string; email: string | null }[]) emails.set(u.id, u.email);
  const rateLimited = new Set(((recent ?? []) as { user_id: string }[]).map((r) => r.user_id));

  // Rows that will never be emailed (type off, unsubscribed, no address)
  // get stamped now; eligible rows are grouped per user.
  const stampNow: string[] = [];
  const perUser = new Map<string, RawNotif[]>();
  for (const r of raws) {
    const s = settings.get(r.user_id);
    const eligible = emailEnabledFor(s, r.type) && !s?.email_unsubscribed_at && Boolean(emails.get(r.user_id));
    if (!eligible) { stampNow.push(r.id); continue; }
    if (rateLimited.has(r.user_id)) continue; // leave for a later run
    const list = perUser.get(r.user_id) ?? [];
    list.push(r);
    perUser.set(r.user_id, list);
  }

  let batches = 0;
  if (!emailConfigured()) {
    // Nothing can go out; don't burn the rows, but don't loop forever either:
    // stamp everything so the cron goes quiet until Resend exists.
    for (const list of perUser.values()) for (const r of list) stampNow.push(r.id);
    console.log(`[cron/notifications] email not configured — stamping ${perUser.size} pending user batch(es) unsent`);
  } else {
    for (const [uid, list] of perUser) {
      const items = list.map((r) => {
        const n = toNotifRow(r);
        const href = notifHref(n);
        return { text: notifText(n), detail: notifDetail(n), url: href ? `${ctx.origin}${href}` : null };
      });
      const { subject, html, text } = notificationBatchEmail({
        items, origin: ctx.origin, unsubUrl: unsubUrl(ctx.origin, uid, ctx.secret),
      });
      const ok = await sendEmail({ to: emails.get(uid) as string, subject, html, text });
      if (ok) batches++;
      // Stamp even on a failed send: a transient Resend error shouldn't
      // re-fire every minute for 30 minutes.
      for (const r of list) stampNow.push(r.id);
    }
  }

  if (stampNow.length) {
    await admin.from("notifications")
      .update({ emailed_at: new Date().toISOString() })
      .in("id", stampNow);
  }
  return { emailBatches: batches, emailStamped: stampNow.length };
}
