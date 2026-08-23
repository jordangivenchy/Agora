/* Microphone permission, app-wide.

   We never let the browser's native prompt be the first thing a person
   sees: UI shows a pre-prompt card, and only an explicit "Allow" click
   triggers getUserMedia. "Not now" is remembered for 7 days; a denied
   state gets recovery instructions instead of a dead end.

   State is read live via navigator.permissions (Chrome/Edge/Firefox);
   Safari lacks the query API, so it reports "unknown" until we try. */

export type MicState = "unsupported" | "prompt" | "granted" | "denied" | "unknown";

const SNOOZE_KEY = "agora:mic-snooze-until";
const listeners = new Set<(s: MicState) => void>();
let current: MicState = "unknown";
let watching = false;

function emit(s: MicState) {
  current = s;
  listeners.forEach((fn) => fn(s));
}

export function getMicState(): MicState {
  return current;
}

export function subscribeMic(fn: (s: MicState) => void): () => void {
  listeners.add(fn);
  void watchMic();
  return () => { listeners.delete(fn); };
}

/** Resolve the current state (and keep it updated when the browser changes it). */
export async function watchMic(): Promise<MicState> {
  if (typeof navigator === "undefined") return "unknown";
  if (!navigator.mediaDevices?.getUserMedia) { emit("unsupported"); return "unsupported"; }
  if (watching) return current;
  watching = true;
  try {
    const perms = (navigator as Navigator & { permissions?: Permissions }).permissions;
    if (perms?.query) {
      const st = await perms.query({ name: "microphone" as PermissionName });
      emit(st.state as MicState);
      st.onchange = () => emit(st.state as MicState);
      return st.state as MicState;
    }
  } catch { /* fall through */ }
  emit("unknown");
  return "unknown";
}

export function isMicSnoozed(): boolean {
  try {
    const until = Number(localStorage.getItem(SNOOZE_KEY) ?? 0);
    return until > Date.now();
  } catch { return false; }
}

export function snoozeMic(days = 7) {
  try { localStorage.setItem(SNOOZE_KEY, String(Date.now() + days * 86_400_000)); } catch { /* ignore */ }
}

export function clearMicSnooze() {
  try { localStorage.removeItem(SNOOZE_KEY); } catch { /* ignore */ }
}

/** Trigger the native prompt (call from a click). Releases the stream at once. */
export async function requestMic(): Promise<MicState> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    emit("unsupported"); return "unsupported";
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    clearMicSnooze();
    emit("granted");
    return "granted";
  } catch (e) {
    const name = e instanceof DOMException ? e.name : "";
    if (name === "NotAllowedError" || name === "SecurityError") { emit("denied"); return "denied"; }
    emit("unknown");
    return "unknown";
  }
}

/** Browser-specific steps for un-blocking. */
export function micRecoverySteps(): string[] {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  if (/Safari/.test(ua) && !/Chrome|Chromium|Edg/.test(ua)) {
    return ["Safari menu → Settings for agorasphere.net", "Microphone → Allow", "Reload the page"];
  }
  if (/Firefox/.test(ua)) {
    return ["Click the mic icon in the address bar", "Remove the “Blocked” entry", "Reload and allow"];
  }
  return ["Click the 🔒 or tune icon left of the address bar", "Microphone → Allow", "Reload the page"];
}
