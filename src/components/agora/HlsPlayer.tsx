"use client";

/* HLS playback for audience overflow — WebRTC carries the stage, but at
   scale (~300+ concurrent) listeners can ride the composited HLS stream
   instead. Safari plays HLS natively; everyone else gets hls.js, loaded
   on demand so the room bundle doesn't carry it. */

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Icon } from "@/components/icons";

/* Whether the broadcast's sound is on, for the whole page: one tap on
   any surface turns it on everywhere. The room keeps its own surface —
   and so its sound — while it is minimized to the call card, and the
   card shows the same broadcast silently beside it (`silent`), so there
   is only ever one voice, whichever surface the tap came from. */
let broadcastSound = false;
const soundListeners = new Set<() => void>();
function subscribeSound(fn: () => void) {
  soundListeners.add(fn);
  return () => { soundListeners.delete(fn); };
}
function turnSoundOn() {
  if (broadcastSound) return;
  broadcastSound = true;
  soundListeners.forEach((fn) => fn());
}
function useBroadcastSound(): boolean {
  return useSyncExternalStore(subscribeSound, () => broadcastSound, () => false);
}

/* Attach an HLS source to a <video>: native on Safari, hls.js elsewhere.
   `live` tunes hls.js for edge-chasing; VOD playlists (the replay) load
   with defaults so seeking across the whole recording works. Shared by
   the live overflow overlay and the ended-room replay player. */
export function useHlsSource(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  src: string | null,
  { live = true, autoplay = true }: { live?: boolean; autoplay?: boolean } = {}
): { error: string | null } {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;
    let hls: { destroy: () => void } | null = null;
    let cancelled = false;
    setError(null);

    const onNativeError = () => setError("This recording couldn't be loaded.");

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = src;
      video.addEventListener("error", onNativeError);
      if (autoplay) video.play().catch(() => {});
    } else {
      import("hls.js").then(({ default: Hls }) => {
        if (cancelled || !Hls.isSupported()) return;
        const h = new Hls(live ? { liveSyncDurationCount: 2, maxLiveSyncPlaybackRate: 1.05 } : {});
        h.on(Hls.Events.ERROR, (_evt, data) => {
          if (data.fatal) setError("This recording couldn't be loaded.");
        });
        h.loadSource(src);
        h.attachMedia(video);
        hls = h;
        if (autoplay) video.play().catch(() => {});
      });
    }
    return () => {
      cancelled = true;
      video.removeEventListener("error", onNativeError);
      if (hls) hls.destroy();
    };
  }, [videoRef, src, live, autoplay]);

  return { error };
}

/* ── Audience-overflow broadcast surface ─────────────────────────────
   The stage surface for viewers admitted in HLS mode: the composited
   broadcast fills the same slot AgoraStage owns (or the dock corner in
   audience view). Autoplay must start muted to satisfy browser policy —
   a tap-to-unmute overlay does the gesture — and a small pill is honest
   about the segment delay so the ~15s lag never reads as "broken". */
export function HlsBroadcastSurface({ src, compact = false, silent = false }: {
  src: string;
  compact?: boolean;
  /** Pictures only — another surface carries the sound (the call card
      beside the minimized room). Its unmute still turns that sound on. */
  silent?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const { error } = useHlsSource(videoRef, src, { live: true });
  const sound = useBroadcastSound();
  const muted = silent || !sound;

  /* The sound turned on from another surface (or this one): follow it.
     Set on the element — React doesn't keep `muted` in step after mount. */
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = muted;
    if (!muted) v.play().catch(() => {});
  }, [muted]);

  const unmute = () => {
    const v = videoRef.current;
    if (v && !silent) {
      v.muted = false;
      v.play().catch(() => {});
    }
    turnSoundOn();
  };

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        borderRadius: compact ? 12 : 16,
        overflow: "hidden",
        background: "#050507",
        boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
      }}
    >
      <video
        ref={videoRef}
        muted={muted}
        autoPlay
        playsInline
        /* Belt to autoplay's brace: if the initial play() raced the
           source attach (or the tab was busy), retry once decodable. */
        onCanPlay={(e) => {
          const v = e.currentTarget;
          if (v.paused) v.play().catch(() => {});
        }}
        style={{ width: "100%", height: "100%", objectFit: "contain", background: "black" }}
      />
      {error && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#c0c0c8",
            fontSize: 13,
            padding: 16,
            textAlign: "center",
          }}
        >
          The broadcast stream couldn&apos;t be loaded — it may be restarting.
        </div>
      )}
      {!sound && !error && (
        <button
          onClick={unmute}
          className="cursor-pointer"
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            transform: "translate(-50%, -50%)",
            padding: compact ? "7px 12px" : "10px 18px",
            borderRadius: 999,
            background: "rgba(10,10,14,0.78)",
            border: "0.5px solid rgba(255,255,255,0.28)",
            color: "#f5f5f0",
            fontSize: compact ? 12 : 14,
            fontFamily: "inherit",
            display: "flex",
            alignItems: "center",
            gap: 7,
          }}
        >
          <Icon name="volume-2" size={compact ? 13 : 15} /> Tap to unmute
        </button>
      )}
      <span
        style={{
          position: "absolute",
          left: 10,
          bottom: 10,
          padding: "4px 9px",
          borderRadius: 999,
          background: "rgba(10,10,14,0.7)",
          border: "0.5px solid rgba(255,255,255,0.16)",
          color: "#c9c9d2",
          fontSize: 10.5,
          letterSpacing: "0.03em",
          pointerEvents: "none",
          whiteSpace: "nowrap",
        }}
      >
        Broadcast view · ~15s behind live
      </span>
    </div>
  );
}

export default function HlsPlayer({ src, onClose }: { src: string; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  useHlsSource(videoRef, src, { live: true });

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 90,
        background: "rgba(5,5,7,0.96)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <video
        ref={videoRef}
        playsInline
        controls
        style={{ maxWidth: "96vw", maxHeight: "88vh", borderRadius: 12, background: "black" }}
      />
      <button
        onClick={onClose}
        title="Back to the live room"
        className="cursor-pointer"
        style={{
          position: "absolute",
          top: 16,
          right: 18,
          padding: "8px 14px",
          borderRadius: 10,
          background: "rgba(255,255,255,0.08)",
          border: "0.5px solid rgba(255,255,255,0.2)",
          color: "#e5e5ec",
          fontSize: 13,
        }}
      >
        <Icon name="x" size={13} /> Leave stream view
      </button>
    </div>
  );
}
