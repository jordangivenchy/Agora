/* While there is an active call, the whole app sits inside the LiveKit
   room, so any screen (the room, the mini-player) can read participants
   and drive the mic, and audio carries on wherever you navigate. The
   native audio session is opened for the call's lifetime so playback
   continues with the screen off. */
import { useEffect, type ReactNode } from "react";
import { loadLiveKit } from "./livekit";
import { useCall } from "./callSession";

export function CallHost({ children }: { children: ReactNode }) {
  const { active, leave } = useCall();
  const lk = loadLiveKit();
  useEffect(() => {
    if (!lk || !active) return;
    void lk.AudioSession.startAudioSession();
    return () => {
      void lk.AudioSession.stopAudioSession();
    };
  }, [lk, active]);
  if (!lk || !active) return <>{children}</>;
  const Room = lk.LiveKitRoom;
  return (
    <Room serverUrl={active.serverUrl} token={active.token} connect audio={false} video={false} onDisconnected={leave}>
      {children}
    </Room>
  );
}
