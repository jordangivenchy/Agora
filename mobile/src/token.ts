/* The LiveKit token from the site's mint, and whether it lets you speak
   (read from the grant, so a promotion or demotion can re-ask). */
import { apiFetch, type ApiAuth } from "./api";

export interface Minted {
  token: string;
  onStage: boolean;
}

export type MintResult = { ok: true; minted: Minted } | { ok: false; message: string };

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
  const body = (await res.json().catch(() => ({}))) as { token?: string; error?: string; mode?: string; opensAt?: string };
  if (!res.ok) {
    if (body.error === "room_ended") return { ok: false, message: "This room has ended." };
    if (body.error === "room_not_open") {
      const at = body.opensAt ? new Date(body.opensAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "soon";
      return { ok: false, message: `The doors open ${at}.` };
    }
    return { ok: false, message: `Couldn't join (${res.status}).` };
  }
  if (body.mode === "hls") return { ok: false, message: "This room is over the audience limit for live listening. Watch it on agorasphere.net." };
  if (!body.token) return { ok: false, message: "No token came back." };
  return { ok: true, minted: { token: body.token, onStage: canPublishOf(body.token) } };
}
