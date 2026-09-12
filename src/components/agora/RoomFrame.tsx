"use client";

/* About this debate: a pop-out under the top bar's actions. The host (or
   a co-host) writes the frame, what is being argued and on what terms;
   everyone on the stage writes one line on where they stand; the
   audience reads. Changes ride on the room row, so the room's realtime
   subscription brings them to everyone; the button shows a dot when
   the frame changed while the panel was closed. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import UserAvatar from "@/components/UserAvatar";
import { Icon } from "@/components/icons";
import type { RoomFraming } from "@/types/database";
import { ROLE_LABEL, type StageParticipant, type StageRole, isHostRole, onStage } from "./stage";
import { frameIsEmpty, frameNewsKey, framePeople } from "./frameModel";

const ABOUT_MAX = 600;
const STANCE_MAX = 200;

interface Props {
  room: { id: string; host_id: string; framing?: RoomFraming | null };
  participants: StageParticipant[];
  myRole: StageRole;
  currentUserId: string | null;
  supabase: SupabaseClient;
  /** The room row's new framing, so the page shows it before realtime catches up. */
  onChange: (framing: RoomFraming) => void;
}

export default function RoomFrame({ room, participants, myRole, currentUserId, supabase, onChange }: Props) {
  const framing = room.framing ?? null;
  const key = frameNewsKey(framing);

  const [open, setOpen] = useState(false);
  /* What I last looked at; the dot shows when the frame moved on since. */
  const [seenKey, setSeenKey] = useState(key);
  /* Drafts are null while I'm not editing, so what arrives shows through. */
  const [aboutDraft, setAboutDraft] = useState<string | null>(null);
  const [lineDraft, setLineDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState<"about" | "line" | "clear" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const canFrame = isHostRole(myRole);
  const canSpeak = !!currentUserId && onStage(myRole);
  const me = useMemo(() => (currentUserId ? { id: currentUserId, role: myRole } : null), [currentUserId, myRole]);
  const people = useMemo(() => framePeople(participants, room, me), [participants, room, me]);

  const serverAbout = framing?.about ?? "";
  const about = aboutDraft ?? serverAbout;
  const aboutDirty = about.trim() !== serverAbout.trim();
  const myStance = currentUserId ? (framing?.stances?.[currentUserId]?.text ?? "") : "";
  const line = lineDraft ?? myStance;

  const hasNews = !open && key !== seenKey;
  const toggle = () => {
    setSeenKey(key);
    setOpen((o) => !o);
  };
  const close = () => {
    setSeenKey(key);
    setOpen(false);
  };

  /* Click outside closes, as the room's other menus do. */
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) close();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, key]);

  const call = useCallback(
    async (fn: string, args: Record<string, unknown>, kind: "about" | "line" | "clear") => {
      setBusy(kind);
      setError(null);
      const { data, error: err } = await supabase.rpc(fn, args);
      setBusy(null);
      if (err) {
        setError(err.message.replace(/^.*?:\s*/, ""));
        return false;
      }
      if (data && typeof data === "object") onChange(data as RoomFraming);
      return true;
    },
    [supabase, onChange]
  );

  const saveAbout = async () => {
    if (await call("set_room_frame", { p_room: room.id, p_about: about.trim() }, "about")) setAboutDraft(null);
  };
  const saveLine = async () => {
    if (lineDraft === null) return;
    if (lineDraft.trim() === myStance.trim()) {
      setLineDraft(null);
      return;
    }
    if (await call("set_room_stance", { p_room: room.id, p_text: lineDraft.trim() }, "line")) setLineDraft(null);
  };
  const clearLine = (userId: string) => call("clear_room_stance", { p_room: room.id, p_user: userId }, "clear");

  const setter = framing?.about_by ? people.find((p) => p.id === framing.about_by) : null;
  const empty = frameIsEmpty(framing);

  return (
    <div className="ag-frame-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`ag-about ${open ? "on" : ""}`}
        onClick={toggle}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="What this debate is about, and where people stand"
      >
        <Icon name="info" size={14} />
        About
        {hasNews && <span className="ag-about-dot" aria-label="The frame changed" />}
      </button>

      {open && (
        <div className="ag-frame" role="dialog" aria-label="About this debate">
          <div className="ag-frame-head">
            <span>About this debate</span>
            <button type="button" className="ag-frame-close" onClick={close} aria-label="Close">
              ×
            </button>
          </div>

          <section className="ag-frame-sec">
            <div className="ag-frame-label">The frame</div>
            {canFrame ? (
              <>
                <textarea
                  className="ag-frame-text"
                  value={about}
                  onChange={(e) => setAboutDraft(e.target.value.slice(0, ABOUT_MAX))}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void saveAbout();
                  }}
                  placeholder="What are we arguing? Set the question, the terms, and what's out of bounds."
                  maxLength={ABOUT_MAX}
                  rows={4}
                />
                <div className="ag-frame-row">
                  <span className="ag-frame-hint">
                    {about.length}/{ABOUT_MAX}
                    {framing?.about_at ? ` · set ${timeAgo(framing.about_at)}` : ""}
                  </span>
                  <button type="button" className="ag-frame-save" onClick={() => void saveAbout()} disabled={!aboutDirty || busy === "about"}>
                    {busy === "about" ? "Saving…" : "Save"}
                  </button>
                </div>
              </>
            ) : serverAbout.trim() ? (
              <>
                <p className="ag-frame-about">{serverAbout}</p>
                <div className="ag-frame-meta">
                  Set by {setter?.name ?? "the host"}
                  {framing?.about_at ? ` · ${timeAgo(framing.about_at)}` : ""}
                </div>
              </>
            ) : (
              <p className="ag-frame-empty">The host hasn&rsquo;t set the frame yet.</p>
            )}
          </section>

          <section className="ag-frame-sec">
            <div className="ag-frame-label">Where people stand</div>
            {people.length ? (
              <ul className="ag-frame-people">
                {people.map((p) => {
                  const mine = p.id === currentUserId;
                  return (
                    <li key={p.id} className="ag-frame-person">
                      <UserAvatar size={22} username={p.username || p.name} avatarUrl={p.avatarUrl} seed={p.id} />
                      <div>
                        <span className="ag-frame-name">
                          {p.name}
                          <span className="ag-frame-role">{ROLE_LABEL[p.role]}</span>
                        </span>
                        {mine && canSpeak ? (
                          <input
                            className="ag-frame-input"
                            value={line}
                            onChange={(e) => setLineDraft(e.target.value.slice(0, STANCE_MAX))}
                            onBlur={() => void saveLine()}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                            }}
                            placeholder="Your position, in a line"
                            maxLength={STANCE_MAX}
                            disabled={busy === "line"}
                          />
                        ) : (
                          <span className={`ag-frame-stance ${p.stance ? "" : "none"}`}>{p.stance?.text ?? "Hasn’t said yet"}</span>
                        )}
                      </div>
                      {p.stance && !mine && canFrame ? (
                        <button
                          type="button"
                          className="ag-frame-clear"
                          onClick={() => void clearLine(p.id)}
                          disabled={busy === "clear"}
                          title="Clear this line"
                          aria-label={`Clear ${p.name}'s line`}
                        >
                          ×
                        </button>
                      ) : (
                        <span />
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="ag-frame-empty">Nobody is on the stage yet.</p>
            )}
            {!canSpeak && empty && <p className="ag-frame-empty">Once the host sets the frame and speakers take a side, it shows here.</p>}
          </section>

          {error && (
            <section className="ag-frame-sec">
              <div className="ag-frame-err">{error}</div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function timeAgo(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}
