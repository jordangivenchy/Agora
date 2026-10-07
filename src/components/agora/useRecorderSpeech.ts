"use client";

/* On the page LiveKit films for a recording, and nowhere else: note who
   is speaking and send it on every few seconds, with the pass the
   recording was started with (lib/recordingSpeechKey). It is what puts
   names on a replay's transcript.

   This runs inside the recorder, so it must never get in its way: no
   state, no re-render, every step guarded, and a report that fails is
   kept for the next one rather than chased. */

import { useEffect, useRef } from "react";
import { SpeechSpans } from "./speechSpans";

const SEND_EVERY_MS = 10_000;
const ENDPOINT = "/api/internal/recording-speech";

export function useRecorderSpeech(opts: {
  roomId: string | undefined;
  /** The recorder's pass (`rk` in its address); null on every other page. */
  pass: string | null;
  connected: boolean;
  speaking: Set<string>;
}): void {
  const { roomId, pass, connected, speaking } = opts;
  const spans = useRef<SpeechSpans | null>(null);

  useEffect(() => {
    if (!pass) return;
    try {
      (spans.current ??= new SpeechSpans()).update(connected ? speaking : [], Date.now());
    } catch {
      /* never the recorder's problem */
    }
  }, [pass, connected, speaking]);

  useEffect(() => {
    if (!pass || !roomId) return;
    const send = (leaving: boolean) => {
      try {
        const tracker = spans.current;
        if (!tracker) return;
        const batch = tracker.take(Date.now());
        if (!batch.length) return;
        const body = JSON.stringify({ roomId, key: pass, spans: batch });
        if (leaving && navigator.sendBeacon) {
          navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "application/json" }));
          return;
        }
        fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true })
          .then((res) => {
            if (res.status >= 500) tracker.restore(batch);
          })
          .catch(() => tracker.restore(batch));
      } catch {
        /* never the recorder's problem */
      }
    };
    const timer = window.setInterval(() => send(false), SEND_EVERY_MS);
    const bye = () => send(true);
    window.addEventListener("pagehide", bye);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("pagehide", bye);
      send(true);
    };
  }, [pass, roomId]);
}
