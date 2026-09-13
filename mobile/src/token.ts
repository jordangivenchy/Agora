/* The LiveKit token from the site's mint, and whether it lets you speak
   (read from the grant, so a promotion or demotion can re-ask). Over the
   audience ceiling the mint answers with the room's broadcast instead:
   no call, the composited stream is watched (the site's HLS mode). */
import { apiFetch, type ApiAuth } from "./api";

export interface Minted {
  token: string;
  onStage: boolean;
}

export interface HlsMode {
  url: string;
  viewerCount?: number;
}

export type MintResult =
  | { ok: true; minted: Minted; hls: null }
  | { ok: true; minted: null; hls: HlsMode }
  | { ok: false; message: string; code?: "room_ended" | "room_not_open" | "not_found" };

function canPublishOf(token: string): boolean {
  try {
    const part = token.split(".")[1] ?? "";
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(part.length + ((4 - (part.length % 4)) % 4), "=");
    const json = JSON.parse(globalThis.atob(b64)) as { video?: { canPublish?: boolean } };
    return !!json.video?.canPublish;
  } catch {
    return false;
  }
}

export async function mintToken(auth: ApiAuth, roomId: string): Promise<MintResult> {
  const res = await apiFetch("/api/livekit", auth, { method: "POST", body: JSON.stringify({ roomId, role: "spectator" }) }).catch(() => null);
  if (!res) return { ok: false, message: "Couldn't reach AgoraSphere." };
  const body = (await res.json().catch(() => ({}))) as { token?: string; error?: string; mode?: string; url?: string; viewerCount?: number; opensAt?: string };
  if (!res.ok) {
    if (body.error === "room_ended") return { ok: false, message: "This room has ended.", code: "room_ended" };
    if (body.error === "room_not_open") {
      const at = body.opensAt ? new Date(body.opensAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "soon";
      return { ok: false, message: `The doors open ${at}.`, code: "room_not_open" };
    }
    if (res.status === 404) return { ok: false, message: "This room isn't available.", code: "not_found" };
    return { ok: false, message: `Couldn't join (${res.status}).` };
  }
  if (body.mode === "hls" && typeof body.url === "string") return { ok: true, minted: null, hls: { url: body.url, viewerCount: body.viewerCount } };
  if (!body.token) return { ok: false, message: "No token came back." };
  return { ok: true, minted: { token: body.token, onStage: canPublishOf(body.token) }, hls: null };
}
