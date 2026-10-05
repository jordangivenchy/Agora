/* System notifications — the browser's own, outside the page — for a
   row of the bell's: who and what (notifAlert), their picture or the
   site's mark, one per thing (notifTag: another tab raising the same
   one, or the web push for it, takes its place rather than adding a
   second), and where a click goes. Raised through the worker web push
   uses (public/push-sw.js), so it acts like a pushed one: it outlives
   the tab, and a click on it is handed back to an open tab (the bell
   listens for OPEN_NOTIFICATION) or opens one. */

import { notifAlert, notifHref, notifTag, type NotifRow } from "@/lib/notifications";

/* The picture when it's about no one in particular (one about a person
   shows theirs), and the silhouette Android puts in its status bar. */
export const ALERT_ICON = "/mark-512.png";
export const ALERT_BADGE = "/notification-badge.png";
/** What the worker posts to a tab when one of these is clicked (the
    same string is in public/push-sw.js). */
export const OPEN_NOTIFICATION = "agora:open-notification";

/* The worker, registered the first time it's needed. */
async function alertWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  try {
    const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/push-sw.js"));
    if (reg.active) return reg;
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>((done) => setTimeout(() => done(null), 3000)),
    ]);
  } catch {
    return null;
  }
}

/** Raises one, if notifications are allowed. Without the worker (it
    failed to start), straight from the page, and `onOpen` answers a
    click on it. */
export async function raiseSystemAlert(n: NotifRow, onOpen: (n: NotifRow) => void): Promise<void> {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  const { title, body } = notifAlert(n);
  const options = {
    body,
    icon: n.actor_avatar_url || ALERT_ICON,
    badge: ALERT_BADGE,
    tag: notifTag(n),
    timestamp: Date.parse(n.created_at),
    data: { url: notifHref(n), id: n.id },
  } as NotificationOptions;
  const reg = await alertWorker();
  if (reg) {
    await reg.showNotification(title, options).catch(() => {});
    return;
  }
  try {
    const note = new Notification(title, options);
    note.onclick = () => {
      window.focus();
      note.close();
      onOpen(n);
    };
  } catch {
    /* Phones only take them from a worker. */
  }
}
