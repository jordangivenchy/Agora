"use client";

/* AgoraSphere's own VOD player chrome — a bare <video> under a custom
   control bar (play/pause, gold seek bar, elapsed/total, mute + volume,
   fullscreen) instead of the browser's stock controls, so replays look
   the same everywhere and carry no download / PiP / rate menus.

   Shared by the community-thread ReplayEmbed and the replay page; the
   page passes a ref (transcript click-to-seek writes currentTime) and
   an onTimeUpdate (transcript highlight follows playback).

   Controls fade while playing and reappear on any pointer or key
   activity. Keyboard on the focused player: space toggles, ←/→ scrub
   5s, m mutes, f fullscreens. */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { useHlsSource } from "./HlsPlayer";
import { Icon } from "@/components/icons";
import ClipEditor from "./ClipEditor";

function fmtTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) return "0:00";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60).toString().padStart(2, "0");
  return h > 0 ? `${h}:${m.toString().padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

const GOLD = "#e2b96b";

export interface ReplayPlayerProps {
  src: string | null;
  poster?: string;
  onTimeUpdate?: (t: number) => void;
  onSeeking?: () => void;
  /** Rendered when the playlist can't load (still finalizing, pruned). */
  errorFallback?: React.ReactNode;
  /** Reports the load-error state up (null = healthy). */
  onError?: (msg: string | null) => void;
  /** Play only this window of the VOD (clip playback): starts there,
      pauses at the end, and the seek bar maps just the range. */
  range?: { start: number; end: number } | null;
  /** Enable the ✂ control: viewers mark [start, end] at the current
      position and the range is saved to the clips table for this room. */
  clipRoomId?: string | null;
  style?: React.CSSProperties;
}

const ReplayPlayer = forwardRef<HTMLVideoElement | null, ReplayPlayerProps>(
  function ReplayPlayer({ src, poster, onTimeUpdate, onSeeking, errorFallback, onError, range, clipRoomId, style }, fwdRef) {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const wrapRef = useRef<HTMLDivElement | null>(null);
    const barRef = useRef<HTMLDivElement | null>(null);
    useImperativeHandle(fwdRef, () => videoRef.current as HTMLVideoElement);

    const { error } = useHlsSource(videoRef, src, { live: false, autoplay: false });
    useEffect(() => { onError?.(error); }, [error, onError]);

    const [playing, setPlaying] = useState(false);
    const [time, setTime] = useState(0);
    const [dur, setDur] = useState(0);
    const [muted, setMuted] = useState(false);
    const [vol, setVol] = useState(1);
    const [fs, setFs] = useState(false);
    const [chrome, setChrome] = useState(true);
    const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const draggingRef = useRef(false);

    /* Range playback (clips): all bar math happens inside the window. */
    const rStart = range ? Math.max(0, range.start) : 0;
    const rEnd = range && range.end > range.start ? range.end : null;
    const eDur = rEnd !== null ? rEnd - rStart : dur;

    /* ✂ opens the Twitch-style editor over the video: the last ~30s are
       pre-selected and the viewer trims with drag handles while the
       selection loops. */
    const [editorAt, setEditorAt] = useState<number | null>(null);
    const openClipEditor = useCallback(() => {
      const v = videoRef.current;
      if (!v || !clipRoomId) return;
      v.pause();
      setEditorAt(v.currentTime);
    }, [clipRoomId]);

    /* Controls linger 2.6s after the last activity while playing. */
    const poke = useCallback(() => {
      setChrome(true);
      if (hideTimer.current) clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => {
        const v = videoRef.current;
        if (v && !v.paused && !draggingRef.current) setChrome(false);
      }, 2600);
    }, []);
    useEffect(() => () => { if (hideTimer.current) clearTimeout(hideTimer.current); }, []);

    const toggle = useCallback(() => {
      const v = videoRef.current;
      if (!v) return;
      if (v.paused) {
        // replaying a finished clip restarts at the range start
        if (rEnd !== null && v.currentTime >= rEnd - 0.1) v.currentTime = rStart;
        v.play().catch(() => {});
      } else v.pause();
      poke();
    }, [poke, rStart, rEnd]);

    const seekBy = useCallback((delta: number) => {
      const v = videoRef.current;
      if (!v) return;
      const lo = rStart;
      const hi = rEnd ?? (v.duration || 0);
      v.currentTime = Math.max(lo, Math.min(hi, v.currentTime + delta));
      poke();
    }, [poke, rStart, rEnd]);

    const toggleFs = useCallback(() => {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      else if (wrapRef.current?.requestFullscreen) wrapRef.current.requestFullscreen().catch(() => {});
      else {
        /* iPhone Safari has no element fullscreen API — only the video
           element's own webkitEnterFullscreen. */
        const v = videoRef.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
        v?.webkitEnterFullscreen?.();
      }
      poke();
    }, [poke]);

    useEffect(() => {
      const onFs = () => setFs(document.fullscreenElement === wrapRef.current);
      document.addEventListener("fullscreenchange", onFs);
      return () => document.removeEventListener("fullscreenchange", onFs);
    }, []);

    /* Seek bar: click or drag anywhere on the track. */
    const seekToClientX = useCallback((clientX: number) => {
      const bar = barRef.current, v = videoRef.current;
      if (!bar || !v || !v.duration) return;
      const r = bar.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
      const span = rEnd !== null ? rEnd - rStart : v.duration;
      v.currentTime = rStart + pct * span;
      setTime(v.currentTime);
    }, [rStart, rEnd]);
    const onBarPointerDown = useCallback((e: React.PointerEvent) => {
      draggingRef.current = true;
      seekToClientX(e.clientX);
      const move = (ev: PointerEvent) => seekToClientX(ev.clientX);
      const up = () => {
        draggingRef.current = false;
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        poke();
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    }, [seekToClientX, poke]);

    const setVolume = useCallback((nv: number) => {
      const v = videoRef.current;
      if (!v) return;
      v.volume = nv;
      v.muted = nv === 0;
      setVol(nv);
      setMuted(nv === 0);
      poke();
    }, [poke]);

    if (error) {
      return <>{errorFallback ?? null}</>;
    }

    const shownTime = Math.max(0, time - rStart);
    const pct = eDur > 0 ? Math.min(100, (shownTime / eDur) * 100) : 0;
    const btn: React.CSSProperties = {
      background: "transparent", border: "none", color: "#f0f0f2",
      cursor: "pointer", padding: 4, display: "inline-flex", alignItems: "center",
    };

    return (
      <div
        ref={wrapRef}
        tabIndex={0}
        onPointerMove={poke}
        onPointerDown={poke}
        onKeyDown={(e) => {
          if (editorAt !== null) {
            // typing a clip title must not drive the player
            if (e.key === "Escape") setEditorAt(null);
            return;
          }
          if (e.key === " " || e.key === "k") { e.preventDefault(); toggle(); }
          else if (e.key === "ArrowLeft") { e.preventDefault(); seekBy(-5); }
          else if (e.key === "ArrowRight") { e.preventDefault(); seekBy(5); }
          else if (e.key === "m") { setVolume(muted ? (vol || 1) : 0); }
          else if (e.key === "f") { toggleFs(); }
        }}
        style={{
          position: "relative", width: "100%", borderRadius: fs ? 0 : 12,
          overflow: "hidden", background: "black", outline: "none",
          cursor: chrome ? "default" : "none",
          ...style,
        }}
      >
        <video
          ref={videoRef}
          playsInline
          preload="metadata"
          poster={poster}
          onClick={toggle}
          onDoubleClick={toggleFs}
          onPlay={() => { setPlaying(true); poke(); }}
          onPause={() => { setPlaying(false); setChrome(true); }}
          onEnded={() => { setPlaying(false); setChrome(true); }}
          onTimeUpdate={(e) => {
            const v = e.currentTarget;
            // clip playback stops at the range's end
            if (rEnd !== null && v.currentTime >= rEnd && !v.paused) v.pause();
            setTime(v.currentTime);
            onTimeUpdate?.(v.currentTime);
          }}
          onDurationChange={(e) => {
            const v = e.currentTarget;
            setDur(v.duration);
            // clip playback opens at the range's start
            if (rStart > 0 && v.currentTime < rStart) v.currentTime = rStart;
          }}
          onSeeking={onSeeking}
          onVolumeChange={(e) => { setMuted(e.currentTarget.muted); setVol(e.currentTarget.volume); }}
          style={{ display: "block", width: "100%", height: fs ? "100%" : undefined, aspectRatio: fs ? undefined : "16 / 9", objectFit: "contain" }}
        />

        {/* Big center play affordance while paused */}
        {!playing && editorAt === null && (
          <button
            onClick={toggle}
            aria-label="Play"
            className="cursor-pointer"
            style={{
              position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)",
              width: 58, height: 58, borderRadius: "50%",
              background: "rgba(10,10,14,0.72)", border: "0.5px solid rgba(255,255,255,0.28)",
              color: "#f5f5f0", display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            <Icon name="play" size={22} style={{ fill: "currentColor", marginLeft: 3 }} />
          </button>
        )}

        {/* Control bar */}
        <div
          style={{
            position: "absolute", left: 0, right: 0, bottom: 0,
            padding: "26px 12px 8px",
            background: "linear-gradient(transparent, rgba(5,5,8,0.88))",
            opacity: chrome && editorAt === null ? 1 : 0,
            pointerEvents: chrome && editorAt === null ? "auto" : "none",
            transition: "opacity 0.25s ease",
          }}
        >
          {/* Seek track */}
          <div
            ref={barRef}
            onPointerDown={onBarPointerDown}
            role="slider"
            aria-label="Seek"
            aria-valuemin={0}
            aria-valuemax={Math.floor(eDur)}
            aria-valuenow={Math.floor(shownTime)}
            style={{ padding: "6px 0", cursor: "pointer" }}
          >
            <div style={{ position: "relative", height: 4, borderRadius: 2, background: "rgba(255,255,255,0.22)" }}>
              <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${pct}%`, borderRadius: 2, background: GOLD }} />
              <div style={{
                position: "absolute", left: `${pct}%`, top: "50%", transform: "translate(-50%, -50%)",
                width: 12, height: 12, borderRadius: "50%", background: GOLD,
                boxShadow: "0 0 6px rgba(226,185,107,0.6)",
              }} />
            </div>
          </div>

          <div className="rp-controls" style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 2 }}>
            <button onClick={toggle} aria-label={playing ? "Pause" : "Play"} className="rp-btn" style={btn}>
              <Icon name={playing ? "pause" : "play"} size={17} style={{ fill: "currentColor" }} />
            </button>
            <button onClick={() => setVolume(muted ? (vol || 1) : 0)} aria-label={muted ? "Unmute" : "Mute"} className="rp-btn" style={btn}>
              <Icon name={muted ? "volume-x" : "volume-2"} size={16} />
            </button>
            <input
              type="range"
              min={0} max={1} step={0.05}
              value={muted ? 0 : vol}
              onChange={(e) => setVolume(Number(e.target.value))}
              aria-label="Volume"
              className="rp-vol" style={{ width: 68, accentColor: GOLD, cursor: "pointer" }}
            />
            <span className="rp-time" style={{ fontSize: 11.5, color: "#d9d9df", fontFamily: "'DM Mono', monospace", whiteSpace: "nowrap" }}>
              {fmtTime(shownTime)} <span style={{ color: "#8b8b94" }}>/ {fmtTime(eDur)}</span>
            </span>
            <span style={{ flex: 1 }} />
            {clipRoomId && (
              <button
                onClick={openClipEditor}
                aria-label="Clip this moment"
                title="Clip this moment"
                style={btn}
              >
                <Icon name="scissors" size={16} />
              </button>
            )}
            <button onClick={toggleFs} aria-label={fs ? "Exit fullscreen" : "Fullscreen"} className="rp-btn" style={btn}>
              <Icon name={fs ? "minimize" : "maximize"} size={16} />
            </button>
          </div>
        </div>

        {clipRoomId && editorAt !== null && (
          <ClipEditor
            videoRef={videoRef}
            duration={dur}
            captureAt={editorAt}
            roomId={clipRoomId}
            onClose={() => setEditorAt(null)}
          />
        )}
      </div>
    );
  }
);

export default ReplayPlayer;
