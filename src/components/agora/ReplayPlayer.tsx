"use client";

/* AgoraSphere's own VOD player chrome — a bare <video> under a custom
   control bar (play/pause, 10s back and forward, gold seek bar,
   elapsed/total, mute + volume, speed, picture in picture, AirPlay or
   Cast where the browser has them, fullscreen) instead of the browser's
   stock controls, so replays look the same everywhere.

   Shared by the community-thread ReplayEmbed and the replay page; the
   page passes a ref (transcript click-to-seek writes currentTime) and
   an onTimeUpdate (transcript highlight follows playback).

   Controls fade while playing and reappear on any pointer or key
   activity. Keyboard on the focused player: space/k toggles, ←/→ scrub
   5s, j/l 10s, </> slow down and speed up, m mutes, f fullscreens,
   p picture in picture. */

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
const RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const RATE_KEY = "agora:replay-rate";

type CastableVideo = HTMLVideoElement & {
  /* Safari's AirPlay picker. */
  webkitShowPlaybackTargetPicker?: () => void;
  /* The Remote Playback API (Chrome's Cast). */
  remote?: { watchAvailability: (cb: (available: boolean) => void) => Promise<number>; cancelWatchAvailability: (id?: number) => Promise<void>; prompt: () => Promise<void> };
};

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
    const [rate, setRate] = useState(1);
    const [rateMenu, setRateMenu] = useState(false);
    const [pip, setPip] = useState(false);
    const [canPip, setCanPip] = useState(false);
    const [airplay, setAirplay] = useState(false);
    const [cast, setCast] = useState(false);
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

    /* Speed: remembered on this browser, applied to every replay. */
    const applyRate = useCallback((r: number) => {
      const v = videoRef.current;
      if (v) v.playbackRate = r;
      setRate(r);
      try { localStorage.setItem(RATE_KEY, String(r)); } catch { /* private mode */ }
    }, []);
    const stepRate = useCallback((dir: 1 | -1) => {
      const i = RATES.indexOf(rate);
      applyRate(RATES[Math.max(0, Math.min(RATES.length - 1, (i < 0 ? 2 : i) + dir))]);
      poke();
    }, [rate, applyRate, poke]);
    useEffect(() => {
      let saved = 1;
      try { saved = Number(localStorage.getItem(RATE_KEY)) || 1; } catch { /* private mode */ }
      const v = videoRef.current;
      if (v && RATES.includes(saved)) {
        v.playbackRate = saved;
        v.defaultPlaybackRate = saved;
        queueMicrotask(() => setRate(saved));
      }
    }, [src]);

    /* Picture in picture, AirPlay (Safari) and Cast (the Remote Playback
       API — Chrome): each shows only where the browser offers it. */
    useEffect(() => {
      const v = videoRef.current as CastableVideo | null;
      if (!v) return;
      const onEnterPip = () => setPip(true);
      const onLeavePip = () => setPip(false);
      v.addEventListener("enterpictureinpicture", onEnterPip);
      v.addEventListener("leavepictureinpicture", onLeavePip);
      queueMicrotask(() => setCanPip(typeof document !== "undefined" && !!document.pictureInPictureEnabled && typeof v.requestPictureInPicture === "function"));
      const onTargets = (e: Event) => setAirplay((e as Event & { availability?: string }).availability === "available");
      if ("WebKitPlaybackTargetAvailabilityEvent" in window) v.addEventListener("webkitplaybacktargetavailabilitychanged", onTargets);
      let watch: number | undefined;
      v.remote?.watchAvailability((available) => setCast(available)).then((id) => { watch = id; }).catch(() => {});
      return () => {
        v.removeEventListener("enterpictureinpicture", onEnterPip);
        v.removeEventListener("leavepictureinpicture", onLeavePip);
        v.removeEventListener("webkitplaybacktargetavailabilitychanged", onTargets);
        if (watch !== undefined) v.remote?.cancelWatchAvailability(watch).catch(() => {});
      };
    }, [src]);
    const togglePip = useCallback(() => {
      const v = videoRef.current;
      if (!v) return;
      if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});
      else v.requestPictureInPicture?.().catch(() => {});
      poke();
    }, [poke]);
    const pickAirplay = useCallback(() => { (videoRef.current as CastableVideo | null)?.webkitShowPlaybackTargetPicker?.(); }, []);
    const pickCast = useCallback(() => { (videoRef.current as CastableVideo | null)?.remote?.prompt().catch(() => {}); }, []);

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
          else if (e.key === "j") { seekBy(-10); }
          else if (e.key === "l") { seekBy(10); }
          else if (e.key === "<" || e.key === ",") { stepRate(-1); }
          else if (e.key === ">" || e.key === ".") { stepRate(1); }
          else if (e.key === "m") { setVolume(muted ? (vol || 1) : 0); }
          else if (e.key === "f") { toggleFs(); }
          else if (e.key === "p" && canPip) { togglePip(); }
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
          x-webkit-airplay="allow"
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
            <button onClick={() => seekBy(-10)} aria-label="Back 10 seconds" title="Back 10 seconds (j)" className="rp-btn rp-skip" style={btn}>
              <Icon name="rotate-ccw" size={16} />
            </button>
            <button onClick={toggle} aria-label={playing ? "Pause" : "Play"} className="rp-btn" style={btn}>
              <Icon name={playing ? "pause" : "play"} size={17} style={{ fill: "currentColor" }} />
            </button>
            <button onClick={() => seekBy(10)} aria-label="Forward 10 seconds" title="Forward 10 seconds (l)" className="rp-btn rp-skip" style={btn}>
              <Icon name="rotate-cw" size={16} />
            </button>
            <button onClick={() => setVolume(muted ? (vol || 1) : 0)} aria-label={muted ? "Unmute" : "Mute"} className="rp-btn rp-mute" style={btn}>
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
            <span style={{ position: "relative", display: "inline-flex" }}>
              <button
                onClick={() => { setRateMenu((o) => !o); poke(); }}
                aria-label={`Playback speed, ${rate}×`}
                aria-haspopup="menu"
                aria-expanded={rateMenu}
                title="Playback speed (< >)"
                className="rp-btn"
                style={{ ...btn, fontSize: 12, fontWeight: 700, fontFamily: "'DM Mono', monospace", color: rate === 1 ? "#f0f0f2" : GOLD, minWidth: 34, justifyContent: "center" }}
              >
                {rate}×
              </button>
              {rateMenu && (
                <span role="menu" aria-label="Playback speed" style={{ position: "absolute", right: 0, bottom: "calc(100% + 8px)", display: "flex", flexDirection: "column", padding: 4, borderRadius: 10, background: "#0e0e11", border: "1px solid #2a2a33", boxShadow: "0 10px 28px rgba(0,0,0,0.5)", zIndex: 3 }}>
                  {RATES.map((r) => (
                    <button
                      key={r}
                      role="menuitemradio"
                      aria-checked={r === rate}
                      onClick={() => { applyRate(r); setRateMenu(false); poke(); }}
                      style={{ ...btn, padding: "6px 14px", borderRadius: 7, fontSize: 12.5, fontWeight: r === rate ? 700 : 500, color: r === rate ? GOLD : "#e5e5ec", justifyContent: "flex-end", fontFamily: "'DM Mono', monospace" }}
                    >
                      {r === 1 ? "Normal" : `${r}×`}
                    </button>
                  ))}
                </span>
              )}
            </span>
            {canPip && (
              <button onClick={togglePip} aria-label={pip ? "Exit picture in picture" : "Picture in picture"} title="Picture in picture (p)" className="rp-btn" style={{ ...btn, color: pip ? GOLD : btn.color }}>
                <Icon name="picture-in-picture" size={16} />
              </button>
            )}
            {airplay && (
              <button onClick={pickAirplay} aria-label="AirPlay" title="AirPlay" className="rp-btn" style={btn}>
                <Icon name="airplay" size={16} />
              </button>
            )}
            {cast && (
              <button onClick={pickCast} aria-label="Cast" title="Cast to a device" className="rp-btn" style={btn}>
                <Icon name="cast" size={16} />
              </button>
            )}
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
