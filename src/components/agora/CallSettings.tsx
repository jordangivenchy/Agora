"use client";

import { useEffect, useRef, useState } from "react";

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

function useMicLevel(enabled: boolean, getTrack: () => MediaStreamTrack | null) {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const track = getTrack();
    if (!track) return;
    const ctx = new AudioContext();
    const src = ctx.createMediaStreamSource(new MediaStream([track]));
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    src.connect(analyser);
    const buf = new Uint8Array(analyser.fftSize);
    let raf = 0;
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
    return () => {
      cancelAnimationFrame(raf);
      src.disconnect();
      ctx.close();
      setLevel(0);
    };
  }, [enabled, getTrack]);
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

type Section = "video" | "audio" | "display" | "share" | "access";

const SECTIONS: { key: Section; label: string; icon: React.ReactNode }[] = [
  {
    key: "video",
    label: "Video & effects",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m23 7-7 5 7 5V7z" /><rect x="1" y="5" width="15" height="14" rx="2" /></svg>
    ),
  },
  {
    key: "audio",
    label: "Audio",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M3 18v-6a9 9 0 0 1 18 0v6" /><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" /></svg>
    ),
  },
  {
    key: "display",
    label: "Display & controls",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" /></svg>
    ),
  },
  {
    key: "share",
    label: "Share screen",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="2" y="3" width="20" height="14" rx="2" /><path d="m9 10 3-3 3 3M12 7v6" /></svg>
    ),
  },
  {
    key: "access",
    label: "Accessibility",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="12" cy="4.5" r="1.5" /><path d="M4 9h16M12 9v6m0 0-3 6m3-6 3 6" /></svg>
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
  onClose,
}: CallSettingsProps) {
  const [open, setOpen] = useState<Section | null>("video");
  const [testingMic, setTestingMic] = useState(false);
  const [toneProgress, setToneProgress] = useState<number | null>(null);
  const micLevel = useMicLevel(testingMic, getMicStreamTrack);
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
              <span className="ag-tool-soon">Soon</span>
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
                <span aria-hidden>▶</span> Test speaker
              </button>
              <Meter level={toneProgress ?? 0} />
              <div className="ag-set-label">Output volume</div>
              <div className="ag-set-slider">
                <span aria-hidden>🔇</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={outputVolume}
                  onChange={(e) => onOutputVolume(Number(e.target.value))}
                  aria-label="Output volume"
                />
                <span aria-hidden>🔊</span>
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
                onClick={() => setTestingMic((v) => !v)}
                disabled={!testingMic && !getMicStreamTrack()}
                title={!getMicStreamTrack() ? "Unmute to test your microphone" : undefined}
              >
                <span className="ag-set-dot" aria-hidden /> {testingMic ? "Stop test" : "Test microphone"}
              </button>
              <Meter level={testingMic ? micLevel : 0} />
              <div className="ag-set-text">
                Input level follows your system&apos;s microphone volume.
              </div>
            </div>
          </>
        );
      case "display":
        return (
          <div className="ag-set-text">
            Switch between the amphitheater and the speaker vantage with the toggle above the controls.
            Collapse the chat with its corner button to run the stage full width.
          </div>
        );
      case "share":
        return (
          <div className="ag-set-text">
            A shared screen takes the stage for everyone. Viewers can pin any picture by clicking it,
            and click the main picture to let go.
          </div>
        );
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
        {SECTIONS.map((s) => {
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
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>
        Open all settings
      </a>
    </section>
  );
}
