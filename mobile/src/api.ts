/* Calls to the website's API. The browser sends cookies; the app sends
   the session's access token as a bearer and the beta pass as a header
   (src/lib/supabase-server.ts and src/proxy.ts in the web app read both). */

export const SITE = (process.env.EXPO_PUBLIC_SITE_ORIGIN ?? "https://agorasphere.net").replace(/\/$/, "");

export interface ApiAuth {
  token?: string | null;
  pass?: string | null;
}

export async function apiFetch(path: string, auth: ApiAuth, init: RequestInit = {}): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };
  if (auth.token) headers.Authorization = `Bearer ${auth.token}`;
  if (auth.pass) headers["x-agora-beta"] = auth.pass;
  return fetch(`${SITE}${path}`, { ...init, headers });
}
