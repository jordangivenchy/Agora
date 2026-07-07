"use client";

/* Agora — the in-room AI assistant. A floating blue orb (bottom-left of
   the stage) that opens a compact panel: ask by typing or dictating via
   the mic; answers arrive written (and spoken, once the voice pipeline
   is connected). Shared design language with the Battle lobby preview. */

import { useCallback, useState } from "react";

export default function AgoraAssistant() {
  const [openPanel, setOpenPanel] = useState(false);
  const [log, setLog] = useState<{ from: "you" | "agora"; text: string }[]>([]);
  const [draft, setDraft] = useState("");
  const [listening, setListening] = useState(false);

  const ask = useCallback((q: string) => {
    const question = q.trim();
    if (!question) return;
    setLog((l) => [
      ...l,
      { from: "you", text: question },
      {
        from: "agora",
        text:
          "I'm Agora. In rated battles I listen for \"Hey, Agora\" and answer both debaters — spoken and in writing, with sources. My live knowledge pipeline connects at launch; until then I can't verify claims yet.",
      },
    ]);
    setDraft("");
  }, []);

  const dictate = useCallback(() => {
    type SR = { new (): { lang: string; onresult: (e: { results: { [i: number]: { [j: number]: { transcript: string } } } }) => void; onend: () => void; onerror: () => void; start: () => void } };
    const w = window as unknown as { SpeechRecognition?: SR; webkitSpeechRecognition?: SR };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) {
      setLog((l) => [...l, { from: "agora", text: "Voice input isn't supported in this browser — type your question instead." }]);
      return;
    }
    const rec = new Ctor();
    rec.lang = "en-US";
    rec.onresult = (e) => setDraft(e.results[0][0].transcript);
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    setListening(true);
    rec.start();
  }, []);

  return (
    <>
      {/* Floating orb */}
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
          boxShadow: "0 0 22px rgba(37,99,235,0.5)",
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
            width: 320,
            maxHeight: 420,
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
                say <span style={{ color: "#9cc4f0" }}>"Hey, Agora"</span> or ask below · answers cite sources
              </p>
            </div>
            <button
              onClick={() => setOpenPanel(false)}
              className="ml-auto cursor-pointer bg-transparent border-none text-[13px]"
              style={{ color: "#8b8b94" }}
            >
              ✕
            </button>
          </div>

          <div className="flex-1 overflow-y-auto flex flex-col gap-2 mb-2" style={{ minHeight: 60 }}>
            {log.length === 0 && (
              <p className="text-[11px] m-0" style={{ color: "#8b8b94", lineHeight: 1.5 }}>
                Ask for a fact-check, a statistic, or background on the motion — both debaters see my answers.
              </p>
            )}
            {log.map((m, i) => (
              <div key={i} className="flex" style={{ justifyContent: m.from === "you" ? "flex-end" : "flex-start" }}>
                <p
                  className="m-0 text-[11px] px-3 py-1.5 rounded-xl"
                  style={
                    m.from === "you"
                      ? { background: "rgba(24,48,82,0.9)", border: "0.5px solid #2c5382", color: "#dbeafe", maxWidth: "82%" }
                      : { background: "rgba(20,20,26,0.9)", border: "0.5px solid #34343c", color: "#e5e5ec", maxWidth: "82%", lineHeight: 1.45 }
                  }
                >
                  {m.text}
                </p>
              </div>
            ))}
          </div>

          <form className="flex gap-2 items-center" onSubmit={(e) => { e.preventDefault(); ask(draft); }}>
            <button
              type="button"
              onClick={dictate}
              className="flex items-center justify-center shrink-0 cursor-pointer"
              title={listening ? "Listening…" : "Dictate"}
              style={{
                width: 28, height: 28, borderRadius: "50%",
                background: listening ? "rgba(240,96,94,0.2)" : "rgba(20,20,26,0.85)",
                border: listening ? "0.5px solid #f0605e" : "0.5px solid #34343c",
                color: listening ? "#f0605e" : "#8b8b94", fontSize: 12,
              }}
            >
              🎙
            </button>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Ask Agora…"
              className="flex-1 text-[11px] px-3 py-1.5 rounded-full outline-none"
              style={{ background: "rgba(20,20,26,0.85)", border: "0.5px solid #34343c", color: "#e5e5ec" }}
            />
          </form>
        </div>
      )}
    </>
  );
}
