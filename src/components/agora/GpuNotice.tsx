"use client";

/* The room, on a browser that is drawing without the graphics card.

   A site can't switch hardware acceleration on — that is the browser's
   setting — but it can notice, say so, and name the switch. Without it
   the amphitheatre is drawn by the CPU and the whole call crawls, so the
   room has already fallen back to the simple stage (lib/stageQuality);
   this says why, once, and how to have the real thing back. */

import { useCallback, useSyncExternalStore } from "react";
import { Icon } from "@/components/icons";
import { useSimpleStage } from "@/lib/stageQuality";

const KEY = "agora:gpu-notice-read";
const listeners = new Set<() => void>();
const readDismissed = (): boolean => {
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => { listeners.delete(l); };
};

/* Where the switch lives, in the browser's own words. */
function acceleration(): { where: string; label: string } {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  if (/Firefox\//.test(ua)) {
    return { where: "Settings → General → Performance", label: "Use hardware acceleration when available" };
  }
  if (/Edg\//.test(ua)) {
    return { where: "Settings → System and performance", label: "Use graphics acceleration when available" };
  }
  return { where: "Settings → System", label: "Use graphics acceleration when available" };
}

export default function GpuNotice() {
  const { forced } = useSimpleStage();
  const dismissed = useSyncExternalStore(subscribe, readDismissed, () => false);
  const dismiss = useCallback(() => {
    try { window.localStorage.setItem(KEY, "1"); } catch { /* the notice comes back next time; nothing else changes */ }
    for (const l of listeners) l();
  }, []);
  if (forced !== "software" || dismissed) return null;
  const { where, label } = acceleration();
  return (
    <div className="ag-gpu-notice" role="status">
      <Icon name="alert-triangle" size={15} />
      <p>
        <b>Your browser is drawing without your graphics card</b>, so this room will be slow and the 3D
        stage is off. To fix it: in the browser&rsquo;s <b>{where}</b>, turn on <b>&ldquo;{label}&rdquo;</b> and
        relaunch. You can check with <code>chrome://gpu</code> — the <b>WebGL</b> line should say <i>Hardware accelerated</i>.
      </p>
      <button type="button" onClick={dismiss} aria-label="Got it">
        Got it
      </button>
    </div>
  );
}
