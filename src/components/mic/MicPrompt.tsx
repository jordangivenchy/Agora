"use client";

/* Pre-prompt card for microphone access. Renders nothing once granted,
   snoozed, or unsupported. `placement="corner"` floats bottom-right on
   the home shell; `placement="inline"` sits inside a panel (assistant,
   stage join). Denied → recovery steps instead of a dead end. */

import { useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import {
  getMicState, isMicSnoozed, micRecoverySteps, requestMic, snoozeMic, subscribeMic, type MicState,
} from "@/lib/micPermission";

export default function MicPrompt({
  placement = "corner",
  reason,
  onDone,
}: {
  placement?: "corner" | "inline";
  /** Why we're asking, in context ("to join the stage", "for Hey Agora"). */
  reason?: string;
  onDone?: (state: MicState) => void;
}) {
  const [state, setState] = useState<MicState>(getMicState());
  const [snoozed, setSnoozed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setSnoozed(isMicSnoozed());
    return subscribeMic(setState);
  }, []);

  if (state === "granted" || state === "unsupported") return null;
  if (placement === "corner" && (snoozed || state === "unknown")) return null;
  if (placement === "corner" && state === "denied") return null; // recovery lives in the room UI

  const card: React.CSSProperties =
    placement === "corner"
      ? {
          position: "fixed", right: 20, bottom: 20, zIndex: 940, width: 320,
          background: "rgba(10,12,18,0.97)", border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 14, boxShadow: "0 24px 80px rgba(0,0,0,0.55)", backdropFilter: "blur(18px)",
          padding: 14, fontFamily: "'DM Sans', sans-serif",
        }
      : {
          background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 12, padding: 12, fontFamily: "'DM Sans', sans-serif",
        };

  const allow = async () => {
    setBusy(true);
    const s = await requestMic();
    setBusy(false);
    onDone?.(s);
  };
  const later = () => { snoozeMic(); setSnoozed(true); onDone?.(state); };

  if (state === "denied") {
    return (
      <div style={card} role="status">
        <p className="m-0 flex items-center gap-2" style={{ color: "#f5f5f0", fontSize: 13.5, fontWeight: 600 }}>
          <Icon name="mic-off" size={15} style={{ color: "#e05a5a" }} /> Microphone is blocked
        </p>
        <ol className="m-0 mt-2 pl-4" style={{ color: "#c9c9d2", fontSize: 12.5, lineHeight: 1.6 }}>
          {micRecoverySteps().map((s) => <li key={s}>{s}</li>)}
        </ol>
        <p className="m-0 mt-2" style={{ color: "#8b8b94", fontSize: 11.5 }}>
          Needed for the stage and hands-free “Hey Agora”.
        </p>
      </div>
    );
  }

  return (
    <div style={card} role="dialog" aria-label="Microphone permission">
      <p className="m-0 flex items-center gap-2" style={{ color: "#f5f5f0", fontSize: 13.5, fontWeight: 600 }}>
        <Icon name="mic" size={15} style={{ color: "#e2b96b" }} /> Use your microphone?
      </p>
      <p className="m-0 mt-1" style={{ color: "#c9c9d2", fontSize: 12.5, lineHeight: 1.5 }}>
        {reason ?? "For hands-free “Hey Agora” and joining the stage."} Nothing is recorded until you’re on stage.
      </p>
      <div className="flex items-center gap-2 mt-3">
        <button
          onClick={allow}
          disabled={busy}
          className="cursor-pointer"
          style={{
            padding: "7px 14px", borderRadius: 999, border: "none", fontSize: 12.5, fontWeight: 700,
            background: "linear-gradient(135deg,#f7e3a0,#d9a238)", color: "#412402", fontFamily: "inherit",
          }}
        >
          {busy ? "Asking…" : "Allow microphone"}
        </button>
        <button
          onClick={later}
          className="cursor-pointer"
          style={{
            padding: "7px 12px", borderRadius: 999, fontSize: 12.5, fontFamily: "inherit",
            background: "transparent", border: "1px solid rgba(255,255,255,0.14)", color: "#c9c9d2",
          }}
        >
          Not now
        </button>
      </div>
    </div>
  );
}
