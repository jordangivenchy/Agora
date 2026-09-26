"use client";

/* The live room's home: the root layout's call slot (app/@call/agora/[id]).

   Navigating in the app keeps this mounted even after the address has
   moved on (Next's parallel routes keep a slot's page on a soft
   navigation), so the call — its connection, its audio, the seat —
   carries on while you browse. The room reads `minimized` from here and
   shows itself as a card in the corner until you come back.

   Leaving is the one thing that ends it: `leave(href)` goes to href and
   drops the room once that page is showing (so there is no blank frame
   in between), `end()` drops it where you are (the card's Leave). The
   room unmounting is what hangs the call up, exactly as it did when the
   room was a page of its own. Coming back to the room after leaving it —
   the browser's Back — is a fresh visit. */

import { createContext, useContext, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import AgoraPage from "./AgoraRoomPage";

export interface CallSlotApi {
  /** Another page is showing: the call carries on as a card in the corner. */
  minimized: boolean;
  /** Leave the room for good: the call ends once `href` is showing. */
  leave: (href: string) => void;
  /** End the call where you are (the card's Leave). */
  end: () => void;
  /** Keep the call and go browsing: back to the last page you were on, or home. */
  minimize: () => void;
  /** Back into the room from the card. */
  expand: () => void;
}

/* Outside a slot (never in practice): leaving is a plain page load. */
const outside: CallSlotApi = {
  minimized: false,
  leave: (href) => { window.location.href = href; },
  end: () => {},
  minimize: () => { window.location.href = "/"; },
  expand: () => {},
};

const CallSlotContext = createContext<CallSlotApi>(outside);

export function useCallSlot(): CallSlotApi {
  return useContext(CallSlotContext);
}

export function isRoomPath(pathname: string | null | undefined): boolean {
  return !!pathname && pathname.startsWith("/agora/");
}

export default function CallSlot({ params }: { params: Promise<{ id: string }> }) {
  const pathname = usePathname();
  const router = useRouter();
  const onRoute = isRoomPath(pathname);
  const [session, setSession] = useState(0);
  const [ending, setEnding] = useState(false);
  /* The room's own address, for the card to go back to, and the last
     page browsed, for Minimize to go to. */
  const [roomHref, setRoomHref] = useState<string | null>(onRoute ? pathname : null);
  const [browseHref, setBrowseHref] = useState<string | null>(null);
  const [seenPath, setSeenPath] = useState(pathname);
  if (pathname !== seenPath) {
    setSeenPath(pathname);
    if (isRoomPath(pathname)) {
      setRoomHref(pathname);
      if (ending && !isRoomPath(seenPath)) {
        setEnding(false);
        setSession((n) => n + 1);
      }
    } else {
      setBrowseHref(pathname);
    }
  }

  const api = useMemo<CallSlotApi>(() => ({
    minimized: !onRoute,
    leave: (href) => {
      setEnding(true);
      router.push(href);
    },
    end: () => setEnding(true),
    minimize: () => router.push(browseHref ?? "/"),
    expand: () => {
      if (roomHref) router.push(roomHref);
    },
  }), [onRoute, router, browseHref, roomHref]);

  if (ending && !onRoute) return null;
  return (
    <CallSlotContext.Provider value={api}>
      <AgoraPage key={session} params={params} />
    </CallSlotContext.Provider>
  );
}
