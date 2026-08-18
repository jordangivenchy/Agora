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

import { useEffect, useMemo, useRef, useState } from "react";
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
import { displayName } from "@/lib/names";
import { MAX_THUMB_BYTES, makeSquareThumb } from "@/lib/thumbs";

interface Props {
  room: DebateRoom & {
    speaker_requests_locked?: boolean;
    queue_auto_advance?: boolean;
    mic_user_id?: string | null;
    thumbnail_url?: string | null;
  };
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
  /* Restream (RTMP → TikTok/Twitch/YouTube) — primary host only. */
  const [rtmpUrl, setRtmpUrl] = useState("");
  const [egressId, setEgressId] = useState<string | null>(null);
  const [egressBusy, setEgressBusy] = useState(false);
  const [egressError, setEgressError] = useState<string | null>(null);
  const [egressPortrait, setEgressPortrait] = useState(true);

  useEffect(() => {
    // Resync on open: an egress started earlier (or from another tab)
    // should show as running.
    if (!open) return;
    fetch("/api/egress", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomId: room.id, action: "status" }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && typeof d.egressId !== "undefined") setEgressId(d.egressId);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, room.id]);

  const toggleEgress = async () => {
    setEgressBusy(true);
    setEgressError(null);
    try {
      const body = egressId
        ? { roomId: room.id, action: "stop", egressId }
        : { roomId: room.id, action: "start", rtmpUrl, portrait: egressPortrait };
      const res = await fetch("/api/egress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (!res.ok) {
        setEgressError(d.error || "Restream failed");
      } else if (egressId) {
        setEgressId(null);
      } else {
        setEgressId(d.egressId);
        setRtmpUrl("");
      }
    } catch {
      setEgressError("Restream failed — try again.");
    } finally {
      setEgressBusy(false);
    }
  };
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const isPrimaryHost = currentUser.id === room.host_id;

  /* Thumbnail changer — primary host only (storage RLS scopes writes to the
     host's own folder). Upsert overwrites the old art, so no orphans. */
  const [thumbUrl, setThumbUrl] = useState<string | null>(room.thumbnail_url ?? null);
  const [thumbBusy, setThumbBusy] = useState(false);
  const [thumbError, setThumbError] = useState<string | null>(null);
  const thumbInputRef = useRef<HTMLInputElement | null>(null);

  const changeThumbnail = async (file: File) => {
    setThumbError(null);
    if (file.size > MAX_THUMB_BYTES) {
      setThumbError("Image too large — 5MB max.");
      return;
    }
    setThumbBusy(true);
    try {
      const blob = await makeSquareThumb(file);
      const path = `${room.host_id}/${room.id}.webp`;
      const { error: upErr } = await supabase.storage
        .from("thumbnails")
        .upload(path, blob, { upsert: true, cacheControl: "3600", contentType: "image/webp" });
      if (upErr) throw new Error(upErr.message);
      const { data: urlData } = supabase.storage.from("thumbnails").getPublicUrl(path);
      const { error: dbErr } = await supabase
        .from("debate_rooms")
        .update({ thumbnail_url: urlData.publicUrl })
        .eq("id", room.id);
      if (dbErr) throw new Error(dbErr.message);
      /* Cache-bust the preview — the storage URL is stable across upserts. */
      setThumbUrl(`${urlData.publicUrl}?t=${Date.now()}`);
      onChanged();
    } catch (e) {
      setThumbError(e instanceof Error && e.message ? e.message : "Thumbnail update failed — try again.");
    } finally {
      setThumbBusy(false);
    }
  };

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
      .filter(
        ({ p }) =>
          !q ||
          (p.user?.username ?? "").toLowerCase().includes(q) ||
          displayName(p.user).toLowerCase().includes(q)
      );
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

  /* ── Speaker queue: bring the front of the line to the mic, or let it
     advance automatically whenever the mic frees (open-mic mode). ── */
  const bringUpNext = () =>
    run("advance", async () => supabase.rpc("advance_speaker_queue", { p_room: room.id }));

  const toggleAutoAdvance = () =>
    run("auto", async () =>
      supabase
        .from("debate_rooms")
        .update({ queue_auto_advance: !room.queue_auto_advance })
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
                <div className="ag-host-row ag-host-queuectl">
                  <button
                    className="ag-host-act primary"
                    disabled={busy !== null || requests.length === 0}
                    onClick={bringUpNext}
                    title={
                      room.mic_user_id
                        ? "Swap the mic to the next person in line"
                        : "Bring the front of the line to the mic"
                    }
                  >
                    🎤 Bring up next
                  </button>
                  {isPrimaryHost && (
                    <button
                      className={`ag-host-act ${room.queue_auto_advance ? "primary" : ""}`}
                      disabled={busy !== null}
                      onClick={toggleAutoAdvance}
                      title="When on, the mic passes to the next in line automatically whenever it frees"
                    >
                      Auto-advance: {room.queue_auto_advance ? "On" : "Off"}
                    </button>
                  )}
                </div>
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
                {isPrimaryHost && (
                  <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 10, marginTop: 6 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", color: "rgba(255,255,255,0.45)", marginBottom: 6 }}>
                      THUMBNAIL
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      {thumbUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={thumbUrl}
                          alt="Room thumbnail"
                          width={48}
                          height={48}
                          style={{
                            width: 48,
                            height: 48,
                            borderRadius: 8,
                            objectFit: "cover",
                            border: "1px solid rgba(255,255,255,0.12)",
                            flexShrink: 0,
                          }}
                        />
                      ) : (
                        <div
                          style={{
                            width: 48,
                            height: 48,
                            borderRadius: 8,
                            border: "1px dashed rgba(255,255,255,0.25)",
                            flexShrink: 0,
                          }}
                        />
                      )}
                      <button
                        className="ag-host-act"
                        disabled={thumbBusy}
                        onClick={() => thumbInputRef.current?.click()}
                      >
                        {thumbBusy ? "Uploading…" : thumbUrl ? "Change" : "Add image"}
                      </button>
                      <input
                        ref={thumbInputRef}
                        type="file"
                        accept="image/*"
                        style={{ display: "none" }}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          e.target.value = "";
                          if (file) void changeThumbnail(file);
                        }}
                      />
                    </div>
                    {thumbError && (
                      <div style={{ color: "#fca5a5", fontSize: 11, marginTop: 5 }}>{thumbError}</div>
                    )}
                    <div className="ag-host-finehint">
                      Square art shown on room cards. Center-cropped to 512px — 5MB max.
                    </div>
                  </div>
                )}
                {isPrimaryHost && (
                  <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 10, marginTop: 6 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", color: "rgba(255,255,255,0.45)", marginBottom: 6 }}>
                      RESTREAM {egressId && <span style={{ color: "#e05a5a" }}>● LIVE</span>}
                    </div>
                    {!egressId && (
                      <input
                        value={rtmpUrl}
                        onChange={(e) => setRtmpUrl(e.target.value)}
                        placeholder="rtmp://… ingest URL + stream key"
                        spellCheck={false}
                        style={{
                          width: "100%",
                          height: 32,
                          marginBottom: 6,
                          borderRadius: 8,
                          border: "1px solid rgba(255,255,255,0.12)",
                          background: "rgba(255,255,255,0.05)",
                          color: "white",
                          fontSize: 11.5,
                          padding: "0 10px",
                          boxSizing: "border-box",
                        }}
                      />
                    )}
                    {!egressId && (
                      <label
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          fontSize: 11.5,
                          color: "rgba(255,255,255,0.6)",
                          marginBottom: 6,
                          cursor: "pointer",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={egressPortrait}
                          onChange={(e) => setEgressPortrait(e.target.checked)}
                        />
                        Portrait (TikTok) — uncheck for Twitch/YouTube
                      </label>
                    )}
                    <button
                      className={`ag-host-act wide${egressId ? " danger" : ""}`}
                      disabled={egressBusy || (!egressId && !rtmpUrl.trim())}
                      onClick={toggleEgress}
                    >
                      {egressBusy ? "…" : egressId ? "Stop restream" : "Go live on TikTok / RTMP"}
                    </button>
                    {egressError && (
                      <div style={{ color: "#fca5a5", fontSize: 11, marginTop: 5 }}>{egressError}</div>
                    )}
                    <div className="ag-host-finehint">
                      Paste the RTMP server URL with your stream key appended (from TikTok LIVE
                      Studio, Twitch, or YouTube). The stage broadcasts until you stop it.
                    </div>
                  </div>
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
  const name = displayName(p.user) || "?";
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
