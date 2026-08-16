"use client";

/* The Agora amphitheater view: the 3D scene (AgoraScene3D) with the HTML
   stage rail overlaid — speaker panels, emblem, and the future
   speaker-view toggle. The 2D data logic (who's on stage, who's seated)
   lives in the page; this component just lays it out. */

import AgoraScene3D, { type AgoraView } from "./AgoraScene3D";

export interface StagePerson {
  id: string;
  username: string;
  avatarUrl: string | null;
  speaking: boolean;
  stageRole?: "host" | "cohost" | "speaker" | "audience";
}

export interface SeatedPerson {
  id: string;
  username: string;
  avatarUrl: string | null;
}

interface Props {
  roomId: string;
  proSpeakers: StagePerson[];
  conSpeakers: StagePerson[];
  /* Non-debater stage: hosts, co-hosts, and promoted speakers, arranged
     together — no artificial host section. */
  stageStrip: StagePerson[];
  audience: SeatedPerson[];
  viewerCount: number;
  view: AgoraView;
  onSwitchView: () => void;
}

function hashString(s: string): number {
  let h = 1779033703;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

const AVATAR_COLORS = [
  "#8b5cf6", "#4a9eff", "#e17055", "#00b894", "#fd79a8",
  "#e2b96b", "#00cec9", "#9c84ef", "#3ba3d0", "#eb459e",
];

function colorFor(id: string): string {
  return AVATAR_COLORS[hashString(id) % AVATAR_COLORS.length];
}

function SpeakerPanel({ side, speakers }: { side: "pro" | "con"; speakers: StagePerson[] }) {
  const speakingCount = speakers.filter((s) => s.speaking).length || speakers.length;
  /* No stance labels — the panel leads with who's actually on stage. */
  const title =
    speakers.length === 0
      ? "Open seat"
      : speakers.length === 1
        ? speakers[0].username
        : `${speakers.length} debaters`;
  return (
    <div className={`ag-stage-panel ag-stage-panel--${side}`}>
      <div className="ag-stage-panel-head">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
          <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
          <path d="M5 11a7 7 0 0 0 14 0M12 18v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <span className="ag-stage-panel-title">{title}</span>
      </div>
      <div className="ag-stage-panel-count">
        {speakers.length === 0 ? "Waiting for a debater" : `${speakingCount} Speaking`}
      </div>
      <div className="ag-stage-avatars">
        {speakers.length === 0 && <div className="ag-stage-avatar ag-stage-avatar--empty">?</div>}
        {speakers.slice(0, 4).map((s) => (
          <div key={s.id} className="ag-stage-avatar" style={{ background: colorFor(s.id) }} title={s.username}>
            {(s.username || "?").charAt(0).toUpperCase()}
            {s.speaking && <span className="ag-speaking-ring" />}
          </div>
        ))}
      </div>
      <div className="ag-wave" aria-hidden>
        {Array.from({ length: 24 }, (_, i) => (
          <span key={i} style={{ animationDelay: `${(i % 8) * 0.12}s` }} />
        ))}
      </div>
    </div>
  );
}

/* One person on the discussion strip: avatar with a role ring, a crown
   for hosts (outlined for co-hosts), a speaking ring when live. Entrance
   is animated — coming up from the audience should feel like walking on
   stage, not toggling state. */
function StripChip({ person }: { person: StagePerson }) {
  const role = person.stageRole ?? "speaker";
  return (
    <div className={`ag-strip-chip role-${role}`} title={`${person.username} — ${role}`}>
      <div className="ag-strip-avatar" style={{ background: colorFor(person.id) }}>
        {(person.username || "?").charAt(0).toUpperCase()}
        {person.speaking && <span className="ag-speaking-ring" />}
        {(role === "host" || role === "cohost") && (
          <span className={`ag-crown ${role}`} aria-label={role}>
            <svg width="10" height="10" viewBox="0 0 24 24" aria-hidden
              fill={role === "host" ? "currentColor" : "none"}
              stroke="currentColor" strokeWidth={role === "host" ? 0 : 2.5}>
              <path d="M3 8l4.5 4L12 5l4.5 7L21 8l-1.5 10h-15L3 8z" />
            </svg>
          </span>
        )}
      </div>
      <span className="ag-strip-name">{person.username}</span>
    </div>
  );
}

export default function Amphitheater({
  roomId,
  proSpeakers,
  conSpeakers,
  stageStrip,
  audience,
  viewerCount,
  view,
  onSwitchView,
}: Props) {
  const inSpeaker = view === "speaker";
  return (
    <div className="ag-theater">
      <AgoraScene3D roomId={roomId} audience={audience} viewerCount={viewerCount} view={view} />

      {/* The discussion strip: hosts and promoted speakers, above the rail */}
      {stageStrip.length > 0 && (
        <div className="ag-strip">
          {stageStrip.map((person) => (
            <StripChip key={person.id} person={person} />
          ))}
        </div>
      )}

      {/* The stage rail: panels + emblem + view toggle over the 3D scene */}
      <div className="ag-stage">
        <SpeakerPanel side="pro" speakers={proSpeakers} />
        <div className="ag-stage-center">
          <button
            className="ag-switch-view"
            onClick={onSwitchView}
            title={inSpeaker ? "Back to the amphitheater" : "Eye-level with the stage"}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
              <rect x="2" y="4" width="20" height="14" rx="2" stroke="currentColor" strokeWidth="2" />
              <path d="M8 21h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <span>
              <strong>{inSpeaker ? "Switch audience view" : "Switch speaker view"}</strong>
              <small>{inSpeaker ? "back to the amphitheater" : "focused view of the debaters"}</small>
            </span>
          </button>
        </div>
        <SpeakerPanel side="con" speakers={conSpeakers} />
      </div>
    </div>
  );
}
