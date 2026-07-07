"use client";

/* Agora — the in-room AI assistant. A floating blue orb (bottom-left of
   the stage) that opens a compact panel. Questions go to /api/agora
   (Claude-powered, answers with sources); replies come back written and
   spoken. Voice input: mic dictation, or hands-free "Hey, Agora" hotword
   listening. */

import { useCallback, useEffect, useRef, useState } from "react";

interface Props {
  motion?: string;
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

export default function AgoraAssistant({ motion }: Props) {
  const [openPanel, setOpenPanel] = useState(false);
  const [log, setLog] = useState<{ from: "you" | "agora"; text: string }[]>([]);
  const [draft, setDraft] = useState("");
  const [listening, setListening] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [voiceOut, setVoiceOut] = useState(true);
  const [hotword, setHotword] = useState(false);
  const hotwordRef = useRef(false);
  const hotwordRec = useRef<SRInstance | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const speak = useCallback((text: string) => {
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.05;
      window.speechSynthesis.speak(utterance);
    } catch {
      /* speech synthesis unavailable */
    }
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
          body: JSON.stringify({ question, motion }),
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
    [motion, voiceOut, speak]
  );
  const askRef = useRef(ask);
  useEffect(() => { askRef.current = ask; }, [ask]);

  /* One-shot dictation into the input */
  const dictate = useCallback(() => {
    const Ctor = getRecognition();
    if (!Ctor) {
      setLog((l) => [...l, { from: "agora", text: "Voice input isn't supported in this browser — type your question instead." }]);
      return;
    }
    const rec = new Ctor();
    rec.lang = "en-US";
    rec.continuous = false;
    rec.interimResults = false;
    rec.onresult = (e) => setDraft(e.results[0][0].transcript);
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    setListening(true);
    rec.start();
  }, []);

  /* Hands-free "Hey, Agora" hotword loop */
  const toggleHotword = useCallback(() => {
    const Ctor = getRecognition();
    if (!Ctor) {
      setLog((l) => [...l, { from: "agora", text: "Hands-free listening isn't supported in this browser — use the mic button or type instead." }]);
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
        const match = transcript.match(/hey,?\s*agora[,.!?]?\s*(.*)/i);
        if (match) {
          const q = match[1]?.trim();
          if (q) askRef.current(q);
          else setOpenPanel(true);
        }
      }
    };
    rec.onend = () => {
      // Auto-restart while enabled (browsers stop continuous sessions periodically)
      if (hotwordRef.current && hotwordRec.current === rec) {
        try { rec.start(); } catch { /* already restarting */ }
      }
    };
    rec.onerror = () => { /* onend handles restart */ };
    rec.start();
  }, []);

  useEffect(() => () => {
    hotwordRef.current = false;
    hotwordRec.current?.stop();
    window.speechSynthesis?.cancel();
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [log, thinking]);

  return (
    <>
      <button
        onClick={() => setOpenPanel((v) => !v)}
        title='Ask Agora — or say "Hey, Agora"'
        className="fixed cursor-pointer flex items-center justify-center border-none"
        style={{
          left: 18,
          bottom: 84,
          width: 46,
          height: 46,
          borderRadius: "50%",
          background: "linear-gradient(135deg,#60a5fa,#2563eb)",
          color: "#eff6ff",
          fontFamily: "'Syne', sans-serif",
          fontWeight: 800,
          fontSize: 18,
          zIndex: 60,
          boxShadow: hotword ? "0 0 26px rgba(96,165,250,0.85)" : "0 0 22px rgba(37,99,235,0.5)",
        }}
      >
        A
      </button>

      {openPanel && (
        <div
          className="fixed flex flex-col"
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
              style={{ width: 26, height: 26, borderRadius: "50%", background: "linear-gradient(135deg,#60a5fa,#2563eb)", color: "#eff6ff", fontSize: 12, fontFamily: "'Syne', sans-serif", fontWeight: 700 }}
            >
              A
            </span>
            <div>
              <p className="m-0 text-[12px]" style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, color: "#f5f5f0" }}>Agora</p>
              <p className="m-0 text-[9px]" style={{ color: "#8b8b94" }}>
                neutral fact-checks with sources — both sides see my answers
              </p>
            </div>
            <button
              onClick={() => setVoiceOut((v) => !v)}
              title={voiceOut ? "Spoken answers on" : "Spoken answers off"}
              className="ml-auto cursor-pointer bg-transparent border-none text-[13px]"
              style={{ color: voiceOut ? "#9cc4f0" : "#5a5a66" }}
            >
              {voiceOut ? "🔊" : "🔇"}
            </button>
            <button
              onClick={() => setOpenPanel(false)}
              className="cursor-pointer bg-transparent border-none text-[13px]"
              style={{ color: "#8b8b94" }}
            >
              ✕
            </button>
          </div>

          <div ref={logRef} className="flex-1 overflow-y-auto flex flex-col gap-2 mb-2" style={{ minHeight: 60 }}>
            {log.length === 0 && (
              <p className="text-[11px] m-0" style={{ color: "#8b8b94", lineHeight: 1.5 }}>
                Ask for a fact-check, a statistic, or background on the motion. Turn on{" "}
                <button onClick={toggleHotword} className="cursor-pointer bg-transparent border-none p-0 text-[11px]" style={{ color: "#9cc4f0", textDecoration: "underline" }}>
                  hands-free listening
                </button>{" "}
                and just say <span style={{ color: "#9cc4f0" }}>"Hey, Agora…"</span>
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

          <form className="flex gap-2 items-center" onSubmit={(e) => { e.preventDefault(); ask(draft); }}>
            <button
              type="button"
              onClick={dictate}
              className="flex items-center justify-center shrink-0 cursor-pointer"
              title={listening ? "Listening…" : "Dictate a question"}
              style={{
                width: 28, height: 28, borderRadius: "50%",
                background: listening ? "rgba(240,96,94,0.2)" : "rgba(20,20,26,0.85)",
                border: listening ? "0.5px solid #f0605e" : "0.5px solid #34343c",
                color: listening ? "#f0605e" : "#8b8b94", fontSize: 12,
              }}
            >
              🎙
            </button>
            <button
              type="button"
              onClick={toggleHotword}
              className="flex items-center justify-center shrink-0 cursor-pointer text-[9px] px-2 rounded-full"
              title='Hands-free: listen for "Hey, Agora"'
              style={{
                height: 28,
                background: hotword ? "rgba(37,99,235,0.25)" : "rgba(20,20,26,0.85)",
                border: hotword ? "0.5px solid #60a5fa" : "0.5px solid #34343c",
                color: hotword ? "#9cc4f0" : "#8b8b94",
                whiteSpace: "nowrap",
              }}
            >
              {hotword ? "● listening" : "hey, agora"}
            </button>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Ask Agora…"
              className="flex-1 text-[11px] px-3 py-1.5 rounded-full outline-none"
              style={{ background: "rgba(20,20,26,0.85)", border: "0.5px solid #34343c", color: "#e5e5ec", minWidth: 0 }}
            />
          </form>
        </div>
      )}
    </>
  );
}
