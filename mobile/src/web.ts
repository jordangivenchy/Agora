/* What the app doesn't do natively yet opens as the website in the
   in-app browser sheet. Signed in, it goes through the site's handoff
   (/app/open) with the beta pass and the session, so the web is the
   same person without a second login; the tokens ride in the URL
   fragment, which never reaches a server. */
import * as WebBrowser from "expo-web-browser";
import { SITE } from "./api";

let auth: { access: string; refresh: string; pass: string | null } | null = null;
/* The session provider keeps this current. */
export function setWebAuth(next: { access: string; refresh: string; pass: string | null } | null): void {
  auth = next;
}

/* Whether the site has the handoff yet (it may not be deployed): asked
   once, remembered. Without it the page opens plainly. */
let handoff: Promise<boolean> | null = null;
function hasHandoff(): Promise<boolean> {
  handoff ??= fetch(`${SITE}/app/open?to=%2F`, { method: "HEAD" }).then((r) => r.ok).catch(() => false);
  return handoff;
}

export function openWeb(path: string): void {
  const to = path.startsWith("/") ? path : `/${path}`;
  void (async () => {
    if (auth && (await hasHandoff())) {
      const q = new URLSearchParams({ to });
      if (auth.pass) q.set("pass", auth.pass);
      const hash = new URLSearchParams({ access_token: auth.access, refresh_token: auth.refresh }).toString();
      await WebBrowser.openBrowserAsync(`${SITE}/app/open?${q.toString()}#${hash}`);
      return;
    }
    await WebBrowser.openBrowserAsync(`${SITE}${to}`);
  })();
}

export function openUrl(url: string): void {
  void WebBrowser.openBrowserAsync(url);
}
