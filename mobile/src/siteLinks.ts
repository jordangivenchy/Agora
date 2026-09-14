/* Links in posts, comments, chat and messages. AgoraSphere's own URLs
   open the matching screen in the app: a thread (and the comment it
   points at), a community, a room, a replay, a clip, a person, a
   conversation, a section. Anything else opens in the in-app browser.
   The paths are the site's: src/lib/routes.ts (pathFor), src/lib/urls.ts
   (roomPath, replayPath, userPath), src/lib/communityUrls.ts (slugs) and
   the /@name rewrite in src/proxy.ts. */
import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { supabase } from "./supabase";
import { SITE } from "./api";
import { parseRoomParam, resolvePrefix } from "./roomData";
import { showToast } from "./toast";

const SITE_HOSTS = new Set(["agorasphere.net", "www.agorasphere.net"]);
try {
  SITE_HOSTS.add(new URL(SITE).host);
} catch {
  /* a malformed origin: the production hosts still match */
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SECTIONS = new Set(["feed", "explore", "trending", "news"]);

function decode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** The site's community slug (src/lib/communityUrls.ts slugify). */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

/* Slugs come from names, so they resolve against the list: a bare slug
   is the oldest community with that name, a slug with a six-character
   id tail picks the one whose id starts so, and a uuid is itself. */
async function communityIdForSlug(slug: string): Promise<string | null> {
  const s = slug.toLowerCase();
  if (UUID_RE.test(s)) return s;
  const { data } = await supabase.from("communities").select("id, name").order("created_at", { ascending: true });
  const all = (data ?? []) as { id: string; name: string }[];
  const base = (c: { id: string; name: string }) => slugify(c.name) || c.id.slice(0, 6);
  const exact = all.find((c) => base(c) === s);
  if (exact) return exact.id;
  const tail = s.match(/^(.*)-([0-9a-f]{6})$/);
  if (tail) return all.find((c) => base(c) === tail[1] && c.id.startsWith(tail[2]))?.id ?? null;
  return null;
}

async function roomIdFromParam(param: string): Promise<string | null> {
  const { uuid, prefix } = parseRoomParam(param);
  if (uuid) return uuid;
  return prefix ? resolvePrefix(supabase, prefix) : null;
}

/** Whether a URL is one of AgoraSphere's own pages. */
export function isSiteUrl(url: string): boolean {
  if (url.startsWith("/")) return true;
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) && SITE_HOSTS.has(u.host);
  } catch {
    return false;
  }
}

/* A site path ("/posts/x?y#z") to its screen. False when the app has
   no screen for it, so the caller can fall back to the browser. */
export async function routeSitePath(full: string): Promise<boolean> {
  const hashAt = full.indexOf("#");
  const hash = hashAt >= 0 ? full.slice(hashAt + 1) : "";
  const beforeHash = hashAt >= 0 ? full.slice(0, hashAt) : full;
  const qAt = beforeHash.indexOf("?");
  const path = qAt >= 0 ? beforeHash.slice(0, qAt) : beforeHash;
  const query = new URLSearchParams(qAt >= 0 ? beforeHash.slice(qAt + 1) : "");
  const seg = path.split("/").filter(Boolean).map(decode);
  if (seg.length === 0) {
    router.navigate("/");
    return true;
  }
  const [a, b, c] = seg;
  if (a.startsWith("@") && a.length > 1 && !b) {
    router.push({ pathname: "/u/[username]", params: { username: a.slice(1) } });
    return true;
  }
  if (SECTIONS.has(a) && !b) {
    router.navigate(`/${a}`);
    return true;
  }
  switch (a) {
    case "communities": {
      if (!b) {
        router.navigate("/communities");
        return true;
      }
      const id = await communityIdForSlug(b);
      if (!id) {
        showToast("That community isn't here anymore");
        return true;
      }
      router.push({ pathname: "/c/[id]", params: { id } });
      return true;
    }
    case "posts": {
      if (!b) return false;
      const comment = hash.startsWith("comment-") ? hash.slice("comment-".length) : "";
      router.push({ pathname: "/posts/[id]", params: comment ? { id: b, comment } : { id: b } });
      return true;
    }
    case "agora":
      if (!b) return false;
      router.push({ pathname: "/room/[id]", params: { id: b } });
      return true;
    case "replays": {
      if (!b) return false;
      const id = await roomIdFromParam(b);
      if (!id) {
        showToast("That replay isn't here anymore");
        return true;
      }
      router.push({ pathname: "/replay/[id]", params: { id } });
      return true;
    }
    case "clips":
      if (b) router.push({ pathname: "/clips/[id]", params: { id: b } });
      else router.push("/clips");
      return true;
    case "users":
      if (!b) return false;
      router.push({ pathname: "/u/[username]", params: { username: b } });
      return true;
    case "messages":
      if (!b) router.push("/messages");
      else if (b === "g" && c) router.push({ pathname: "/messages/g/[id]", params: { id: c } });
      else router.push({ pathname: "/messages/[username]", params: { username: b } });
      return true;
    case "search": {
      const q = query.get("q")?.trim();
      router.push(q ? { pathname: "/search", params: { q } } : "/search");
      return true;
    }
    case "notifications":
      router.push("/notifications");
      return true;
    case "settings":
      router.push("/settings");
      return true;
    case "mod":
      router.push("/mod");
      return true;
    case "forgot-password":
      router.push("/forgot-password");
      return true;
    default:
      return false;
  }
}

/** Open a link from user text: the app's own screen when there is one, the in-app browser otherwise. */
export async function openLink(url: string): Promise<void> {
  const raw = url.trim();
  if (!raw) return;
  if (raw.startsWith("/")) {
    if (await routeSitePath(raw)) return;
    void WebBrowser.openBrowserAsync(`${SITE}${raw}`).catch(() => undefined);
    return;
  }
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return;
  }
  if (!/^https?:$/.test(u.protocol)) return;
  if (SITE_HOSTS.has(u.host) && (await routeSitePath(`${u.pathname}${u.search}${u.hash}`))) return;
  void WebBrowser.openBrowserAsync(raw).catch(() => undefined);
}

/* Bare URLs in plain text (chat, messages, bodies): trailing punctuation
   stays outside the link, as GFM's autolinks leave it. */
export const URL_RE = /https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]/g;
