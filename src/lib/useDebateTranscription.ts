"use client";

/* Continuous transcription of the local speaker's mic while they debate on
   stage. One SpeechRecognition session serves two jobs (Chrome only allows
   one live session per page):
     - every final result is buffered and batched to /api/agora/transcript
       (Agora's listening/fact-check/persona pipeline)
     - results containing the "Hey Agora" hotword are routed to onHotword
       instead, so the assistant answers directly and the wake phrase never
       pollutes the transcript

   Batches flush every FLUSH_MS or BATCH_MAX utterances, and on stop. The
   recognizer auto-restarts (browsers kill continuous sessions periodically)
   with the same rapid-death throttle the hotword loop uses, so a denied mic
   can't spin the tab. */

import { useEffect, useRef, useState } from "react";
import { isAppleMobile } from "@/lib/platform";
import { extractWake } from "@/lib/wakeWord";

const FLUSH_MS = 8000;
const BATCH_MAX = 4;

type SRInstance = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal?: boolean }>; resultIndex: number }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  start: () => void;
  stop: () => void;
};
type SRCtor = { new (): SRInstance };

function getRecognition(): SRCtor | null {
  const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface TranscriptionState {
  /** True while the recognizer is actually running. */
  listening: boolean;
  /** Browser has no SpeechRecognition, or mic permission was denied. */
  unavailable: boolean;
}

export function useDebateTranscription(params: {
  roomId: string | undefined;
  /** Master switch: on-stage, live room, unmuted, not user-disabled. */
  enabled: boolean;
  /** Called with the question text when the speaker says "Hey Agora …". */
  onHotword: (question: string) => void;
}): TranscriptionState {
  const { roomId, enabled, onHotword } = params;
  const [listening, setListening] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  const onHotwordRef = useRef(onHotword);
  useEffect(() => { onHotwordRef.current = onHotword; }, [onHotword]);

  useEffect(() => {
    if (!enabled || !roomId) return;
    /* iOS Safari hands the microphone to one thing at a time: starting
       SpeechRecognition there re-prompts for mic access on every
       (auto-restarted) session and interrupts the call's own capture —
       the person on stage goes silent to the room. Off on iPhone/iPad. */
    if (isAppleMobile()) {
      const t = setTimeout(() => setUnavailable(true), 0);
      return () => clearTimeout(t);
    }
    const Ctor = getRecognition();
    if (!Ctor) {
      // Deferred so the effect never sets state synchronously during render
      // commit (react-hooks/set-state-in-effect).
      const t = setTimeout(() => setUnavailable(true), 0);
      return () => clearTimeout(t);
    }

    let alive = true;
    let buffer: { text: string; at: number }[] = [];

    const flush = (useBeacon = false) => {
      if (buffer.length === 0) return;
      const batch = buffer;
      buffer = [];
      const payload = JSON.stringify({ roomId, utterances: batch });
      if (useBeacon && navigator.sendBeacon) {
        // Page is going away — beacon survives unload; auth rides on cookies.
        navigator.sendBeacon("/api/agora/transcript", new Blob([payload], { type: "application/json" }));
        return;
      }
      fetch("/api/agora/transcript", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        keepalive: true,
      }).catch(() => {
        // Transcript loss is acceptable; never disturb the debater.
      });
    };

    const rec = new Ctor();
    rec.lang = "en-US";
    rec.continuous = true;
    rec.interimResults = false;

    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        if (result.isFinal === false) continue;
        const text = result[0]?.transcript?.trim();
        if (!text) continue;

        const wake = extractWake(text);
        if (wake) {
          if (wake.kind === "question") onHotwordRef.current(wake.question);
          continue; // wake-phrase speech never enters the transcript
        }
        buffer.push({ text, at: Date.now() });
        if (buffer.length >= BATCH_MAX) flush();
      }
    };

    // Continuous sessions die periodically — restart, but bail if the mic is
    // gone (three sub-second lifetimes in a row).
    let lastStart = Date.now();
    let rapidDeaths = 0;
    let denied = false;
    rec.onend = () => {
      if (!alive || denied) return;
      rapidDeaths = Date.now() - lastStart < 1000 ? rapidDeaths + 1 : 0;
      if (rapidDeaths >= 3) {
        setUnavailable(true);
        setListening(false);
        return;
      }
      setTimeout(() => {
        if (!alive || denied) return;
        lastStart = Date.now();
        try { rec.start(); } catch { /* already restarting */ }
      }, 400);
    };
    rec.onerror = (e) => {
      if (e?.error === "not-allowed" || e?.error === "service-not-allowed") {
        denied = true;
        setUnavailable(true);
        setListening(false);
      }
    };

    const onUnload = () => flush(true);
    window.addEventListener("pagehide", onUnload);
    const flushTimer = setInterval(() => flush(), FLUSH_MS);
    // Deferred start keeps setState out of the synchronous effect body.
    const startTimer = setTimeout(() => {
      lastStart = Date.now();
      try {
        rec.start();
        setListening(true);
        setUnavailable(false);
      } catch {
        setUnavailable(true);
      }
    }, 0);

    return () => {
      alive = false;
      clearTimeout(startTimer);
      clearInterval(flushTimer);
      window.removeEventListener("pagehide", onUnload);
      try { rec.stop(); } catch { /* already stopped */ }
      flush(true);
      setListening(false);
    };
  }, [enabled, roomId]);

  return { listening, unavailable };
}
