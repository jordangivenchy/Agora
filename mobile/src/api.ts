/* Calls to the website's API. The browser sends cookies; the app sends
   the session's access token as a bearer and the beta pass as a header
   (src/lib/supabase-server.ts and src/proxy.ts in the web app read both). */

export const SITE = (process.env.EXPO_PUBLIC_SITE_ORIGIN ?? "https://agorasphere.net").replace(/\/$/, "");

export interface ApiAuth {
  token?: string | null;
  pass?: string | null;
}

/* The site's door answers a pass it no longer accepts by sending the call
   to its key page instead of to where it was going. The app used to miss
   that: the call simply failed, and a room that had just been made could
   not be joined ("Couldn't join (405)"). Whoever keeps the pass (the
   session) listens here and asks for a key again. */
const turnedAway = new Set<() => void>();
export function onPassRefused(fn: () => void): () => void {
  turnedAway.add(fn);
  return () => {
    turnedAway.delete(fn);
  };
}
/** Did this answer come from the site's key page? */
export const atTheDoor = (url: string | null | undefined): boolean => !!url && /^https?:\/\/[^/]+\/beta(\?|$)/.test(url);

export async function apiFetch(path: string, auth: ApiAuth, init: RequestInit = {}): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };
  if (auth.token) headers.Authorization = `Bearer ${auth.token}`;
  if (auth.pass) headers["x-agora-beta"] = auth.pass;
  const res = await fetch(`${SITE}${path}`, { ...init, headers });
  if (auth.pass && !path.startsWith("/api/beta") && atTheDoor(res.url)) turnedAway.forEach((fn) => fn());
  return res;
}
