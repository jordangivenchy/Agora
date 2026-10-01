"use client";

/* The call, minimized: a card in the corner of whatever page you are on
   (above the tab bar on a phone) while the room carries on in the call
   slot (CallSlot.tsx) — the way the app keeps a call going above its
   tabs. A window with the room in it, live (on a phone, at the start of
   the bar), then the room's title, who is talking, your mic if you are
   on stage, Leave; the window and the rest of the card take you back in.

   The window is only a place: the room itself is drawn there, under the
   card's frame, and does all the moving (AgoraRoomPage) — it shrinks
   into the window while the card comes up around it, and grows back out
   of it while the card goes. */

import { useState } from "react";
import { Icon } from "@/components/icons";
import UserAvatar from "@/components/UserAvatar";

export interface MiniSpeaker {
  id: string;
  username: string;
  name: string;
  avatarUrl: string | null;
}

export default function MiniCall({
  arriving,
  leaving,
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
  screen,
  onLeave,
  onExpand,
}: {
  /** The room is still shrinking into the corner: come up as it lands. */
  arriving: boolean;
  /** The room is growing back out of the card: fade under it. */
  leaving: boolean;
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
  /** The room is drawn in the card's window (not once its call is over). */
  screen: boolean;
  onLeave: () => void;
  /** Back into the room. */
  onExpand: () => void;
}) {
  /* Whether it came up under a room still landing: kept for the card's
     life, so its entrance isn't retimed when the room lands. */
  const [lateEntrance] = useState(arriving);

  const sub = ended
    ? "The discussion has ended"
    : speaker
      ? `${speaker.name} is speaking`
      : hostName
        ? `Listening · ${hostName}`
        : "Listening";

  return (
    <div
      className={`call-mini${screen ? " has-screen" : ""}${lateEntrance ? " is-arriving" : ""}${leaving ? " is-leaving" : ""}`}
      role="region"
      aria-label="Call in progress"
      inert={leaving}
    >
      {screen && (
        /* Clear: the room shows through it, drawn underneath. */
        <button type="button" className="call-mini-screen" onClick={onExpand} title="Back to the room" aria-label="Back to the room" />
      )}
      <div className="call-mini-row">
        <button type="button" className="call-mini-main" onClick={onExpand} title="Back to the room">
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
          <button type="button" className="call-mini-btn call-mini-expand" onClick={onExpand} title="Back to the room" aria-label="Back to the room">
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
