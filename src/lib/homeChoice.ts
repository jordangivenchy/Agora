/* "/" for a signed-in visitor is their feed — until they pick Home
   themselves (the sidebar's Home, the logo), which makes "/" the browse
   page for the rest of the browser session. The choice is a session
   cookie so the home route can decide on the server (app/page.tsx),
   before anything renders. */

export const HOME_COOKIE = "ag-home";

export function markHomeChosen(): void {
  try { document.cookie = `${HOME_COOKIE}=1; path=/; samesite=lax`; } catch { /* no document */ }
}

export function homeChosen(): boolean {
  try { return document.cookie.split(";").some((c) => c.trim().startsWith(`${HOME_COOKIE}=1`)); } catch { return false; }
}
