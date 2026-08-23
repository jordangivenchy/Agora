import webpush from "web-push";
import type { SupabaseClient } from "@supabase/supabase-js";

/* The one web-push sender. Reads VAPID keys from app_config (via
   getAppConfig — no env), sends the same payload to every subscription
   the given users hold, and prunes subscriptions the browser dropped
   (404 / 410). Used by the reminder webhook and the notifications
   dispatcher. */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = SupabaseClient<any, "public", any>;

export type PushPayload = { title: string; body: string; url: string };

export function pushConfigured(cfg: Record<string, string>): boolean {
  return Boolean(cfg.vapid_public_key && cfg.vapid_private_key);
}

export async function sendPushToUsers(
  admin: AdminClient,
  cfg: Record<string, string>,
  userIds: string[],
  payloadFor: (userId: string) => PushPayload | null
): Promise<number> {
  if (!pushConfigured(cfg) || userIds.length === 0) return 0;
  webpush.setVapidDetails(
    cfg.vapid_subject ?? "mailto:no-reply@agorasphere.net",
    cfg.vapid_public_key,
    cfg.vapid_private_key
  );
  const { data: subs } = await admin
    .from("push_subscriptions")
    .select("user_id, endpoint, p256dh, auth")
    .in("user_id", userIds);
  let pushed = 0;
  await Promise.allSettled(
    ((subs ?? []) as { user_id: string; endpoint: string; p256dh: string; auth: string }[]).map(
      async (s) => {
        const payload = payloadFor(s.user_id);
        if (!payload) return;
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            JSON.stringify(payload)
          );
          pushed++;
        } catch (e) {
          const code = (e as { statusCode?: number }).statusCode;
          if (code === 404 || code === 410) {
            await admin.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
          }
        }
      }
    )
  );
  return pushed;
}
