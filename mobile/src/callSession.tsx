/* The call you are in, held above every screen so it keeps going when
   you leave the room's page: the mini-player reads it, the room screen
   reads it, and the LiveKit room itself is mounted at the root
   (callHost) for as long as this says there is one. */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

export interface ActiveCall {
  roomId: string;
  motion: string;
  hostName: string;
  serverUrl: string;
  token: string;
}

interface CallState {
  active: ActiveCall | null;
  join(call: ActiveCall): void;
  leave(): void;
}

const Ctx = createContext<CallState | null>(null);

export function CallProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<ActiveCall | null>(null);
  const join = useCallback((call: ActiveCall) => setActive(call), []);
  const leave = useCallback(() => setActive(null), []);
  const value = useMemo(() => ({ active, join, leave }), [active, join, leave]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCall(): CallState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useCall outside CallProvider");
  return v;
}
