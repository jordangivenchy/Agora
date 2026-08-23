import { NextRequest, NextResponse } from "next/server";
import { createAdminClient, hasAdminCredentials } from "@/lib/supabase-admin";
import { getAppConfig } from "@/lib/appConfig";
import { emailConfigured, sendEmail, weeklyDigestEmail } from "@/lib/email";
import { digestHasContent, type DigestData, type DigestPost, type DigestUpcoming } from "@/lib/emailCopy";
import { notifHref, notifText } from "@/lib/notifications";
import { RAW_NOTIF_SELECT, toNotifRow, unsubUrl, type EmailSettings, type RawNotif } from "@/lib/emailNotif";
import { roomPath } from "@/lib/urls";
import { pathFor } from "@/lib/routes";
import { displayName } from "@/lib/names";

/* Weekly digest ("Your week on AgoraSphere"). Fired by pg_cron
   'weekly-digest' (Saturday 15:00 UTC → dispatch_weekly_digest → pg_net
   POST). Service-role queries throughout because get_home_feed & co are
   auth.uid()-based.

   Recipients: email_digest = 'weekly' (the default when no settings row
   exists), not unsubscribed, have an email, active in the last 60 days
   (presence / any notification / any follow), and not already sent in
   the last 6 days (user_settings.last_digest_at). Users with nothing to
   say are skipped without a stamp.

   Auth: Bearer <reminder_webhook_secret from app_config>. */

export const maxDuration = 300;

const DAY = 86_400_000;

function whenLabel(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    timeZone: "UTC", timeZoneName: "short",
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
    if (!emailConfigured()) {
      console.log("[cron/digest] RESEND_API_KEY missing — skipping digest run");
      return NextResponse.json({ ok: true, skipped: "email_not_configured" });
    }

    const admin = createAdminClient();
    const origin = cfg.app_origin ?? "https://agorasphere.net";
    const now = Date.now();
    const weekAgo = new Date(now - 7 * DAY).toISOString();
    const sixtyDaysAgo = new Date(now - 60 * DAY).toISOString();
    const sixDaysAgo = new Date(now - 6 * DAY).toISOString();
    const nowIso = new Date(now).toISOString();
    const weekAhead = new Date(now + 7 * DAY).toISOString();

    /* ── 1. Active users ── */
    const [{ data: presence }, { data: notifUsers }, { data: followUsers }] = await Promise.all([
      admin.from("user_presence").select("user_id").gt("last_seen_at", sixtyDaysAgo).limit(5000),
      admin.from("notifications").select("user_id").gt("created_at", sixtyDaysAgo).limit(10000),
      admin.from("user_follows").select("follower_id").gt("created_at", sixtyDaysAgo).limit(5000),
    ]);
    const active = new Set<string>();
    for (const r of (presence ?? []) as { user_id: string }[]) active.add(r.user_id);
    for (const r of (notifUsers ?? []) as { user_id: string }[]) active.add(r.user_id);
    for (const r of (followUsers ?? []) as { follower_id: string }[]) active.add(r.follower_id);
    const activeIds = [...active];
    if (!activeIds.length) return NextResponse.json({ ok: true, skipped: "no_active_users" });

    const [{ data: settingsRows }, { data: userRows }] = await Promise.all([
      admin.from("user_settings")
        .select("user_id, email_prefs, email_digest, email_unsubscribed_at, last_digest_at")
        .in("user_id", activeIds),
      admin.from("users").select("id, email").in("id", activeIds),
    ]);
    const settings = new Map<string, EmailSettings>();
    for (const s of (settingsRows ?? []) as (EmailSettings & { user_id: string })[]) settings.set(s.user_id, s);
    const emails = new Map<string, string>();
    for (const u of (userRows ?? []) as { id: string; email: string | null }[]) if (u.email) emails.set(u.id, u.email);

    const recipients = activeIds.filter((uid) => {
      const s = settings.get(uid);
      if (!emails.has(uid)) return false;
      if (s?.email_unsubscribed_at) return false;
      if ((s?.email_digest ?? "weekly") !== "weekly") return false;
      if (s?.last_digest_at && s.last_digest_at > sixDaysAgo) return false;
      return true;
    });
    if (!recipients.length) return NextResponse.json({ ok: true, skipped: "no_recipients" });

    /* ── 2. Shared prefetch: this week's posts with score + comments ── */
    const { data: postRows } = await admin
      .from("community_posts")
      .select("id, title, community_id, community:communities(name, is_private)")
      .gt("created_at", weekAgo)
      .eq("is_repost", false)
      .limit(2000);
    type PostRow = { id: string; title: string | null; community_id: string; community: { name: string; is_private: boolean } | null };
    const posts = (postRows ?? []) as unknown as PostRow[];
    const postIds = posts.map((p) => p.id);
    const score = new Map<string, number>();
    const commentCount = new Map<string, number>();
    if (postIds.length) {
      const [{ data: votes }, { data: comments }] = await Promise.all([
        admin.from("community_post_votes").select("post_id, value").in("post_id", postIds).limit(50000),
        admin.from("community_comments").select("post_id").in("post_id", postIds).limit(50000),
      ]);
      for (const v of (votes ?? []) as { post_id: string; value: number }[]) score.set(v.post_id, (score.get(v.post_id) ?? 0) + v.value);
      for (const c of (comments ?? []) as { post_id: string }[]) commentCount.set(c.post_id, (commentCount.get(c.post_id) ?? 0) + 1);
    }
    const rankedPosts = posts
      .map((p) => ({ p, s: score.get(p.id) ?? 0, c: commentCount.get(p.id) ?? 0 }))
      .sort((a, b) => (b.s + b.c) - (a.s + a.c));

    /* ── 3. Per-user build + send ── */
    let sent = 0, skippedEmpty = 0, failed = 0;
    for (const uid of recipients) {
      const [
        { data: unreadRows, count: unreadCount },
        { data: follows },
        { data: memberships },
        { count: newFollowers },
      ] = await Promise.all([
        admin.from("notifications").select(RAW_NOTIF_SELECT, { count: "exact" })
          .eq("user_id", uid).is("read_at", null).gt("created_at", weekAgo)
          .order("created_at", { ascending: false }).limit(3),
        admin.from("user_follows").select("following_id").eq("follower_id", uid).limit(2000),
        admin.from("community_members").select("community_id").eq("user_id", uid).limit(500),
        admin.from("user_follows").select("follower_id", { count: "exact", head: true })
          .eq("following_id", uid).gt("created_at", weekAgo),
      ]);

      const followed = ((follows ?? []) as { following_id: string }[]).map((f) => f.following_id);
      const myCommunities = new Set(((memberships ?? []) as { community_id: string }[]).map((m) => m.community_id));

      let upcoming: DigestUpcoming[] = [];
      let replaysMissed = 0;
      if (followed.length) {
        const [{ data: rooms }, { count: replays }] = await Promise.all([
          admin.from("debate_rooms")
            .select("id, motion, scheduled_start, host:users!debate_rooms_host_id_fkey(username, display_name)")
            .in("host_id", followed).eq("is_private", false)
            .in("status", ["created", "scheduled"])
            .gte("scheduled_start", nowIso).lte("scheduled_start", weekAhead)
            .order("scheduled_start", { ascending: true }).limit(5),
          admin.from("debate_rooms").select("id", { count: "exact", head: true })
            .in("host_id", followed).eq("is_private", false)
            .not("recording_url", "is", null).gt("recording_ended_at", weekAgo),
        ]);
        type RoomRow = { id: string; motion: string; scheduled_start: string; host: { username: string; display_name: string | null } | null };
        upcoming = ((rooms ?? []) as unknown as RoomRow[]).map((r) => ({
          motion: r.motion,
          host: r.host ? displayName(r.host) || `@${r.host.username}` : "Someone you follow",
          startsAt: whenLabel(r.scheduled_start),
          url: `${origin}${roomPath({ id: r.id, motion: r.motion })}`,
        }));
        replaysMissed = replays ?? 0;
      }

      const topPosts: DigestPost[] = rankedPosts
        // Membership check covers private boards too: only boards they're in.
        .filter(({ p }) => myCommunities.has(p.community_id))
        .slice(0, 3)
        .map(({ p, s, c }) => ({
          title: p.title || "Untitled post",
          community: p.community?.name ?? "Community",
          score: s, comments: c,
          url: `${origin}${pathFor.post(p.id)}`,
        }));

      const unread = ((unreadRows ?? []) as unknown as RawNotif[]).map((r) => {
        const n = toNotifRow(r);
        const href = notifHref(n);
        return { text: notifText(n), url: href ? `${origin}${href}` : null };
      });

      const data: DigestData = {
        unreadCount: unreadCount ?? 0,
        unread,
        upcoming,
        topPosts,
        newFollowers: newFollowers ?? 0,
        replaysMissed,
      };
      if (!digestHasContent(data)) { skippedEmpty++; continue; }

      const { subject, html, text } = weeklyDigestEmail({ data, origin, unsubUrl: unsubUrl(origin, uid, secret) });
      const ok = await sendEmail({ to: emails.get(uid) as string, subject, html, text });
      if (!ok) { failed++; continue; }
      sent++;
      await admin.from("user_settings")
        .upsert({ user_id: uid, last_digest_at: nowIso }, { onConflict: "user_id" });
    }

    return NextResponse.json({ ok: true, candidates: recipients.length, sent, skippedEmpty, failed });
  } catch (e) {
    console.error("[cron/digest]", e);
    return NextResponse.json({ error: "digest_failed" }, { status: 500 });
  }
}
