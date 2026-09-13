/* The whole app sits inside the LiveKit room, so any screen (the room,
   the mini-player) can read participants and drive the mic, and audio
   carries on wherever you navigate. The room connects while there is an
   active call; the native audio session is opened for the call's
   lifetime so playback continues with the screen off. */
import { useEffect, type ReactNode } from "react";
import { loadLiveKit } from "./livekit";
import { useCall } from "./callSession";

export function CallHost({ children }: { children: ReactNode }) {
  const { active, dropCall } = useCall();
  const lk = loadLiveKit();
  const roomId = active?.roomId ?? null;
  useEffect(() => {
    if (!lk || !roomId) return;
    /* A room is listened to out loud: the speaker by default, the
       phone's own route picker for headphones and AirPlay. */
    void lk.AudioSession.configureAudio({ ios: { defaultOutput: "speaker" }, android: { preferredOutputList: ["speaker", "bluetooth", "headset", "earpiece"], audioTypeOptions: lk.AndroidAudioTypePresets.communication } })
      .catch(() => undefined)
      .then(() => lk.AudioSession.startAudioSession());
    return () => {
      void lk.AudioSession.stopAudioSession();
    };
  }, [lk, roomId]);
  if (!lk) return <>{children}</>;
  /* The LiveKit room stays in the tree whether or not a call is on:
     swapping it in around the app would remount everything under it,
     the navigator included, and every join would land back on the home
     tab. With no token it simply doesn't connect. */
  const Room = lk.LiveKitRoom;
  return (
    <Room serverUrl={active?.serverUrl} token={active?.token} connect={!!active} audio={false} video={false} onDisconnected={dropCall}>
      {children}
    </Room>
  );
}
