"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import Restream from "./Restream";

export interface CallSettingsProps {
  cameras: MediaDeviceInfo[];
  activeCameraId: string | null;
  onSwitchCamera: (id: string) => void;
  mics: MediaDeviceInfo[];
  activeMicId: string | null;
  onSwitchMic: (id: string) => void;
  speakers: MediaDeviceInfo[];
  activeSpeakerId: string | null;
  onSwitchSpeaker: (id: string) => void;
  outputVolume: number;
  onOutputVolume: (v: number) => void;
  getMicStreamTrack: () => MediaStreamTrack | null;
  /** "Simple stage": no 3D amphitheatre — whether it is on, and whether
      the machine chose it (a browser drawing WebGL in software). */
  simpleStage?: boolean;
  simpleStageForced?: "software" | null;
  onSimpleStage?: (on: boolean) => void;
  /** People without a camera sit small beside the pictures (lib/callView). */
  smallFaces?: boolean;
  onSmallFaces?: (on: boolean) => void;
  /** The cameras stack in a phone-shaped column. Not offered on a phone,
      which is that shape already. */
  camerasTall?: boolean;
  onCamerasTall?: (on: boolean) => void;
  /** The room's host only: the link for sending the room out to TikTok,
      Twitch or YouTube themselves (Restream.tsx). Absent, the section
      isn't there. */
  restreamRoomId?: string | null;
  onClose: () => void;
}

function DeviceSelect({
  devices,
  activeId,
  onPick,
  fallback,
}: {
  devices: MediaDeviceInfo[];
  activeId: string | null;
  onPick: (id: string) => void;
  fallback: string;
}) {
  return (
    <select
      className="ag-set-select"
      value={activeId ?? ""}
      onChange={(e) => e.target.value && onPick(e.target.value)}
    >
      {devices.length === 0 && <option value="">{fallback}</option>}
      {devices.map((d, i) => (
        <option key={d.deviceId || i} value={d.deviceId}>
          {d.label || `Device ${i + 1}`}
        </option>
      ))}
    </select>
  );
}

function Meter({ level }: { level: number }) {
  const lit = Math.round(Math.max(0, Math.min(1, level)) * 9);
  return (
    <div className="ag-set-meter" aria-hidden>
      {Array.from({ length: 9 }, (_, i) => (
        <span key={i} className={`ag-set-meter-cell${i < lit ? " is-lit" : ""}`} />
      ))}
    </div>
  );
}

/* Why a microphone test couldn't start, in words a person can act on. */
function micTestError(e: unknown): string {
  const name = e instanceof Error ? e.name : "";
  if (name === "NotAllowedError") return "Mic access is blocked — allow it from your browser's address bar, then try again.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No microphone found on this device.";
  if (name === "NotReadableError") return "Your microphone is in use by another app — close it and try again.";
  return "Couldn't start the microphone.";
}

/* The microphone's level while a test runs. It listens to a copy of the
   call's own microphone, switched on for itself: once you can speak, the
   mic waits muted (useAgoraCall), so the call's track is silent until you
   unmute — and a test that read it showed nothing at the very moment
   people test. The copy is never sent anywhere; you stay muted in the
   room. With no microphone in the call (in the audience), one is opened
   for the length of the test. */
function useMicLevel(
  enabled: boolean,
  getTrack: () => MediaStreamTrack | null,
  deviceId: string | null,
  onError: (message: string) => void,
) {
  const [level, setLevel] = useState(0);
  const failed = useRef(onError);
  useEffect(() => {
    failed.current = onError;
  });
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let raf = 0;
    let probe: MediaStreamTrack | null = null;
    /* Made here, in the click that started the test: Safari leaves one
       made any later asleep. */
    const ctx = new AudioContext();
    void ctx.resume().catch(() => undefined);
    const listen = (track: MediaStreamTrack) => {
      const src = ctx.createMediaStreamSource(new MediaStream([track]));
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);
      const tick = () => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / buf.length);
        setLevel(Math.min(1, rms * 4));
        raf = requestAnimationFrame(tick);
      };
      tick();
    };
    const live = getTrack();
    if (live && live.readyState === "live") {
      probe = live.clone();
      probe.enabled = true;
      listen(probe);
    } else {
      navigator.mediaDevices
        .getUserMedia({ audio: deviceId ? { deviceId: { exact: deviceId } } : true })
        .then((stream) => {
          const track = stream.getAudioTracks()[0];
          if (cancelled || !track) {
            stream.getTracks().forEach((t) => t.stop());
            return;
          }
          probe = track;
          listen(track);
        })
        .catch((e) => {
          if (!cancelled) failed.current(micTestError(e));
        });
    }
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      probe?.stop();
      void ctx.close().catch(() => undefined);
      setLevel(0);
    };
  }, [enabled, getTrack, deviceId]);
  return level;
}

async function playTestTone(sinkId: string | null, onProgress: (p: number) => void) {
  const ctx = new AudioContext();
  const sinkable = ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> };
  if (sinkId && sinkable.setSinkId) {
    try {
      await sinkable.setSinkId(sinkId);
    } catch {
      /* fall back to the default output */
    }
  }
  try {
    await ctx.resume();
  } catch {
    /* autoplay policy — the sweep still runs so the button releases */
  }
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = 523.25;
  gain.gain.value = 0.0001;
  osc.connect(gain).connect(ctx.destination);
  const t0 = ctx.currentTime;
  gain.gain.exponentialRampToValueAtTime(0.22, t0 + 0.05);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.9);
  osc.start(t0);
  osc.stop(t0 + 0.95);
  const start = performance.now();
  await new Promise<void>((resolve) => {
    const timer = setInterval(() => {
      const p = Math.min(1, (performance.now() - start) / 900);
      onProgress(p);
      if (p >= 1) {
        clearInterval(timer);
        resolve();
      }
    }, 40);
  });
  await ctx.close();
}

type Section = "video" | "audio" | "display" | "share" | "restream" | "access";

const SECTIONS: { key: Section; label: string; icon: React.ReactNode }[] = [
  {
    key: "video",
    label: "Video & effects",
    icon: (
      <Icon name="video" size={18} />
    ),
  },
  {
    key: "audio",
    label: "Audio",
    icon: (
      <Icon name="headphones" size={18} />
    ),
  },
  {
    key: "display",
    label: "Display & controls",
    icon: (
      <Icon name="monitor" size={18} />
    ),
  },
  {
    key: "share",
    label: "Share screen",
    icon: (
      <Icon name="monitor-up" size={18} />
    ),
  },
  {
    key: "restream",
    label: "Restream",
    icon: (
      <Icon name="cast" size={18} />
    ),
  },
  {
    key: "access",
    label: "Accessibility",
    icon: (
      <Icon name="person-standing" size={18} />
    ),
  },
];

function DeviceList({
  devices,
  activeId,
  onPick,
  emptyText,
}: {
  devices: MediaDeviceInfo[];
  activeId: string | null;
  onPick: (id: string) => void;
  emptyText: string;
}) {
  if (devices.length === 0) return <div className="ag-set-empty">{emptyText}</div>;
  return (
    <div className="ag-set-list" role="radiogroup">
      {devices.map((d, i) => {
        const active = d.deviceId === activeId;
        return (
          <button
            key={d.deviceId || i}
            className={`ag-set-device${active ? " is-active" : ""}`}
            role="radio"
            aria-checked={active}
            onClick={() => onPick(d.deviceId)}
          >
            <span className="ag-set-check" aria-hidden>{active ? "✓" : ""}</span>
            <span className="ag-set-device-name">{d.label || `Device ${i + 1}`}</span>
          </button>
        );
      })}
    </div>
  );
}

export default function CallSettings({
  cameras,
  activeCameraId,
  onSwitchCamera,
  mics,
  activeMicId,
  onSwitchMic,
  speakers,
  activeSpeakerId,
  onSwitchSpeaker,
  outputVolume,
  onOutputVolume,
  getMicStreamTrack,
  simpleStage = false,
  simpleStageForced = null,
  onSimpleStage,
  smallFaces = true,
  onSmallFaces,
  camerasTall = false,
  onCamerasTall,
  restreamRoomId = null,
  onClose,
}: CallSettingsProps) {
  const [open, setOpen] = useState<Section | null>("video");
  const [testingMic, setTestingMic] = useState(false);
  const [micTestFailed, setMicTestFailed] = useState<string | null>(null);
  const [toneProgress, setToneProgress] = useState<number | null>(null);
  const micLevel = useMicLevel(testingMic, getMicStreamTrack, activeMicId, (message) => {
    setTestingMic(false);
    setMicTestFailed(message);
  });
  const toneBusy = useRef(false);

  const body = (key: Section) => {
    switch (key) {
      case "video":
        return (
          <>
            <div className="ag-set-label">Camera</div>
            <DeviceList
              devices={cameras}
              activeId={activeCameraId}
              onPick={onSwitchCamera}
              emptyText="Turn your video on once so the browser can name your cameras."
            />
            <div className="ag-set-row ag-set-row--off">
              <span>Blur my background</span>
              <span className="ag-cam-soon">Soon</span>
            </div>
          </>
        );
      case "audio":
        return (
          <>
            <div className="ag-set-group">
              <div className="ag-set-label">Speaker</div>
              <DeviceSelect
                devices={speakers}
                activeId={activeSpeakerId}
                onPick={onSwitchSpeaker}
                fallback="Same as system"
              />
              <button
                className="ag-set-testbtn"
                disabled={toneProgress !== null}
                onClick={async () => {
                  if (toneBusy.current) return;
                  toneBusy.current = true;
                  setToneProgress(0);
                  await playTestTone(activeSpeakerId, setToneProgress);
                  setToneProgress(null);
                  toneBusy.current = false;
                }}
              >
                <Icon name="play" size={11} /> Test speaker
              </button>
              <Meter level={toneProgress ?? 0} />
              <div className="ag-set-label">Output volume</div>
              <div className="ag-set-slider">
                <Icon name="volume-x" size={14} />
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={outputVolume}
                  onChange={(e) => onOutputVolume(Number(e.target.value))}
                  aria-label="Output volume"
                />
                <Icon name="volume-2" size={14} />
              </div>
            </div>

            <div className="ag-set-group">
              <div className="ag-set-label">Microphone</div>
              <DeviceSelect
                devices={mics}
                activeId={activeMicId}
                onPick={onSwitchMic}
                fallback="Unmute once to name your microphones"
              />
              <button
                className={`ag-set-testbtn${testingMic ? " is-on" : ""}`}
                onClick={() => {
                  setMicTestFailed(null);
                  setTestingMic((v) => !v);
                }}
              >
                <span className="ag-set-dot" aria-hidden /> {testingMic ? "Stop test" : "Test microphone"}
              </button>
              <Meter level={testingMic ? micLevel : 0} />
              {micTestFailed && (
                <div className="ag-set-text" role="alert">
                  {micTestFailed}
                </div>
              )}
              <div className="ag-set-text">
                Only you see the test: nobody in the room hears it, and it doesn&apos;t unmute you. Input
                level follows your system&apos;s microphone volume.
              </div>
            </div>
          </>
        );
      case "display":
        return (
          <>
            <label className="ag-set-row ag-set-row--switch">
              <span>
                Simple stage
                <small>No 3D amphitheatre — much lighter on a slower computer.</small>
              </span>
              <input
                type="checkbox"
                role="switch"
                checked={simpleStage}
                onChange={(e) => onSimpleStage?.(e.target.checked)}
              />
            </label>
            {simpleStageForced === "software" && (
              <div className="ag-set-text">
                This browser is drawing without a graphics card, so the 3D stage is off here unless you
                turn it on — it will be slow.
              </div>
            )}
            {onSmallFaces && (
              <label className="ag-set-row ag-set-row--switch">
                <span>
                  Small faces without a camera
                  <small>
                    When someone has a camera or screen on, people without one sit small beside it. Click a
                    face to give it a window.
                  </small>
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  checked={smallFaces}
                  onChange={(e) => onSmallFaces(e.target.checked)}
                />
              </label>
            )}
            {onCamerasTall && (
              <label className="ag-set-row ag-set-row--switch">
                <span>
                  Tall cameras
                  <small>Stack the cameras in a phone-shaped column, the way a vertical stream shows them.</small>
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  checked={camerasTall}
                  onChange={(e) => onCamerasTall(e.target.checked)}
                />
              </label>
            )}
            <div className="ag-set-text">
              Switch between the amphitheater and the speaker vantage with the toggle above the controls.
              Collapse the chat with its corner button to run the stage full width.
            </div>
          </>
        );
      case "share":
        return (
          <div className="ag-set-text">
            A shared screen takes the stage for everyone. Viewers can pin any picture by clicking it,
            and click the main picture to let go.
          </div>
        );
      case "restream":
        return restreamRoomId ? <Restream roomId={restreamRoomId} /> : null;
      case "access":
        return (
          <div className="ag-set-text">
            Reduced motion follows your system preference — camera glides, twinkle and flicker
            go still. Keyboard: every control is reachable with Tab; Escape closes any panel.
          </div>
        );
    }
  };

  return (
    <section className="ag-card ag-chat-card ag-settings-card" aria-label="Call settings">
      <div className="ag-set-head">
        <span className="ag-set-title">Settings</span>
        <button className="ag-set-close" onClick={onClose} aria-label="Close settings">
          ×
        </button>
      </div>

      <div className="ag-set-sections">
        {SECTIONS.filter((s) => s.key !== "restream" || !!restreamRoomId).map((s) => {
          const isOpen = open === s.key;
          return (
            <div key={s.key} className={`ag-set-section${isOpen ? " is-open" : ""}`}>
              <button
                className="ag-set-rowbtn"
                onClick={() => setOpen(isOpen ? null : s.key)}
                aria-expanded={isOpen}
              >
                <span className="ag-set-ico">{s.icon}</span>
                <span className="ag-set-rowlabel">{s.label}</span>
                <span className="ag-set-chev" aria-hidden>›</span>
              </button>
              {isOpen && <div className="ag-set-body">{body(s.key)}</div>}
            </div>
          );
        })}
      </div>

      <a className="ag-set-all" href="/settings" target="_blank" rel="noopener noreferrer">
        <Icon name="settings" size={14} />
        Open all settings
      </a>
    </section>
  );
}
