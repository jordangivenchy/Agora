"use client";

/* Host Controls — the curation surface only hosts and co-hosts see.
   Deliberately compact: a pill above the control bar that unfolds into a
   small panel, never a dashboard. Four tabs:
     Requests — raised hands, oldest first: Invite / Dismiss
     Audience — searchable list: Invite / Make Speaker / Profile / Remove
     Stage    — current speakers: Mute / To audience / (host) co-host mgmt
     Room     — lock requests, mute all, end discussion
   All writes go straight to Supabase; realtime pushes the result to every
   client. Actions that need the stage migration fail soft with a hint. */

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import type { User } from "@supabase/supabase-js";
import {
  type StageParticipant,
  type StageRole,
  deriveStageRole,
  isHostRole,
  sortRequests,
  ROLE_LABEL,
} from "./stage";
import type { DebateRoom } from "@/types/database";

interface Props {
  room: DebateRoom & { speaker_requests_locked?: boolean };
  participants: StageParticipant[];
  currentUser: User;
  myRole: StageRole;
  onChanged: () => void;
}

type Tab = "requests" | "audience" | "stage" | "room";

const MIGRATION_HINT =
  "This needs the stage-roles migration (supabase/migrations/20260814_agora_stage_roles.sql) applied to the database.";

export default function HostControls({ room, participants, currentUser, myRole, onChanged }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("requests");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const isPrimaryHost = currentUser.id === room.host_id;

  const active = useMemo(
    () => participants.filter((p) => !p.left_at && p.user_id !== currentUser.id),
    [participants, currentUser.id]
  );
  const withRole = useMemo(
    () => active.map((p) => ({ p, role: deriveStageRole(p, room) })),
    [active, room]
  );
  const requests = useMemo(
    () => sortRequests(active.filter((p) => p.hand_raised_at && !onStageRole(deriveStageRole(p, room)))),
    [active, room]
  );
  const audienceList = useMemo(() => {
    const q = search.trim().toLowerCase();
    return withRole
      .filter(({ role }) => role === "audience")
      .filter(({ p }) => !q || (p.user?.username ?? "").toLowerCase().includes(q));
  }, [withRole, search]);
  const stageList = useMemo(
    () => withRole.filter(({ role }) => onStageRole(role)),
    [withRole]
  );

  function onStageRole(role: StageRole) {
    return role !== "audience";
  }

  async function run(key: string, fn: () => Promise<{ error: { message: string } | null }>) {
    setBusy(key);
    setNotice(null);
    try {
      const { error } = await fn();
      if (error) {
        const missingSchema = /stage_role|stage_invites|speaker_requests_locked/.test(error.message);
        setNotice(missingSchema ? MIGRATION_HINT : error.message);
      } else {
        onChanged();
      }
    } finally {
      setBusy(null);
    }
  }

  const invite = (p: StageParticipant) =>
    run(`invite-${p.user_id}`, async () =>
      supabase.from("stage_invites").insert({
        room_id: room.id,
        inviter_id: currentUser.id,
        invitee_id: p.user_id,
      })
    );

  const makeSpeaker = (p: StageParticipant) =>
    run(`speaker-${p.user_id}`, async () =>
      supabase
        .from("debate_participants")
        .update({ stage_role: "speaker", hand_raised_at: null })
        .eq("id", p.id)
    );

  const dismiss = (p: StageParticipant) =>
    run(`dismiss-${p.user_id}`, async () =>
      supabase.from("debate_participants").update({ hand_raised_at: null }).eq("id", p.id)
    );

  const setMuted = (p: StageParticipant, muted: boolean) =>
    run(`mute-${p.user_id}`, async () =>
      supabase.from("debate_participants").update({ mic_muted: muted }).eq("id", p.id)
    );

  const toAudience = (p: StageParticipant) =>
    run(`down-${p.user_id}`, async () =>
      supabase
        .from("debate_participants")
        .update({ stage_role: "audience", hand_raised_at: null })
        .eq("id", p.id)
    );

  const removeFromSpace = (p: StageParticipant) =>
    run(`remove-${p.user_id}`, async () =>
      supabase
        .from("debate_participants")
        .update({ left_at: new Date().toISOString() })
        .eq("id", p.id)
    );

  const setCohost = (p: StageParticipant, make: boolean) =>
    run(`cohost-${p.user_id}`, async () =>
      supabase
        .from("debate_participants")
        .update({ stage_role: make ? "cohost" : "speaker" })
        .eq("id", p.id)
    );

  const toggleLock = () =>
    run("lock", async () =>
      supabase
        .from("debate_rooms")
        .update({ speaker_requests_locked: !room.speaker_requests_locked })
        .eq("id", room.id)
    );

  const muteAllSpeakers = () =>
    run("muteall", async () =>
      supabase
        .from("debate_participants")
        .update({ mic_muted: true })
        .eq("room_id", room.id)
        .eq("stage_role", "speaker")
        .is("left_at", null)
    );

  const endDiscussion = () => {
    if (!window.confirm("End this discussion for everyone?")) return Promise.resolve();
    return run("end", async () =>
      supabase.from("debate_rooms").update({ status: "ended" }).eq("id", room.id)
    );
  };

  return (
    <div className="ag-host">
      <button
        className={`ag-host-pill ${open ? "open" : ""}`}
        onClick={() => setOpen((o) => !o)}
        title="Host controls"
      >
        <CrownIcon />
        Host controls
        {requests.length > 0 && <span className="ag-host-badge">{requests.length}</span>}
      </button>

      {open && (
        <div className="ag-host-panel">
          <div className="ag-host-tabs">
            {(
              [
                ["requests", `Requests${requests.length ? ` · ${requests.length}` : ""}`],
                ["audience", "Audience"],
                ["stage", "Stage"],
                ["room", "Room"],
              ] as [Tab, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                className={`ag-host-tab ${tab === key ? "active" : ""}`}
                onClick={() => setTab(key)}
              >
                {label}
              </button>
            ))}
          </div>

          {notice && <div className="ag-host-notice">{notice}</div>}

          <div className="ag-host-body">
            {tab === "requests" && (
              <>
                {requests.length === 0 && <div className="ag-host-empty">No raised hands.</div>}
                {requests.map((p) => (
                  <div key={p.id} className="ag-host-row">
                    <span className="ag-host-hand">✋</span>
                    <RowIdentity p={p} role="audience" />
                    <button className="ag-host-act primary" disabled={busy !== null} onClick={() => invite(p)}>
                      Invite
                    </button>
                    <button className="ag-host-act" disabled={busy !== null} onClick={() => dismiss(p)}>
                      Dismiss
                    </button>
                  </div>
                ))}
              </>
            )}

            {tab === "audience" && (
              <>
                <input
                  className="ag-host-search"
                  placeholder="Search audience…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                {audienceList.length === 0 && <div className="ag-host-empty">Nobody here matches.</div>}
                {audienceList.map(({ p }) => (
                  <div key={p.id} className="ag-host-row">
                    {p.hand_raised_at && <span className="ag-host-hand">✋</span>}
                    <RowIdentity p={p} role="audience" />
                    <button className="ag-host-act primary" disabled={busy !== null} onClick={() => invite(p)}>
                      Invite
                    </button>
                    <button className="ag-host-act" disabled={busy !== null} onClick={() => makeSpeaker(p)}>
                      Make speaker
                    </button>
                    <a className="ag-host-act" href={`/users/${p.user?.username}`} target="_blank" rel="noreferrer">
                      Profile
                    </a>
                    <button className="ag-host-act danger" disabled={busy !== null} onClick={() => removeFromSpace(p)}>
                      Remove
                    </button>
                  </div>
                ))}
              </>
            )}

            {tab === "stage" && (
              <>
                {stageList.length === 0 && <div className="ag-host-empty">Stage is empty.</div>}
                {stageList.map(({ p, role }) => (
                  <div key={p.id} className="ag-host-row">
                    <RowIdentity p={p} role={role} />
                    <button
                      className="ag-host-act"
                      disabled={busy !== null}
                      onClick={() => setMuted(p, !p.mic_muted)}
                    >
                      {p.mic_muted ? "Unmute" : "Mute"}
                    </button>
                    {!isHostRole(role) && (
                      <button className="ag-host-act" disabled={busy !== null} onClick={() => toAudience(p)}>
                        To audience
                      </button>
                    )}
                    {isPrimaryHost && role === "speaker" && (
                      <button className="ag-host-act" disabled={busy !== null} onClick={() => setCohost(p, true)}>
                        Co-host
                      </button>
                    )}
                    {isPrimaryHost && role === "cohost" && (
                      <button className="ag-host-act" disabled={busy !== null} onClick={() => setCohost(p, false)}>
                        Demote
                      </button>
                    )}
                  </div>
                ))}
              </>
            )}

            {tab === "room" && (
              <div className="ag-host-roomctl">
                <button className="ag-host-act wide" disabled={busy !== null} onClick={toggleLock}>
                  {room.speaker_requests_locked ? "Unlock speaker requests" : "Lock speaker requests"}
                </button>
                <button className="ag-host-act wide" disabled={busy !== null} onClick={muteAllSpeakers}>
                  Mute all speakers
                </button>
                {isPrimaryHost && (
                  <button className="ag-host-act wide danger" disabled={busy !== null} onClick={endDiscussion}>
                    End discussion
                  </button>
                )}
                <div className="ag-host-finehint">
                  {myRole === "host" ? "You are the host." : "You are a co-host."} Hosts are set when
                  the discussion is created — co-hosts can be promoted from the Stage tab.
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function RowIdentity({ p, role }: { p: StageParticipant; role: StageRole }) {
  const name = p.user?.username ?? "?";
  return (
    <span className="ag-host-id">
      <span className={`ag-host-avatar role-${role}`}>{name.charAt(0).toUpperCase()}</span>
      <span className="ag-host-name">
        {name}
        <small>{ROLE_LABEL[role]}</small>
      </span>
    </span>
  );
}

function CrownIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M3 8l4.5 4L12 5l4.5 7L21 8l-1.5 10h-15L3 8z" />
    </svg>
  );
}
