/* The last known signed-in user, for the navbar. The home shell and the
   chrome routes both learn who is signed in over the network after they
   mount, and until then the navbar would say "Log in" to someone who is
   — a flash on every arrival at the home page. Whoever resolves the
   session writes it here; whoever mounts paints it at once, and the
   real answer reconciles when it lands (a cleared cache on sign-out or
   a gone session). localStorage, so it survives the tab; never trusted
   for anything but the picture in the corner. */

const KEY = "ag-nav-user";

export type CachedNavUser = {
  id: string;
  name: string;
  username: string | null;
  avatarUrl: string | null;
};

export function readNavUser(): CachedNavUser | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const u = JSON.parse(raw) as Partial<CachedNavUser>;
    return u && typeof u.id === "string" && typeof u.name === "string"
      ? { id: u.id, name: u.name, username: u.username ?? null, avatarUrl: u.avatarUrl ?? null }
      : null;
  } catch {
    return null;
  }
}

export function writeNavUser(u: CachedNavUser | null) {
  try {
    if (u) localStorage.setItem(KEY, JSON.stringify(u));
    else localStorage.removeItem(KEY);
  } catch {}
}
