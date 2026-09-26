"use client";

/* The call, minimized: a card in the corner of whatever page you are on
   (above the tab bar on a phone) while the room carries on in the call
   slot (CallSlot.tsx) — the way the app keeps a call going above its
   tabs. The room's title, who is talking, your mic if you are on stage,
   Leave; the rest of the card takes you back in.

   Going back in, the card grows to fill the screen first and the room
   takes over from there — the way out (the room shrinking into this
   corner, AgoraRoomPage) reversed. An audience watching the broadcast
   (the biggest rooms) hears it through the video, so for them the card
   carries that video along its top. */

import { useRef, useState } from "react";
import { Icon } from "@/components/icons";
import UserAvatar from "@/components/UserAvatar";
import { HlsBroadcastSurface } from "./HlsPlayer";

export interface MiniSpeaker {
  id: string;
  username: string;
  name: string;
  avatarUrl: string | null;
}

export default function MiniCall({
  motion,
  ended,
  speaker,
  hostName,
  onStage,
  micOn,
  micReady,
  onToggleMic,
  audioBlocked,
  onEnableAudio,
  hlsSrc,
  onLeave,
  onExpand,
}: {
  motion: string;
  /** The host closed the stage while you were away. */
  ended: boolean;
  /** Who is talking right now, if anyone. */
  speaker: MiniSpeaker | null;
  hostName: string | null;
  onStage: boolean;
  micOn: boolean;
  micReady: boolean;
  onToggleMic: () => void;
  /** The browser is holding the sound back until a tap. */
  audioBlocked: boolean;
  onEnableAudio: () => void;
  /** The broadcast, for an audience watching it rather than in the call. */
  hlsSrc: string | null;
  onLeave: () => void;
  /** Called once the card has grown to fill the screen. */
  onExpand: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [opening, setOpening] = useState(false);

  const open = () => {
    if (opening) return;
    setOpening(true);
    const el = cardRef.current;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!el || still) {
      onExpand();
      return;
    }
    const r = el.getBoundingClientRect();
    const grow = el.animate(
      [
        { transform: "translate(0px, 0px) scale(1, 1)", borderRadius: "16px" },
        {
          transform: `translate(${-r.left}px, ${-r.top}px) scale(${window.innerWidth / r.width}, ${window.innerHeight / r.height})`,
          borderRadius: "0px",
        },
      ],
      { duration: 300, easing: "cubic-bezier(.2,.7,.2,1)", fill: "forwards" }
    );
    /* A hidden tab pauses animations; the room must still open. */
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      window.clearTimeout(late);
      onExpand();
    };
    const late = window.setTimeout(finish, 700);
    grow.onfinish = finish;
  };

  const sub = ended
    ? "The discussion has ended"
    : speaker
      ? `${speaker.name} is speaking`
      : hostName
        ? `Listening · ${hostName}`
        : "Listening";

  return (
    <div ref={cardRef} className={`call-mini${opening ? " is-opening" : ""}`} role="region" aria-label="Call in progress">
      {hlsSrc && !ended && (
        <div className="call-mini-video">
          <HlsBroadcastSurface src={hlsSrc} compact />
        </div>
      )}
      <div className="call-mini-row">
        <button type="button" className="call-mini-main" onClick={open} title="Back to the room">
          <span className="call-mini-live">
            <i className={ended ? "is-over" : ""} />
            {ended ? "Ended" : "Live"}
          </span>
          <span className="call-mini-title">{motion}</span>
          <span className="call-mini-sub">
            {speaker && !ended && (
              <UserAvatar size={16} username={speaker.username} avatarUrl={speaker.avatarUrl} seed={speaker.id} />
            )}
            <span className="call-mini-sub-text">{sub}</span>
          </span>
        </button>
        <div className="call-mini-actions">
          {audioBlocked && !ended && (
            <button type="button" className="call-mini-btn" onClick={onEnableAudio} title="Turn the sound on" aria-label="Turn the sound on">
              <Icon name="volume-x" size={17} />
            </button>
          )}
          {onStage && !ended && (
            <button
              type="button"
              className={`call-mini-btn${micOn ? " is-live" : ""}`}
              onClick={onToggleMic}
              disabled={!micReady}
              aria-pressed={micOn}
              title={micOn ? "Mute your mic" : "Unmute your mic"}
              aria-label={micOn ? "Mute your mic" : "Unmute your mic"}
            >
              <Icon name={micOn ? "mic" : "mic-off"} size={17} />
            </button>
          )}
          <button type="button" className="call-mini-btn" onClick={open} title="Back to the room" aria-label="Back to the room">
            <Icon name="chevron-up" size={18} />
          </button>
          <button
            type="button"
            className={`call-mini-btn${ended ? "" : " is-leave"}`}
            onClick={onLeave}
            title={ended ? "Close" : "Leave the room"}
            aria-label={ended ? "Close" : "Leave the room"}
          >
            <Icon name={ended ? "x" : "phone-off"} size={17} />
          </button>
        </div>
      </div>
    </div>
  );
}
