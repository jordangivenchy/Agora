"use client";

/* About this debate. The frame, what is being argued and on what terms,
   and one line per person on the stage saying where they stand.

   Two faces. A docked card under the top bar's actions keeps the frame
   on screen the whole time: the text, then the lines, compact, read-only.
   The full panel opens on the About button, or on the card, for editing
   (the host writes the frame with the communities' editor; people on
   the stage write their line) and for reading everything. The card can
   be hidden with its ×, remembered per device; phones start hidden. A
   dot on the button says the frame moved while nothing was showing.

   Changes ride on the room row, so the room's realtime subscription
   brings them to everyone in the room. */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import UserAvatar from "@/components/UserAvatar";
import RichEditor from "@/components/community/RichEditor";
import RichText from "@/components/community/RichText";
import { Icon } from "@/components/icons";
import { useMediaQuery } from "@/lib/media";
import type { RoomFraming } from "@/types/database";
import { ROLE_LABEL, type StageParticipant, type StageRole, isHostRole, onStage } from "./stage";
import { frameIsEmpty, frameLength, frameNewsKey, framePeople } from "./frameModel";

const ABOUT_MAX = 1200;
const STANCE_MAX = 200;

/* "Keep it on screen": one flag per device. */
const DOCK_KEY = "agora:frame-docked";
const dockListeners = new Set<() => void>();
function readDock(): string | null {
  try {
    return localStorage.getItem(DOCK_KEY);
  } catch {
    return null;
  }
}
function subscribeDock(cb: () => void) {
  dockListeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === DOCK_KEY) cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    dockListeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}
function writeDock(on: boolean) {
  try {
    localStorage.setItem(DOCK_KEY, on ? "1" : "0");
  } catch {
    /* private mode: the default stands for this visit */
  }
  dockListeners.forEach((l) => l());
}
const noDock = () => null;

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

  const phone = useMediaQuery("(max-width: 639px)");
  const storedDock = useSyncExternalStore(subscribeDock, readDock, noDock);
  const docked = storedDock === null ? !phone : storedDock === "1";

  const canFrame = isHostRole(myRole);
  const canSpeak = !!currentUserId && onStage(myRole);
  const me = useMemo(() => (currentUserId ? { id: currentUserId, role: myRole } : null), [currentUserId, myRole]);
  const people = useMemo(() => framePeople(participants, room, me), [participants, room, me]);

  const serverAbout = framing?.about ?? "";
  const about = aboutDraft ?? serverAbout;
  const aboutDirty = about.trim() !== serverAbout.trim();
  const aboutLen = frameLength(about);
  const aboutOver = aboutLen > ABOUT_MAX;
  const myStance = currentUserId ? (framing?.stances?.[currentUserId]?.text ?? "") : "";
  const line = lineDraft ?? myStance;
  const empty = frameIsEmpty(framing);

  /* The card shows while something is on screen to read, or the host
     still has to write it. Nothing showing → the button carries the dot. */
  const showCard = docked && !open && (canFrame || !empty);
  const hasNews = !open && !showCard && key !== seenKey;
  const openPanel = () => {
    setSeenKey(key);
    setOpen(true);
  };
  const close = () => {
    setSeenKey(key);
    setOpen(false);
  };
  const toggle = () => (open ? close() : openPanel());

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
    if (aboutOver) return;
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
  const said = people.filter((p) => p.stance);

  return (
    <div className="ag-frame-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`ag-about ${open ? "on" : ""}`}
        onClick={toggle}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="What this room is about, and where people stand"
      >
        <Icon name="info" size={14} />
        About
        {hasNews && <span className="ag-about-dot" aria-label="The frame changed" />}
      </button>

      {showCard && (
        <div className="ag-frame-dock" role="region" aria-label="About this room">
          <div className="ag-frame-dock-head">
            <span className="ag-frame-label">About this room</span>
            <span className="ag-frame-dock-tools">
              <button type="button" className="ag-frame-mini" onClick={openPanel} title={canFrame ? "Edit" : "Read it all"} aria-label={canFrame ? "Edit the frame" : "Open the whole frame"}>
                <Icon name={canFrame ? "pencil" : "maximize"} size={12} />
              </button>
              <button type="button" className="ag-frame-mini" onClick={() => writeDock(false)} title="Hide. The About button brings it back." aria-label="Hide the card">
                ×
              </button>
            </span>
          </div>
          {serverAbout.trim() ? (
            <button type="button" className="ag-frame-dock-body" onClick={openPanel} title="Open the whole frame">
              <RichText text={serverAbout} />
            </button>
          ) : (
            <button type="button" className="ag-frame-dock-empty" onClick={openPanel}>
              Set the frame, so people know what is being argued and on what terms.
            </button>
          )}
          {said.length > 0 && (
            <ul className="ag-frame-dock-people">
              {said.map((p) => (
                <li key={p.id} className="ag-frame-dock-person" title={`${p.name}: ${p.stance?.text ?? ""}`}>
                  <UserAvatar size={16} username={p.username || p.name} avatarUrl={p.avatarUrl} seed={p.id} />
                  <span className="ag-frame-dock-name">{p.name}</span>
                  <span className="ag-frame-dock-line">{p.stance?.text}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {open && (
        <div className="ag-frame" role="dialog" aria-label="About this room">
          <div className="ag-frame-head">
            <span>About this room</span>
            <span className="ag-frame-dock-tools">
              <button
                type="button"
                className={`ag-frame-mini ${docked ? "on" : ""}`}
                onClick={() => writeDock(!docked)}
                title={docked ? "Kept on screen. Click to hide it when this closes." : "Keep it on screen when this closes"}
                aria-pressed={docked}
                aria-label="Keep the frame on screen"
              >
                <Icon name={docked ? "pin" : "pin-off"} size={12} />
              </button>
              <button type="button" className="ag-frame-close" onClick={close} aria-label="Close">
                ×
              </button>
            </span>
          </div>

          <section className="ag-frame-sec">
            <div className="ag-frame-label">The frame</div>
            {canFrame ? (
              <>
                <div className="ag-frame-editor">
                  <RichEditor
                    compact
                    value={about}
                    onChange={setAboutDraft}
                    placeholder="What are we arguing? Set the question, the terms, and what's out of bounds."
                    onSubmit={() => void saveAbout()}
                    mentions={!!currentUserId}
                  />
                </div>
                <div className="ag-frame-row">
                  <span className={`ag-frame-hint ${aboutOver ? "over" : ""}`}>
                    {aboutLen}/{ABOUT_MAX}
                    {aboutOver ? " · too long" : framing?.about_at ? ` · set ${timeAgo(framing.about_at)}` : ""}
                  </span>
                  <button type="button" className="ag-frame-save" onClick={() => void saveAbout()} disabled={!aboutDirty || aboutOver || busy === "about"}>
                    {busy === "about" ? "Saving…" : "Save"}
                  </button>
                </div>
              </>
            ) : serverAbout.trim() ? (
              <>
                <div className="ag-frame-about">
                  <RichText text={serverAbout} />
                </div>
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
