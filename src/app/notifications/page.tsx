/* /notifications — standalone route (not a homepage-shell rewrite) with
   the same chrome as the profile route. */

import NotificationsPage from "@/components/notifications/NotificationsPage";

export const metadata = { title: "Notifications · AgoraSphere" };

export default function NotificationsRoute() {
  return <NotificationsPage />;
}
