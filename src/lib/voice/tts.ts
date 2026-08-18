"use client";

/* Agora's voice. Primary: Kokoro — an open-source (Apache-2.0) 82M neural
   TTS that runs fully in the browser (WebGPU when available, WASM otherwise)
   with a warm, conversational voice. The ~80MB model downloads once in the
   background and is cached by the browser; until it's ready — or on browsers
   that can't run it — we fall back to the OS speechSynthesis voice so Agora
   is never mute.

   Usage:
     warmVoice()            → kick off the model download (call on mount)
     speak(text)            → speaks with the best available voice
     stopSpeaking()         → interrupts current playback (both engines)
*/

interface RawAudioLike {
  audio: Float32Array;
  sampling_rate: number;
}
interface KokoroLike {
  generate: (text: string, opts: { voice: string }) => Promise<RawAudioLike>;
}

const VOICE = "af_heart"; // Kokoro's warmest conversational default

let kokoroPromise: Promise<KokoroLike | null> | null = null;
let audioCtx: AudioContext | null = null;
let currentSource: AudioBufferSourceNode | null = null;
let generation = 0; // bumped by stopSpeaking() to cancel queued sentences

function supportsKokoro(): boolean {
  if (typeof window === "undefined") return false;
  // WASM is the floor; WebGPU just makes it faster.
  return typeof WebAssembly === "object";
}

async function loadKokoro(): Promise<KokoroLike | null> {
  if (!supportsKokoro()) return null;
  try {
    const { KokoroTTS } = await import("kokoro-js");
    const hasWebGPU = "gpu" in navigator;
    const tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", {
      dtype: hasWebGPU ? "fp32" : "q8",
      device: hasWebGPU ? "webgpu" : "wasm",
    });
    return tts as unknown as KokoroLike;
  } catch (err) {
    console.warn("[voice] Kokoro unavailable, staying on browser TTS:", err);
    return null;
  }
}

/** Begin downloading/compiling the model. Safe to call repeatedly. */
export function warmVoice(): void {
  if (!kokoroPromise && supportsKokoro()) kokoroPromise = loadKokoro();
}

function getCtx(): AudioContext {
  if (!audioCtx) audioCtx = new AudioContext();
  return audioCtx;
}

function playRaw(raw: RawAudioLike): Promise<void> {
  return new Promise((resolve) => {
    const ctx = getCtx();
    if (ctx.state === "suspended") void ctx.resume();
    const buffer = ctx.createBuffer(1, raw.audio.length, raw.sampling_rate);
    buffer.copyToChannel(new Float32Array(raw.audio), 0);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.onended = () => {
      if (currentSource === source) currentSource = null;
      resolve();
    };
    currentSource = source;
    source.start();
  });
}

/** Rough sentence chunks so long answers start speaking after the first
    sentence generates instead of after the whole paragraph. */
function chunkSentences(text: string): string[] {
  const parts = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  // Merge tiny fragments into their neighbor so the voice doesn't hiccup.
  const merged: string[] = [];
  for (const p of parts) {
    if (merged.length && (p.length < 24 || merged[merged.length - 1].length < 24)) {
      merged[merged.length - 1] += " " + p;
    } else {
      merged.push(p);
    }
  }
  return merged.length ? merged : [text];
}

function speakWithBrowser(text: string): void {
  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.05;
    window.speechSynthesis.speak(utterance);
  } catch {
    /* no speech at all — stay silent */
  }
}

/** Speak with the most human voice available right now. */
export async function speak(text: string): Promise<void> {
  const clean = text.replace(/[⚡●◉]/g, "").trim();
  if (!clean) return;

  stopSpeaking();
  const myGeneration = ++generation;

  warmVoice();
  // Never wait on a cold model: if Kokoro isn't ready this instant, use the
  // browser voice for this reply; the model keeps loading for the next one.
  const kokoro = await Promise.race([
    kokoroPromise ?? Promise.resolve(null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 150)),
  ]);

  if (!kokoro) {
    speakWithBrowser(clean);
    return;
  }

  try {
    // Pipeline: generate sentence N+1 while sentence N plays.
    const chunks = chunkSentences(clean);
    let pending = kokoro.generate(chunks[0], { voice: VOICE });
    for (let i = 0; i < chunks.length; i++) {
      const raw = await pending;
      if (generation !== myGeneration) return; // interrupted
      if (i + 1 < chunks.length) pending = kokoro.generate(chunks[i + 1], { voice: VOICE });
      await playRaw(raw);
      if (generation !== myGeneration) return;
    }
  } catch (err) {
    console.warn("[voice] Kokoro playback failed, falling back:", err);
    if (generation === myGeneration) speakWithBrowser(clean);
  }
}

export function stopSpeaking(): void {
  generation++;
  try { window.speechSynthesis?.cancel(); } catch { /* unsupported */ }
  if (currentSource) {
    try { currentSource.stop(); } catch { /* already stopped */ }
    currentSource = null;
  }
}
