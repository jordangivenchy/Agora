"use client";

/* Agora — the in-room AI assistant. A floating orb (bottom-left of the
   stage) that breathes, Shazam-style, while Agora is live-listening with
   permission to jump in. Opens a compact panel with exactly three controls:
   a text bar, a "hey agora" toggle (live interference on/off), and a
   speaker toggle (voice on/off).

   On a live stage, Agora always listens in the background — transcribing
   the debater's own mic for fact-checking and argumentation-persona
   analysis (see /api/agora/transcript). The "hey agora" toggle decides
   whether it may INTERFERE: answer wake-phrase questions and speak up with
   corrections. Listening itself keeps running either way; the pulsing orb
   is the on-screen tell.

   Voice replies use Kokoro (open-source neural TTS, in-browser) with the
   OS voice as fallback — see lib/voice/tts. */

import { useCallback, useEffect, useRef, useState } from "react";
import { isAppleMobile } from "@/lib/platform";
import { Icon } from "@/components/icons";
import { createClient } from "@/lib/supabase-browser";
import { useDebateTranscription } from "@/lib/useDebateTranscription";
import { extractWake } from "@/lib/wakeWord";
import { speak as speakVoice, stopSpeaking, subscribeSpeaking, warmVoice } from "@/lib/voice/tts";
import MicPrompt from "@/components/mic/MicPrompt";

interface Props {
  motion?: string;
  /* Room context forwarded to the backend so it can persist history per room
     and bias evidence retrieval toward the room's topic. */
  roomId?: string;
  topicKey?: string;
  /* True while the current user is a debater in a live room. Turns on
     background listening (transcription → fact-checks + persona profile);
     the orb pulses whenever Agora is also allowed to interfere. */
  liveListening?: boolean;
  /* Live Moderator (room-level): Agora proactively drops facts and moderates
     without being tapped. State is shared by the whole room; only the host
     can flip it. */
  moderatorOn?: boolean;
  canModerate?: boolean;
  onToggleModerator?: (on: boolean) => void;
}

type SRInstance = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal?: boolean }> ; resultIndex: number }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
};
type SRCtor = { new (): SRInstance };

function getRecognition(): SRCtor | null {
  const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const INTERFERE_KEY = "agora-interfere";

export default function AgoraAssistant({
  motion,
  roomId,
  topicKey,
  liveListening,
  moderatorOn,
  canModerate,
  onToggleModerator,
}: Props) {
  const [openPanel, setOpenPanel] = useState(false);
  const [log, setLog] = useState<{ from: "you" | "agora"; text: string }[]>([]);
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);
  const [voiceOut, setVoiceOut] = useState(true);
  /* May Agora butt in? Wake-phrase answers + spoken corrections. Persisted
     so a debater's choice survives reloads; listening itself is not gated. */
  const [interfere, setInterfere] = useState(true);
  const [hotword, setHotword] = useState(false); // classic loop, off-stage only
  const hotwordRef = useRef(false);
  const hotwordRec = useRef<SRInstance | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Deferred so the stored preference applies without a synchronous
    // setState inside the effect body (react-hooks/set-state-in-effect).
    const t = setTimeout(() => {
      try {
        if (localStorage.getItem(INTERFERE_KEY) === "0") setInterfere(false);
      } catch { /* storage unavailable */ }
    }, 0);
    return () => clearTimeout(t);
  }, []);
  const toggleInterfere = useCallback(() => {
    setInterfere((v) => {
      const next = !v;
      try { localStorage.setItem(INTERFERE_KEY, next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  }, []);

  /* Warm the neural voice once Agora could plausibly speak: on stage, or
     the moment the panel opens. The model is ~80MB, cached after the first
     download; until it's ready the OS voice covers. */
  useEffect(() => {
    if (liveListening || openPanel) warmVoice();
  }, [liveListening, openPanel]);

  /* Audible-playback state from the voice engine — drives the orb's
     strongest animation while Agora is actually talking. */
  const [speaking, setSpeaking] = useState(false);
  useEffect(() => subscribeSpeaking(setSpeaking), []);

  const speak = useCallback((text: string) => {
    void speakVoice(text);
  }, []);

  const ask = useCallback(
    async (q: string) => {
      const question = q.trim();
      if (!question) return;
      setDraft("");
      setOpenPanel(true);
      setLog((l) => [...l, { from: "you", text: question }]);
      setThinking(true);
      try {
        const res = await fetch("/api/agora", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question, motion, roomId, topicKey }),
        });
        const data = await res.json();
        const answer: string = data.answer ?? "Something went wrong — try again.";
        setLog((l) => [...l, { from: "agora", text: answer }]);
        if (voiceOut && res.ok) speak(answer);
      } catch {
        setLog((l) => [...l, { from: "agora", text: "I couldn't reach my knowledge engine — check your connection and try again." }]);
      } finally {
        setThinking(false);
      }
    },
    [motion, roomId, topicKey, voiceOut, speak]
  );
  const askRef = useRef(ask);
  useEffect(() => { askRef.current = ask; }, [ask]);
  const interfereRef = useRef(interfere);
  useEffect(() => { interfereRef.current = interfere; }, [interfere]);
  const voiceOutRef = useRef(voiceOut);
  useEffect(() => { voiceOutRef.current = voiceOut; }, [voiceOut]);

  /* ── Background listening: one recognizer transcribes the debater AND
     carries "Hey Agora" (browsers allow a single live session). Always on
     while on a live stage — the wake phrase only gets ANSWERED when
     interference is on. ── */
  const stageListen = useDebateTranscription({
    roomId,
    enabled: !!liveListening,
    onHotword: (q) => { if (interfereRef.current) askRef.current(q); },
  });

  /* ── Agora jumping in: corrections arrive over realtime. They always land
     in the log; with interference on they open the panel and speak. ── */
  useEffect(() => {
    if (!roomId) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`agora-interjections-${roomId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "agora_interjections", filter: `room_id=eq.${roomId}` },
        (payload) => {
          const row = payload.new as { explanation?: string; kind?: string };
          if (!row?.explanation) return;
          const prefix =
            row.kind === "context" ? "💡 " : row.kind === "insight" ? "🎙️ Moderator: " : "⚡ Fact check: ";
          setLog((l) => [...l, { from: "agora", text: `${prefix}${row.explanation}` }]);
          if (interfereRef.current) {
            setOpenPanel(true);
            if (voiceOutRef.current) speak(row.explanation);
          }
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [roomId, speak]);

  /* Classic hands-free loop for people NOT on stage (spectators, hosts off
     mic): the "hey agora" button starts it — needs the explicit click for
     the browser's mic permission anyway. */
  const toggleHotword = useCallback(() => {
    if (isAppleMobile()) {
      setLog((l) => [...l, { from: "agora", text: "Hands-free listening is off on iPhone and iPad — Safari gives the microphone to one thing at a time, and the call keeps it. Type your question instead." }]);
      return;
    }
    const Ctor = getRecognition();
    if (!Ctor) {
      setLog((l) => [...l, { from: "agora", text: "Hands-free listening isn't supported in this browser — type your question instead." }]);
      return;
    }
    if (hotwordRef.current) {
      hotwordRef.current = false;
      setHotword(false);
      hotwordRec.current?.stop();
      hotwordRec.current = null;
      return;
    }
    hotwordRef.current = true;
    setHotword(true);
    const rec = new Ctor();
    hotwordRec.current = rec;
    rec.lang = "en-US";
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const transcript = e.results[i][0].transcript;
        const wake = extractWake(transcript);
        if (wake) {
          if (wake.kind === "question") askRef.current(wake.question);
          else setOpenPanel(true);
        }
      }
    };
    // Browsers stop continuous sessions periodically — restart while enabled.
    // Throttled: an instantly-dying session (mic permission denied, no mic)
    // would otherwise restart in a tight loop and freeze the tab.
    let lastStart = Date.now();
    let rapidDeaths = 0;
    let denied = false;
    rec.onend = () => {
      if (!hotwordRef.current || hotwordRec.current !== rec || denied) return;
      const lifetime = Date.now() - lastStart;
      rapidDeaths = lifetime < 1000 ? rapidDeaths + 1 : 0;
      if (rapidDeaths >= 3) {
        hotwordRef.current = false;
        hotwordRec.current = null;
        setHotword(false);
        setLog((l) => [...l, { from: "agora", text: "I can't keep the microphone open — check that mic access is allowed for this site (the icon in the address bar), then try again." }]);
        return;
      }
      setTimeout(() => {
        if (hotwordRef.current && hotwordRec.current === rec) {
          lastStart = Date.now();
          try { rec.start(); } catch { /* already restarting */ }
        }
      }, 500);
    };
    rec.onerror = ((e: { error?: string }) => {
      if (e?.error === "not-allowed" || e?.error === "service-not-allowed") {
        denied = true;
        hotwordRef.current = false;
        hotwordRec.current = null;
        setHotword(false);
        setLog((l) => [...l, { from: "agora", text: "Microphone access was denied — allow it from the icon in the address bar to use hands-free listening." }]);
      }
    }) as () => void;
    lastStart = Date.now();
    rec.start();
  }, []);

  useEffect(() => () => {
    hotwordRef.current = false;
    hotwordRec.current?.stop();
    stopSpeaking();
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [log, thinking]);

  /* The "hey agora" control means the same thing everywhere — "may Agora
     interfere?" — but off stage it also has to run its own ears. */
  const interferenceActive = liveListening ? interfere : hotword;
  const onInterferenceToggle = liveListening ? toggleInterfere : toggleHotword;
  /* Shazam moment: the orb's animation tracks what Agora is doing right
     now, strongest first — talking > thinking > hearing the stage. */
  const orbLive = stageListen.listening && interfere;
  const orbClass = speaking
    ? "agora-orb-speaking"
    : thinking
      ? "agora-orb-thinking"
      : orbLive
        ? "agora-orb-live"
        : "";

  return (
    <>
      <button
        onClick={() => setOpenPanel((v) => !v)}
        title={
          orbLive
            ? "Agora is listening — say “Agora, …” or “Hey, Agora …”, or just keep talking; it fact-checks live"
            : stageListen.listening
              ? "Agora is listening in the background (interference off)"
              : 'Ask Agora — or say "Hey, Agora"'
        }
        className={`ag-assist-orb fixed cursor-pointer flex items-center justify-center border-none ${orbClass}`}
        style={{
          left: 18,
          bottom: 84,
          width: 46,
          height: 46,
          borderRadius: "50%",
          background: "linear-gradient(135deg,#60a5fa,#2563eb)",
          color: "#eff6ff",
          fontFamily: "'Space Grotesk', sans-serif",
          fontWeight: 800,
          fontSize: 18,
          zIndex: 60,
          boxShadow: orbLive || hotword ? "0 0 26px rgba(96,165,250,0.85)" : "0 0 22px rgba(37,99,235,0.5)",
        }}
      >
        A
      </button>

      {openPanel && (
        <div
          className="ag-assist-panel fixed flex flex-col"
          style={{
            left: 18,
            bottom: 140,
            width: 330,
            maxHeight: 460,
            zIndex: 60,
            background: "rgba(12,14,20,0.96)",
            border: "1px solid rgba(96,165,250,0.35)",
            borderRadius: 14,
            padding: 14,
            backdropFilter: "blur(12px)",
            fontFamily: "'DM Sans', sans-serif",
          }}
        >
          <div className="flex items-center gap-2 mb-2">
            <span
              className="flex items-center justify-center"
              style={{ width: 26, height: 26, borderRadius: "50%", background: "linear-gradient(135deg,#60a5fa,#2563eb)", color: "#eff6ff", fontSize: 12, fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700 }}
            >
              A
            </span>
            <div>
              <p className="m-0 text-[12px]" style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, color: "#f5f5f0" }}>Agora</p>
              <p className="m-0 text-[9px]" style={{ color: stageListen.listening ? "#9cc4f0" : "#8b8b94" }}>
                {stageListen.listening
                  ? interfere
                    ? "listening — live fact-checks on"
                    : "listening quietly — interference off"
                  : "neutral fact-checks with sources — both sides see my answers"}
              </p>
            </div>
            <button
              onClick={() => setOpenPanel(false)}
              className="ml-auto cursor-pointer bg-transparent border-none text-[13px]"
              style={{ color: "#8b8b94" }}
            >
              <Icon name="x" size={14} />
            </button>
          </div>

          {/* Live Moderator: room-level switch — Agora joins the conversation
              on its own (facts + moderation) when on. Host flips it; everyone
              sees it. */}
          {roomId && (
            <div
              className="flex items-center justify-between mb-2 px-3 py-1.5 rounded-xl"
              style={{ background: "rgba(20,20,26,0.7)", border: "0.5px solid #34343c" }}
            >
              <div>
                <p className="m-0 text-[10.5px]" style={{ color: "#e5e5ec", fontWeight: 600 }}>
                  Live moderator
                </p>
                <p className="m-0 text-[9px]" style={{ color: "#8b8b94" }}>
                  {moderatorOn
                    ? "Agora joins in: facts, context, and moderation"
                    : canModerate
                      ? "Let Agora join in without being tapped"
                      : "Only the host can turn this on"}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={!!moderatorOn}
                disabled={!canModerate}
                onClick={() => onToggleModerator?.(!moderatorOn)}
                title={
                  canModerate
                    ? moderatorOn
                      ? "Turn the live moderator off for this room"
                      : "Turn the live moderator on for this room"
                    : "Only the room host can change this"
                }
                className="shrink-0 border-none"
                style={{
                  width: 34,
                  height: 19,
                  borderRadius: 999,
                  position: "relative",
                  cursor: canModerate ? "pointer" : "not-allowed",
                  background: moderatorOn ? "linear-gradient(135deg,#60a5fa,#2563eb)" : "rgba(90,90,102,0.5)",
                  transition: "background 0.2s",
                  opacity: canModerate ? 1 : 0.6,
                }}
              >
                <span
                  style={{
                    position: "absolute",
                    top: 2,
                    left: moderatorOn ? 17 : 2,
                    width: 15,
                    height: 15,
                    borderRadius: "50%",
                    background: "#eff6ff",
                    transition: "left 0.2s",
                  }}
                />
              </button>
            </div>
          )}

          <div ref={logRef} className="flex-1 overflow-y-auto flex flex-col gap-2 mb-2" style={{ minHeight: 60 }}>
            {/* Mic pre-prompt / recovery, right where hands-free matters. */}
            {(liveListening || hotword || stageListen.unavailable) && (
              <MicPrompt placement="inline" reason="For hands-free “Hey Agora” and live fact-checks." />
            )}
            {log.length === 0 && (
              <p className="text-[11px] m-0" style={{ color: "#8b8b94", lineHeight: 1.5 }}>
                Ask for a fact-check, a statistic, or background on the motion — or just say{" "}
                <span style={{ color: "#9cc4f0" }}>&ldquo;Agora, …&rdquo;</span> or{" "}
                <span style={{ color: "#9cc4f0" }}>&ldquo;Hey, Agora…&rdquo;</span>
                {liveListening
                  ? " while you talk. I'm listening and will speak up if a claim needs correcting."
                  : "."}
              </p>
            )}
            {log.map((m, i) => (
              <div key={i} className="flex" style={{ justifyContent: m.from === "you" ? "flex-end" : "flex-start" }}>
                <p
                  className="m-0 text-[11px] px-3 py-1.5 rounded-xl"
                  style={
                    m.from === "you"
                      ? { background: "rgba(24,48,82,0.9)", border: "0.5px solid #2c5382", color: "#dbeafe", maxWidth: "85%" }
                      : { background: "rgba(20,20,26,0.9)", border: "0.5px solid #34343c", color: "#e5e5ec", maxWidth: "85%", lineHeight: 1.5 }
                  }
                >
                  {m.text}
                </p>
              </div>
            ))}
            {thinking && (
              <p className="m-0 text-[11px] px-3 py-1.5" style={{ color: "#8b8b94" }}>
                Agora is checking<span className="animate-pulse">…</span>
              </p>
            )}
          </div>

          {/* Exactly three controls: text bar, "hey agora", speaker. */}
          <form className="flex gap-2 items-center" onSubmit={(e) => { e.preventDefault(); ask(draft); }}>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Ask Agora…"
              className="flex-1 text-[11px] px-3 py-1.5 rounded-full outline-none"
              style={{ background: "rgba(20,20,26,0.85)", border: "0.5px solid #34343c", color: "#e5e5ec", minWidth: 0 }}
            />
            <button
              type="button"
              onClick={onInterferenceToggle}
              className="flex items-center justify-center shrink-0 cursor-pointer text-[9px] px-2 rounded-full"
              title={
                liveListening
                  ? interferenceActive
                    ? "Agora may jump in: wake-phrase answers and spoken corrections. Click to silence it (listening continues in the background)."
                    : "Agora is muted in the discussion — it still listens and takes style notes. Click to let it jump in again."
                  : interferenceActive
                    ? "Hands-free is on — say “Hey, Agora …” anytime. Click to stop."
                    : 'Hands-free: listen for "Hey, Agora"'
              }
              style={{
                height: 28,
                background: interferenceActive ? "rgba(37,99,235,0.25)" : "rgba(20,20,26,0.85)",
                border: interferenceActive ? "0.5px solid #60a5fa" : "0.5px solid #34343c",
                color: interferenceActive ? "#9cc4f0" : "#8b8b94",
                whiteSpace: "nowrap",
              }}
            >
              {interferenceActive ? "● hey agora" : "hey agora"}
            </button>
            <button
              type="button"
              onClick={() => {
                setVoiceOut((v) => {
                  if (v) stopSpeaking();
                  return !v;
                });
              }}
              className="flex items-center justify-center shrink-0 cursor-pointer"
              title={voiceOut ? "Agora speaks its answers — click to mute the voice" : "Agora is text-only — click for voice"}
              style={{
                width: 28, height: 28, borderRadius: "50%",
                background: "rgba(20,20,26,0.85)",
                border: voiceOut ? "0.5px solid #60a5fa" : "0.5px solid #34343c",
                color: voiceOut ? "#9cc4f0" : "#5a5a66", fontSize: 12,
              }}
            >
              {voiceOut ? <Icon name="volume-2" size={14} /> : <Icon name="volume-x" size={14} />}
            </button>
          </form>
        </div>
      )}
    </>
  );
}
