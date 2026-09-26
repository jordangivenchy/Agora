"use client";

/* The live room's home: the root layout's call slot (app/@call/agora/[id]).

   Navigating in the app keeps this mounted even after the address has
   moved on (Next's parallel routes keep a slot's page on a soft
   navigation), so the call — its connection, its audio, the seat —
   carries on while you browse. The room reads `minimized` from here and
   shows itself as a card in the corner until you come back.

   Coming back from the card changes the address with the browser's own
   history (Next keeps its page tree as it is, and usePathname follows),
   so the page you were browsing stays mounted underneath the room —
   `overPage` — instead of being torn down for the room's address. Going
   back to that page is then just history: Minimize, or the browser's
   Back, returns to it at once, still there, nothing to load; Forward
   brings the room back over it.

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
  /** The room is at its address with the page you were browsing still
      mounted underneath it (back from the card): the room lies over it. */
  overPage: boolean;
  /** The page showing now (the room's own address, or the one browsed to). */
  path: string;
  /** Leave the room for good: the call ends once `href` is showing. */
  leave: (href: string) => void;
  /** End the call where you are (the card's Leave). */
  end: () => void;
  /** Keep the call and go browsing: back to the last page you were on, or home. */
  minimize: () => void;
  /** Back into the room from the card: `over` the page you were on (kept
      underneath), or in its place as a page of its own. */
  expand: (over: boolean) => void;
}

/* Outside a slot (never in practice): leaving is a plain page load. */
const outside: CallSlotApi = {
  minimized: false,
  overPage: false,
  path: "",
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

/* Where the page stood when the room came back over it, so the page can
   be held there while it is covered: Next can have a scroll-to-top left
   over from the navigation that brought that page (its first render was
   empty, a loading fallback, so there was nothing to scroll then), and
   the room's change of address sets it off — the hidden page would glide
   away underneath the growing room, and glide back as it shrinks. */
let coverScroll: number | null = null;
export function takeCoverScroll(): number | null {
  const y = coverScroll;
  coverScroll = null;
  return y;
}

/* The history entry the card makes when it brings the room back over a
   page: a mark of our own beside Next's state. */
const OVER = "agoraRoomOver";
function entryIsOver(): boolean {
  if (typeof window === "undefined") return false;
  const st = window.history.state as Record<string, unknown> | null;
  return !!st && st[OVER] === true;
}

export default function CallSlot({ params }: { params: Promise<{ id: string }> }) {
  const pathname = usePathname();
  const router = useRouter();
  const onRoute = isRoomPath(pathname);
  /* A document loaded at a room's address has the room's own page under
     it, whatever mark its history entry carries from before a reload:
     cleared as the slot first mounts, before anything reads it. (Next's
     own state passes through untouched — with it in the entry, Next's
     history hook stands aside.) */
  useState(() => {
    if (onRoute && entryIsOver()) {
      const st = window.history.state as Record<string, unknown>;
      window.history.replaceState({ ...st, [OVER]: false }, "");
    }
    return null;
  });
  /* Read while rendering: the address and the entry change together, and
     every change of address renders this again. */
  const overPage = onRoute && entryIsOver();
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
    overPage,
    path: pathname ?? "",
    leave: (href) => {
      setEnding(true);
      router.push(href);
    },
    end: () => setEnding(true),
    /* Over a page (back from the card): that page is the entry behind
       this one, still mounted — history, not a navigation. Otherwise the
       last page browsed (or home) has to come from the server. */
    minimize: () => {
      if (overPage) window.history.back();
      else router.push(browseHref ?? "/");
    },
    /* Over the page: the address follows the room back in without Next
       navigating, so the page underneath stays as it is. In its place:
       Next navigates to the room's own page, as when it was entered. If
       the address never left the room (a minimize whose page hadn't
       arrived yet), either way happens in place, calling that page off. */
    expand: (over) => {
      if (!roomHref) return;
      if (over) {
        coverScroll = window.scrollY;
        if (onRoute) window.history.replaceState({ [OVER]: overPage }, "", roomHref);
        else window.history.pushState({ [OVER]: true }, "", roomHref);
      } else if (onRoute) router.replace(roomHref);
      else router.push(roomHref);
    },
  }), [onRoute, overPage, pathname, router, browseHref, roomHref]);

  if (ending && !onRoute) return null;
  return (
    <CallSlotContext.Provider value={api}>
      <AgoraPage key={session} params={params} />
    </CallSlotContext.Provider>
  );
}
