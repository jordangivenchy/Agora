"use client";

/* Call diagnostics: the moments a live room can go wrong on a device —
   a token refused, the call dropping (with LiveKit's reason), the access
   gate sending someone home, a seat restored after a freeze. Each is one
   row in room_call_events via the log_room_event RPC, tagged with the
   browser and page state, so "it kicked me" can be matched to what
   happened. Fire-and-forget; nothing here can affect the call. */

import { createClient } from "@/lib/supabase-browser";

let client: ReturnType<typeof createClient> | null = null;

export function logRoomEvent(
  roomId: string,
  event: string,
  reason?: string | null,
  meta: Record<string, unknown> = {}
) {
  try {
    if (typeof window === "undefined") return;
    client ??= createClient();
    const nav = navigator as Navigator & { connection?: { effectiveType?: string } };
    const tagged = {
      ...meta,
      ua: nav.userAgent.slice(0, 160),
      vis: document.visibilityState,
      online: nav.onLine,
      net: nav.connection?.effectiveType ?? null,
      vw: window.innerWidth,
      vh: window.innerHeight,
      t: Date.now(),
    };
    console.info(`[room] ${event}${reason ? ` — ${reason}` : ""}`, meta);
    client
      .rpc("log_room_event", { p_room: roomId, p_event: event, p_reason: reason ?? null, p_meta: tagged })
      .then(undefined, () => {});
  } catch {
    /* diagnostics never throw */
  }
}

/* The last thing the person did in the room (a control's label), kept
   in sessionStorage so a page that comes back after an unclean exit
   can say what was tapped right before it died. */
export function noteRoomAction(roomId: string, label: string) {
  try {
    sessionStorage.setItem(`agora:lastAction:${roomId}`, `${label.slice(0, 60)}@${Date.now()}`);
  } catch {
    /* private mode */
  }
}

export function takeRoomAction(roomId: string): string | null {
  try {
    const v = sessionStorage.getItem(`agora:lastAction:${roomId}`);
    sessionStorage.removeItem(`agora:lastAction:${roomId}`);
    return v;
  } catch {
    return null;
  }
}
