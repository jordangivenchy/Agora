"use client";

/* HLS playback for audience overflow — WebRTC carries the stage, but at
   scale (~300+ concurrent) listeners can ride the composited HLS stream
   instead. Safari plays HLS natively; everyone else gets hls.js, loaded
   on demand so the room bundle doesn't carry it. */

import { useEffect, useRef } from "react";
import { Icon } from "@/components/icons";

export default function HlsPlayer({ src, onClose }: { src: string; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let hls: { destroy: () => void } | null = null;
    let cancelled = false;

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = src;
      video.play().catch(() => {});
    } else {
      import("hls.js").then(({ default: Hls }) => {
        if (cancelled || !Hls.isSupported()) return;
        const h = new Hls({ liveSyncDurationCount: 3 });
        h.loadSource(src);
        h.attachMedia(video);
        hls = h;
        video.play().catch(() => {});
      });
    }
    return () => {
      cancelled = true;
      if (hls) hls.destroy();
    };
  }, [src]);

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
