/* The call you are in, held above every screen so it keeps going when
   you leave the room's page: the mini-player reads it, the room screen
   reads it, and the LiveKit room itself is mounted at the root
   (callHost) for as long as this says there is one. A drop that was
   not ours is remembered, so the room screen can come straight back. */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

export interface ActiveCall {
  roomId: string;
  motion: string;
  hostName: string;
  serverUrl: string;
  token: string;
  /** Whether the token lets you publish; a promotion re-mints and updates it. */
  onStage: boolean;
}

export interface Dropped {
  roomId: string;
  at: number;
  /** LiveKit's DisconnectReason, when the room reported one before the drop. */
  reason: number | undefined;
}

interface CallState {
  active: ActiveCall | null;
  /** The last call that ended without us asking; cleared by the next join. */
  dropped: Dropped | null;
  join(call: ActiveCall): void;
  /** A new token for the same room (the LiveKit room reconnects with it). */
  update(patch: Partial<ActiveCall>): void;
  /** Ours: hang up. */
  leave(): void;
  /** Not ours: the room went away under us. */
  dropCall(): void;
}

const Ctx = createContext<CallState | null>(null);

/* The reason arrives on the room's own event a moment before the
   room component reports the disconnect; it is kept here for the drop. */
let pendingReason: number | undefined;
export function noteDisconnectReason(reason: number | undefined) {
  pendingReason = reason;
}

export function CallProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<ActiveCall | null>(null);
  const [dropped, setDropped] = useState<Dropped | null>(null);
  const join = useCallback((call: ActiveCall) => {
    pendingReason = undefined;
    setDropped(null);
    setActive(call);
  }, []);
  const update = useCallback((patch: Partial<ActiveCall>) => setActive((a) => (a ? { ...a, ...patch } : a)), []);
  const leave = useCallback(() => {
    setDropped(null);
    setActive(null);
  }, []);
  const dropCall = useCallback(() => {
    setActive((a) => {
      if (a) setDropped({ roomId: a.roomId, at: Date.now(), reason: pendingReason });
      pendingReason = undefined;
      return null;
    });
  }, []);
  const value = useMemo(() => ({ active, dropped, join, update, leave, dropCall }), [active, dropped, join, update, leave, dropCall]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCall(): CallState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useCall outside CallProvider");
  return v;
}
