/* iPhone / iPad detection. iPadOS 13+ reports itself as a Mac, so the
   touch-point check is what catches it. Used where Safari on iOS behaves
   unlike every other browser: one audio capture at a time, sockets
   suspended the moment the screen locks. */
export function isAppleMobile(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}
