/* The worker behind AgoraSphere's system notifications — the ones the
   server pushes (reminders, someone you follow going live, a replay
   ready) and the ones an open tab raises for anything new
   (NotificationsBell). Registered from the bell.

   Showing: the push carries the words, a picture (the person's, or the
   site's mark), and a key per thing, so the same thing raised twice —
   by a tab and by the push — is one notification, not two. Nothing is
   shown while AgoraSphere is the window in front of you: the page has
   already put up its own pop-up.

   Opening: a click takes you there in a tab you already have open,
   moving inside the page (so a call carries on, minimized) — or, if no
   tab takes it, in a new one. */

const ICON = "/mark-512.png";
const BADGE = "/notification-badge.png";
/* What an open tab listens for (OPEN_NOTIFICATION in src/lib/notifAlerts.ts). */
const OPEN = "agora:open-notification";
/* How long to wait for an open tab to say it has gone there itself. */
const ANSWER_MS = 800;

/* No caching and no fetch handler: a new version can take over at once. */
self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    /* non-JSON payload — show something rather than nothing */
  }
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      if (wins.some((w) => w.focused && w.visibilityState === "visible")) return;
      await self.registration.showNotification(data.title || "AgoraSphere", {
        body: data.body || "",
        icon: data.icon || ICON,
        badge: BADGE,
        tag: data.tag || undefined,
        timestamp: typeof data.ts === "number" ? data.ts : Date.now(),
        data: { url: data.url || "/", id: data.id || null },
      });
    })()
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  /* Ours wherever it was written (the server writes the site's own
     address): the page's path is what a tab is asked to go to. */
  const target = new URL(data.url || "/", self.location.origin);
  const path = data.url ? target.pathname + target.search + target.hash : null;
  event.waitUntil(
    (async () => {
      const wins = (await self.clients.matchAll({ type: "window", includeUncontrolled: true })).filter(
        (w) => new URL(w.url).origin === self.location.origin
      );
      const win = wins.find((w) => w.focused) || wins.find((w) => w.visibilityState === "visible") || wins[0];
      if (win) {
        /* Asked before it's brought forward: bringing a window forward
           and opening one both spend the one go a click allows. */
        const taken = await answered(win, { type: OPEN, url: path, id: data.id || null });
        /* Taken, or nowhere to go: that tab, to the front. */
        if (taken || !path) {
          await win.focus().catch(() => {});
          return;
        }
      }
      await self.clients.openWindow(new URL(path || "/", self.location.origin).href);
    })()
  );
});

/* Hands the click to an open tab; true once the tab says it has gone
   there. A tab with nothing listening — a live room on its own page —
   never answers. */
function answered(win, message) {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(false), ANSWER_MS);
    channel.port1.onmessage = () => {
      clearTimeout(timer);
      resolve(true);
    };
    win.postMessage(message, [channel.port2]);
  });
}
