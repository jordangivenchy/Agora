"use client";

/* About this room: what the call is about, written by the host.

   Two faces. A docked card under the top bar's actions keeps it on
   screen the whole time, compact and read-only. The full panel opens on
   the About button, or on the card, for writing it (the host, with the
   communities' editor) and for reading all of it. The card can be hidden
   with its ×, remembered per device; phones start hidden. A dot on the
   button says it changed while nothing was showing.

   Changes ride on the room row (framing.about, set_room_frame), so the
   room's realtime subscription brings them to everyone in the room. */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import RichEditor from "@/components/community/RichEditor";
import RichText from "@/components/community/RichText";
import { BODY_MIN, cleanTextError } from "@/lib/cleanText";
import { Icon } from "@/components/icons";
import { useMediaQuery } from "@/lib/media";
import { displayName } from "@/lib/names";
import type { RoomFraming } from "@/types/database";
import { type StageParticipant, type StageRole, isHostRole } from "./stage";
import { FRAME_MAX_LINES, frameIsEmpty, frameLength, frameLines, frameNewsKey } from "./frameModel";

const ABOUT_MAX = 1200;

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
  /* What I last looked at; the dot shows when the description changed since. */
  const [seenKey, setSeenKey] = useState(key);
  /* The draft is null while I'm not editing, so what arrives shows through. */
  const [aboutDraft, setAboutDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const phone = useMediaQuery("(max-width: 639px)");
  const storedDock = useSyncExternalStore(subscribeDock, readDock, noDock);
  const docked = storedDock === null ? !phone : storedDock === "1";

  const canWrite = isHostRole(myRole);
  const serverAbout = framing?.about ?? "";
  const about = aboutDraft ?? serverAbout;
  const aboutDirty = about.trim() !== serverAbout.trim();
  const aboutLen = frameLength(about);
  const aboutLines = frameLines(about);
  const aboutTooLong = aboutLen > ABOUT_MAX;
  const aboutTooTall = aboutLines > FRAME_MAX_LINES;
  const aboutOver = aboutTooLong || aboutTooTall;
  const empty = frameIsEmpty(framing);

  /* The card shows while there's something to read, or the host still has
     to write it. Nothing showing → the button carries the dot. */
  const showCard = docked && !open && (canWrite || !empty);
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

  const saveAbout = useCallback(async () => {
    if (aboutOver) return;
    const issue = cleanTextError(about, BODY_MIN);
    if (issue) {
      setError(issue);
      return;
    }
    setBusy(true);
    setError(null);
    const { data, error: err } = await supabase.rpc("set_room_frame", { p_room: room.id, p_about: about.trim() });
    setBusy(false);
    if (err) {
      setError(err.message.replace(/^.*?:\s*/, ""));
      return;
    }
    if (data && typeof data === "object") onChange(data as RoomFraming);
    setAboutDraft(null);
  }, [about, aboutOver, supabase, room.id, onChange]);

  const writer = framing?.about_by ? participants.find((p) => p.user_id === framing.about_by) : null;
  const writerName = writer ? displayName(writer.user) || writer.user?.username || "the host" : "the host";

  return (
    <div className="ag-frame-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`ag-about ${open ? "on" : ""}`}
        onClick={toggle}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="What this room is about"
      >
        <Icon name="info" size={14} />
        About
        {hasNews && <span className="ag-about-dot" aria-label="Updated" />}
      </button>

      {showCard && (
        <div className="ag-frame-dock" role="region" aria-label="About this room">
          <div className="ag-frame-dock-head">
            <span className="ag-frame-label">About this room</span>
            <span className="ag-frame-dock-tools">
              <button type="button" className="ag-frame-mini" onClick={openPanel} title={canWrite ? "Edit" : "Read it all"} aria-label={canWrite ? "Edit" : "Read it all"}>
                <Icon name={canWrite ? "pencil" : "maximize"} size={12} />
              </button>
              <button type="button" className="ag-frame-mini" onClick={() => writeDock(false)} title="Hide. The About button brings it back." aria-label="Hide the card">
                ×
              </button>
            </span>
          </div>
          {serverAbout.trim() ? (
            <button type="button" className="ag-frame-dock-body" onClick={openPanel} title="Read it all">
              <RichText text={serverAbout} />
            </button>
          ) : (
            <button type="button" className="ag-frame-dock-empty" onClick={openPanel}>
              Say what this room is about.
            </button>
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
                aria-label="Keep it on screen"
              >
                <Icon name={docked ? "pin" : "pin-off"} size={12} />
              </button>
              <button type="button" className="ag-frame-close" onClick={close} aria-label="Close">
                ×
              </button>
            </span>
          </div>

          <section className="ag-frame-sec">
            {canWrite ? (
              <>
                <div className="ag-frame-editor">
                  <RichEditor
                    compact
                    value={about}
                    onChange={setAboutDraft}
                    placeholder="What's this room about?"
                    onSubmit={() => void saveAbout()}
                    mentions={!!currentUserId}
                  />
                </div>
                <div className="ag-frame-row">
                  <span className={`ag-frame-hint ${aboutOver ? "over" : ""}`}>
                    {aboutLen}/{ABOUT_MAX} · {aboutLines}/{FRAME_MAX_LINES} lines
                    {aboutTooLong ? " · too long" : aboutTooTall ? " · too many lines" : framing?.about_at ? ` · updated ${timeAgo(framing.about_at)}` : ""}
                  </span>
                  <button type="button" className="ag-frame-save" onClick={() => void saveAbout()} disabled={!aboutDirty || aboutOver || busy}>
                    {busy ? "Saving…" : "Save"}
                  </button>
                </div>
              </>
            ) : serverAbout.trim() ? (
              <>
                <div className="ag-frame-about">
                  <RichText text={serverAbout} />
                </div>
                <div className="ag-frame-meta">
                  Written by {writerName}
                  {framing?.about_at ? ` · ${timeAgo(framing.about_at)}` : ""}
                </div>
              </>
            ) : (
              <p className="ag-frame-empty">The host hasn&rsquo;t written anything yet.</p>
            )}
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
