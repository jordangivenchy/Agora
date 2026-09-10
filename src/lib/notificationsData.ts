/* The notifications page's first view — the viewer and their first page
   of notifications — fetched by the route on the server so the page
   arrives complete behind its loading screen. NotificationsPage starts
   from it and refreshes in the browser as before. */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { NotifRow } from "@/lib/notifications";

export const NOTIF_PAGE = 30;

export type NotificationsInitial = {
  userId: string | null;
  items: NotifRow[];
  more: boolean;
};

export async function fetchNotificationsInitial(supabase: SupabaseClient): Promise<NotificationsInitial> {
  const { data: claims } = await supabase.auth.getClaims(); // verified locally, no auth round trip
  const userId = claims?.claims.sub ?? null;
  if (!userId) return { userId: null, items: [], more: false };
  const { data } = await supabase.rpc("get_notifications", { p_limit: NOTIF_PAGE, p_before: null });
  const items = (data ?? []) as NotifRow[];
  return { userId, items, more: items.length === NOTIF_PAGE };
}
