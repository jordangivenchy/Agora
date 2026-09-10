/* /notifications — standalone route (not a homepage-shell rewrite) with
   the same chrome as the profile route. The first page of notifications
   is fetched here on the server (lib/notificationsData.ts), as the
   viewer, so the page arrives complete behind its loading screen. */

import { createClient } from "@/lib/supabase-server";
import { fetchNotificationsInitial } from "@/lib/notificationsData";
import NotificationsPage from "@/components/notifications/NotificationsPage";

export const metadata = { title: "Notifications · AgoraSphere" };

export default async function NotificationsRoute() {
  const supabase = await createClient();
  const initial = await fetchNotificationsInitial(supabase);
  return <NotificationsPage initial={initial} />;
}
