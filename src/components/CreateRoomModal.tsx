"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { createClient } from "@/lib/supabase-browser";
import useEscapeClose from "@/lib/useEscapeClose";
import { TOPICS, LANGUAGES } from "@/types/database";
import { useRouter } from "next/navigation";
import { roomPath } from "@/lib/urls";
import { MAX_THUMB_BYTES, makeSquareThumb } from "@/lib/thumbs";

interface Props {
  open: boolean;
  onClose: () => void;
  /* Optional prefill (e.g. "Start debate" from the News tab). */
  initialMotion?: string;
  initialTopic?: string;
  /* Open with "Schedule for later" already on (the scheduled empty-state). */
  initialSchedule?: boolean;
  /* Community context ("Start a discussion" inside a Communities board) —
     the room is linked to the community and its members get notified. */
  communityId?: string;
  communityName?: string;
}

/* Format a Date as the local "YYYY-MM-DDTHH:mm" string that datetime-local
   expects (toISOString would UTC-shift the value which confuses users). */
function toLocalInputValue(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    d.getFullYear() +
    "-" + pad(d.getMonth() + 1) +
    "-" + pad(d.getDate()) +
    "T" + pad(d.getHours()) +
    ":" + pad(d.getMinutes())
  );
}

function defaultScheduleValue() {
  const d = new Date();
  d.setMinutes(d.getMinutes() + 60); // default: 1h from now
  d.setSeconds(0, 0);
  return toLocalInputValue(d);
}

export default function CreateRoomModal({ open, onClose, initialMotion, initialTopic, initialSchedule, communityId, communityName }: Props) {
  const router = useRouter();
  const supabase = createClient();
  useEscapeClose(open, onClose);

  const [motion, setMotion] = useState("");
  const [topicKey, setTopicKey] = useState("politics-law");
  const [language, setLanguage] = useState("en");

  // Prefill (News → "Start debate"; Topics → "Create a lobby" passes only
  // the field of study, no motion)
  useEffect(() => {
    if (open) {
      if (initialMotion) setMotion(initialMotion);
      if (initialTopic) setTopicKey(initialTopic);
      if (initialSchedule) setScheduleEnabled(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialMotion, initialTopic]);

  // Team sizes

  // Private rooms
  const [isPrivate, setIsPrivate] = useState(false);
  const [allowSpectators, setAllowSpectators] = useState(false);
  // Who can enter a private room without the invite code.
  const [accessMode, setAccessMode] = useState<"code" | "followers" | "friends" | "community">("code");

  // Scheduling
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduleAt, setScheduleAt] = useState<string>(defaultScheduleValue());

  /* Optional card thumbnail — when unset, cards show the host's profile
     picture. Uploaded after the room row exists (path is keyed on room id). */
  const [thumbFile, setThumbFile] = useState<File | null>(null);
  const [thumbPreview, setThumbPreview] = useState<string | null>(null);
  const thumbInputRef = useRef<HTMLInputElement | null>(null);

  const [loading, setLoading] = useState(false);
  const [navigating, setNavigating] = useState(false);
  const [error, setError] = useState("");

  // Post-create invite-code display (private rooms only)
  const [createdInvite, setCreatedInvite] = useState<{ code: string; roomId: string } | null>(null);
  const [copied, setCopied] = useState(false);

  // "Have an invite code?" — join someone else's private room by code.
  const [joinMode, setJoinMode] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [joinBusy, setJoinBusy] = useState(false);
  const [joinErr, setJoinErr] = useState<string | null>(null);

  // Reset every field when the modal closes so reopening is always a fresh
  // form. We intentionally key this off `open` rather than doing it in
  // onClose so parent-side dismissal (e.g. clicking the backdrop) also resets.
  useEffect(() => {
    if (!open && !navigating) {
      setMotion("");
      setTopicKey("politics-law");
      setLanguage("en");
      setIsPrivate(false);
      setAllowSpectators(false);
      setAccessMode("code");
      setScheduleEnabled(false);
      setScheduleAt(defaultScheduleValue());
      setThumbFile(null);
      setThumbPreview((p) => {
        if (p) URL.revokeObjectURL(p);
        return null;
      });
      setError("");
      setCreatedInvite(null);
      setCopied(false);
      setJoinMode(false);
      setJoinCode("");
      setJoinErr(null);
      setJoinBusy(false);
      setLoading(false);
    }
  }, [open, navigating]);

  if (!open && !navigating) return null;

  // Navigation spinner (seamless transition into /agora/[id])
  if (navigating) {
    return (
      <div
        className="fixed inset-0 z-[1000] flex items-center justify-center"
        style={{ background: "#0a0a0a" }}
      >
        <div
          className="animate-spin"
          style={{
            width: 32,
            height: 32,
            borderRadius: "50%",
            border: "2px solid var(--accent-blue)",
            borderTopColor: "transparent",
          }}
        />
      </div>
    );
  }


  async function handleCreate() {
    if (!motion.trim()) {
      setError("Please enter a motion or topic");
      return;
    }
    let scheduledIso: string | null = null;
    if (scheduleEnabled) {
      if (!scheduleAt) {
        setError("Pick a start time for the scheduled discussion");
        return;
      }
      const parsed = new Date(scheduleAt);
      if (isNaN(parsed.getTime())) {
        setError("That scheduled time is invalid");
        return;
      }
      if (parsed.getTime() <= Date.now() + 60_000) {
        setError("Scheduled time must be at least 1 minute from now");
        return;
      }
      scheduledIso = parsed.toISOString();
    }

    setLoading(true);
    setError("");

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setError("You must be signed in to create a room");
        setLoading(false);
        return;
      }

      // Single atomic RPC — creates the room AND inserts the host participant
      // in one transaction, so a network drop can never leave a zombie room.
      const { data: rows, error: rpcError } = await supabase.rpc("create_room", {
        p_motion:             motion.trim(),
        p_topic_key:          topicKey,
        p_language:           language,
        p_stance:             "PRO",
        p_is_private:         isPrivate,
        p_allow_spectators:   isPrivate ? allowSpectators : true,
        p_pro_size:           10,
        p_con_size:           10,
        p_time_limit_seconds: null,
        p_scheduled_start:    scheduledIso,
        p_community:          communityId ?? null,
        p_access_mode:        isPrivate ? (accessMode === "community" && !communityId ? "code" : accessMode) : "code",
      });

      if (rpcError) {
        const msg = rpcError.message || "";
        if (msg.includes("max_scheduled_rooms") || msg.includes("schedule at most 3")) {
          setError("You can only have 3 scheduled discussions at once. End or cancel one first.");
        } else if (msg.includes("scheduled_start_too_soon")) {
          setError("Scheduled time must be at least 1 minute from now.");
        } else {
          setError(msg || "Failed to create room");
        }
        setLoading(false);
        return;
      }

      // RPC returns a single-row table: [{ room_id, invite_code }]
      const row = Array.isArray(rows) ? rows[0] : rows;
      const roomId: string = row?.room_id;
      const inviteCode: string | null = row?.invite_code ?? null;

      if (!roomId) {
        setError("Room creation failed — no room ID returned.");
        setLoading(false);
        return;
      }

      // Best-effort thumbnail — cards fall back to the host's profile picture.
      if (thumbFile) {
        try {
          const blob = await makeSquareThumb(thumbFile);
          const path = `${user.id}/${roomId}.webp`;
          const { error: upErr } = await supabase.storage
            .from("thumbnails")
            .upload(path, blob, { upsert: true, cacheControl: "3600", contentType: "image/webp" });
          if (!upErr) {
            const { data: urlData } = supabase.storage.from("thumbnails").getPublicUrl(path);
            await supabase.from("debate_rooms").update({ thumbnail_url: urlData.publicUrl }).eq("id", roomId);
          }
        } catch {
          /* cosmetic — the room is already created */
        }
      }

      // For private rooms, show the invite code first; user presses Continue.
      if (isPrivate && inviteCode) {
        setCreatedInvite({ code: inviteCode, roomId });
        setLoading(false);
        return;
      }

      // For scheduled public rooms, close the modal and stay on home so the
      // host can see their scheduled room appear in the list. Navigating
      // straight into an empty room is disorienting before the start time.
      if (scheduledIso) {
        setLoading(false);
        onClose();
        return;
      }

      // Flip loading off before router.push so the button doesn't read
      // "Creating..." through the whole navigation — if anything goes wrong
      // during navigation, the user can see the action button and retry.
      setLoading(false);
      setNavigating(true);
      router.push(roomPath({ id: roomId, motion }));
      return;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to create room";
      setError(message);
      setLoading(false);
    }
  }

  async function handleJoinByCode() {
    const code = joinCode.trim().toUpperCase();
    if (code.length < 6 || joinBusy) return;
    setJoinBusy(true);
    setJoinErr(null);
    const { data: { user: me } } = await supabase.auth.getUser();
    if (!me) {
      setJoinBusy(false);
      setJoinErr("Sign in to use an invite code.");
      return;
    }
    const { data, error: rpcErr } = await supabase.rpc("join_private_room", {
      p_code: code,
      p_role: "spectator",
    });
    setJoinBusy(false);
    if (rpcErr) {
      const msg = rpcErr.message || "";
      setJoinErr(
        msg.includes("invalid_or_expired") ? "That code doesn't match a live room."
        : msg.includes("not_authenticated") ? "Sign in to use an invite code."
        : msg.includes("banned_from_room") ? "You've been removed from that room."
        : "Couldn't join with that code — try again.");
      return;
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.room_id) {
      setJoinErr("That code doesn't match a live room.");
      return;
    }
    onClose();
    router.push(`/agora/${row.room_id}`);
  }

  /* ──────────────────────────────────────────────────────────
     JOIN BY CODE: someone else's private room
     ────────────────────────────────────────────────────────── */
  if (joinMode) {
    return (
      <div
        className="fixed inset-0 z-[500] flex items-center justify-center p-5"
        style={{ background: "rgba(0,0,0,0.82)", backdropFilter: "blur(6px)", animation: "modalIn 0.2s ease" }}
        onClick={(e) => { if (e.target === e.currentTarget) setJoinMode(false); }}
      >
        <div
          className="w-full"
          style={{
            maxWidth: "400px",
            background: "rgba(18,18,21,0.95)",
            backdropFilter: "blur(24px)",
            border: "1px solid var(--border)",
            borderRadius: "20px",
            boxShadow: "0 24px 80px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.04)",
            padding: "28px 28px 24px",
            animation: "modalPanelIn 0.25s cubic-bezier(0.25, 0.46, 0.45, 0.94)",
          }}
        >
          <h2
            style={{
              fontFamily: "'DM Sans', sans-serif",
              fontSize: "20px",
              fontWeight: 700,
              letterSpacing: "-0.02em",
              color: "var(--text-primary)",
              marginBottom: "6px",
            }}
          >
            Join a private room
          </h2>
          <p style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: "18px", lineHeight: 1.5 }}>
            Enter the 6-character invite code the host shared with you.
          </p>
          <input
            value={joinCode}
            onChange={(e) => { setJoinCode(e.target.value); setJoinErr(null); }}
            onKeyDown={(e) => { if (e.key === "Enter") handleJoinByCode(); }}
            placeholder="ABC123"
            maxLength={6}
            autoFocus
            autoCapitalize="characters"
            spellCheck={false}
            className="outline-none w-full text-center uppercase"
            style={{
              padding: "13px 12px",
              background: "rgba(226,185,107,0.06)",
              border: `1px solid ${joinErr ? "rgba(239,68,68,0.5)" : "rgba(226,185,107,0.35)"}`,
              borderRadius: "14px",
              color: "#f5f5f0",
              fontFamily: "'DM Mono', monospace",
              fontSize: "24px",
              fontWeight: 700,
              letterSpacing: "0.3em",
            }}
          />
          {joinErr && (
            <p style={{ marginTop: "10px", fontSize: "12px", color: "#fca5a5" }}>{joinErr}</p>
          )}
          <div className="flex items-center justify-between" style={{ marginTop: "18px" }}>
            <button
              onClick={() => setJoinMode(false)}
              className="cursor-pointer"
              style={{
                background: "transparent", border: "none", color: "var(--text-muted)",
                fontFamily: "'DM Sans', sans-serif", fontSize: "13px", padding: "9px 4px",
              }}
            >
              ← Back
            </button>
            <button
              onClick={handleJoinByCode}
              disabled={joinBusy || joinCode.trim().length < 6}
              className="cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                background: "#d9a238", border: "none", color: "#2b1a02",
                fontFamily: "'DM Sans', sans-serif", fontSize: "13.5px", fontWeight: 600,
                padding: "10px 26px", borderRadius: "100px",
              }}
            >
              {joinBusy ? "Joining…" : "Join room"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ──────────────────────────────────────────────────────────
     POST-CREATE: invite-code screen for private rooms
     ────────────────────────────────────────────────────────── */
  if (createdInvite) {
    return (
      <div
        className="fixed inset-0 z-[500] flex items-center justify-center p-5"
        style={{
          background: "rgba(0,0,0,0.82)",
          backdropFilter: "blur(6px)",
          animation: "modalIn 0.2s ease",
        }}
      >
        <div
          className="w-full"
          style={{
            maxWidth: "440px",
            background: "rgba(18,18,21,0.95)",
            backdropFilter: "blur(24px)",
            border: "1px solid var(--border)",
            borderRadius: "20px",
            boxShadow: "0 24px 80px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.04)",
            padding: "28px 28px 22px",
            animation: "modalPanelIn 0.25s cubic-bezier(0.25, 0.46, 0.45, 0.94)",
          }}
        >
          <h2
            style={{
              fontFamily: "'DM Sans', sans-serif",
              fontSize: "20px",
              fontWeight: 700,
              letterSpacing: "-0.02em",
              color: "var(--text-primary)",
              marginBottom: "6px",
            }}
          >
            Private room created
          </h2>
          <p style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: "22px", lineHeight: 1.5 }}>
            {accessMode === "followers"
              ? "Your followers can enter straight from the room link — share this code with anyone else you want to let in."
              : accessMode === "friends"
                ? "Your friends can enter straight from the room link — share this code with anyone else you want to let in."
                : "Share this code with the people you want to invite. They can enter it via “Have an invite code?” in the Create menu, or right on the room's door screen."}
          </p>

          <div
            className="flex items-center justify-between"
            style={{
              background: "rgba(226,185,107,0.06)",
              border: "1px solid rgba(226,185,107,0.35)",
              borderRadius: "14px",
              padding: "18px 20px",
              marginBottom: "18px",
            }}
          >
            <span
              style={{
                fontFamily: "'DM Mono', monospace",
                fontSize: "26px",
                fontWeight: 700,
                letterSpacing: "0.22em",
                color: "#ffdd85",
              }}
            >
              {createdInvite.code}
            </span>
            <button
              onClick={async () => {
                await navigator.clipboard.writeText(createdInvite.code);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              className="cursor-pointer transition-all"
              style={{
                background: "rgba(226,185,107,0.14)",
                border: "1px solid rgba(226,185,107,0.45)",
                color: "#ffdd85",
                fontFamily: "'DM Sans', sans-serif",
                fontSize: "12px",
                fontWeight: 600,
                padding: "8px 14px",
                borderRadius: "100px",
              }}
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>

          <div
            className="text-xs mb-5"
            style={{
              padding: "10px 12px",
              borderRadius: "10px",
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.06)",
              color: "var(--text-muted)",
              lineHeight: 1.5,
            }}
          >
            {allowSpectators
              ? "This room will appear in public listings marked “Private”. Anyone can watch as a spectator, but only invited users can speak."
              : "This room is fully hidden — it won't appear anywhere. Only people with the code can enter."}
          </div>

          <button
            onClick={() => {
              if (scheduleEnabled) {
                // Scheduled + private: skip immediate navigation. Just close.
                onClose();
              } else {
                setNavigating(true);
                router.push(`/agora/${createdInvite.roomId}`);
              }
            }}
            className="w-full cursor-pointer transition-all"
            style={{
              background: "var(--accent-blue)",
              border: "none",
              color: "#fff",
              fontFamily: "'DM Sans', sans-serif",
              fontSize: "14px",
              fontWeight: 600,
              padding: "12px 20px",
              borderRadius: "100px",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--accent-purple-light)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "var(--accent-blue)";
            }}
          >
            {scheduleEnabled ? "Done" : "Enter room"}
          </button>
        </div>
      </div>
    );
  }

  /* ──────────────────────────────────────────────────────────
     MAIN CREATE FORM
     ────────────────────────────────────────────────────────── */
  return (
    <div
      className="fixed inset-0 z-[500] flex items-center justify-center p-5"
      style={{
        background: "rgba(0,0,0,0.78)",
        backdropFilter: "blur(4px)",
        animation: "modalIn 0.2s ease",
      }}
      onClick={onClose}
    >
      <div
        className="w-full overflow-y-auto"
        style={{
          maxWidth: "540px",
          maxHeight: "92vh",
          background: "rgba(18,18,21,0.95)",
          backdropFilter: "blur(24px)",
          border: "1px solid var(--border)",
          borderRadius: "20px",
          boxShadow: "0 24px 80px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.04)",
          animation: "modalPanelIn 0.25s cubic-bezier(0.25, 0.46, 0.45, 0.94)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between"
          style={{ padding: "20px 24px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}
        >
          <h2
            style={{
              fontFamily: "'DM Sans', sans-serif",
              fontSize: "18px",
              fontWeight: 700,
              letterSpacing: "-0.02em",
              color: "var(--text-primary)",
            }}
          >
            Start a discussion
          </h2>
          <button
            onClick={onClose}
            className="flex items-center justify-center cursor-pointer transition-all"
            style={{
              width: 28,
              height: 28,
              borderRadius: "8px",
              color: "var(--text-muted)",
              background: "rgba(255,255,255,0.04)",
              border: "1px solid var(--border)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "var(--text-primary)";
              e.currentTarget.style.background = "rgba(255,255,255,0.08)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "var(--text-muted)";
              e.currentTarget.style.background = "rgba(255,255,255,0.04)";
            }}
          >
            <Icon name="x" size={13} />
          </button>
        </div>

        <div style={{ padding: "20px 24px 24px" }}>
          <div className="flex flex-col gap-5">
            {error && (
              <div
                className="text-sm rounded-lg px-4 py-2"
                style={{
                  background: "rgba(239,68,68,0.08)",
                  border: "1px solid rgba(239,68,68,0.3)",
                  color: "#fca5a5",
                }}
              >
                {error}
              </div>
            )}

            {/* Motion */}
            <FieldGroup label="Topic">
              <input
                type="text"
                value={motion}
                onChange={(e) => setMotion(e.target.value)}
                placeholder="State the motion or topic..."
                className="w-full outline-none transition-all"
                style={{
                  padding: "10px 13px",
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: "10px",
                  color: "rgba(255,255,255,0.82)",
                  fontSize: "13px",
                  fontFamily: "'DM Sans', sans-serif",
                }}
                maxLength={300}
              />
            </FieldGroup>

            {/* Category */}
            <FieldGroup label="Category">
              <div className="flex flex-wrap gap-2">
                {TOPICS.map((t) => (
                  <PillSelect
                    key={t.key}
                    label={`${t.emoji} ${t.label}`}
                    active={topicKey === t.key}
                    onClick={() => setTopicKey(t.key)}
                    activeColor={t.color}
                  />
                ))}
              </div>
            </FieldGroup>

            {/* Language */}
            <FieldGroup label="Language">
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="w-full outline-none"
                style={{
                  padding: "10px 13px",
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: "10px",
                  color: "rgba(255,255,255,0.82)",
                  fontSize: "13px",
                  fontFamily: "'DM Sans', sans-serif",
                }}
              >
                {LANGUAGES.map((l) => (
                  <option key={l.value} value={l.value}>{l.label}</option>
                ))}
              </select>
            </FieldGroup>

            {/* Schedule */}
            <div
              style={{
                background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: "14px",
                padding: "12px 14px",
              }}
            >
              {communityId && (
                <p
                  className="m-0 mb-2 px-3 py-2 rounded-lg text-[11.5px]"
                  style={{
                    background: "rgba(201,176,106,0.08)",
                    border: "1px solid rgba(201,176,106,0.25)",
                    color: "#c9b06a",
                  }}
                >
                  <Icon name="landmark" size={13} /> This discussion belongs to <strong>{communityName ?? "your community"}</strong> — members
                  will be notified.
                </p>
              )}
              <Toggle label="Schedule for later" checked={scheduleEnabled} onChange={setScheduleEnabled} />
              {scheduleEnabled && (
                <>
                  <div
                    style={{
                      margin: "10px 0",
                      height: 1,
                      background: "rgba(255,255,255,0.05)",
                    }}
                  />
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      style={{
                        fontSize: "11px",
                        fontWeight: 600,
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                        color: "rgba(255,255,255,0.4)",
                      }}
                    >
                      Starts at
                    </span>
                    <input
                      type="datetime-local"
                      value={scheduleAt}
                      onChange={(e) => setScheduleAt(e.target.value)}
                      className="outline-none"
                      style={{
                        padding: "8px 10px",
                        background: "rgba(255,255,255,0.04)",
                        border: "1px solid rgba(255,255,255,0.08)",
                        borderRadius: "10px",
                        color: "rgba(255,255,255,0.85)",
                        fontSize: "13px",
                        fontFamily: "'DM Mono', monospace",
                        colorScheme: "dark",
                      }}
                    />
                  </div>
                  <p
                    style={{
                      marginTop: "8px",
                      fontSize: "11px",
                      lineHeight: 1.5,
                      color: "var(--text-dim)",
                    }}
                  >
                    Scheduled discussions appear on Explore under the Scheduled filter. People can queue up, but the room only goes live when you hit Start.
                    {" "}You can have at most 3 scheduled at once.
                  </p>
                </>
              )}
            </div>

            {/* Thumbnail */}
            <div
              style={{
                background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: "14px",
                padding: "12px 14px",
              }}
            >
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => thumbInputRef.current?.click()}
                  className="cursor-pointer shrink-0 overflow-hidden"
                  title={thumbPreview ? "Change thumbnail" : "Add a thumbnail"}
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: "12px",
                    background: "rgba(255,255,255,0.04)",
                    border: "1px dashed rgba(255,255,255,0.18)",
                    color: "rgba(255,255,255,0.5)",
                    fontSize: 20,
                    lineHeight: 1,
                    padding: 0,
                  }}
                >
                  {thumbPreview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumbPreview} alt="Thumbnail preview" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                  ) : (
                    "+"
                  )}
                </button>
                <div className="flex-1">
                  <p style={{ fontSize: "12.5px", fontWeight: 600, color: "rgba(255,255,255,0.75)" }}>
                    Thumbnail
                  </p>
                  <p style={{ marginTop: 2, fontSize: "11px", lineHeight: 1.5, color: "var(--text-dim)" }}>
                    Optional cover for your room&rsquo;s card — defaults to your profile picture.
                  </p>
                </div>
                {thumbPreview && (
                  <button
                    type="button"
                    onClick={() => {
                      setThumbFile(null);
                      setThumbPreview((p) => {
                        if (p) URL.revokeObjectURL(p);
                        return null;
                      });
                      if (thumbInputRef.current) thumbInputRef.current.value = "";
                    }}
                    className="cursor-pointer shrink-0"
                    style={{
                      fontSize: "11px",
                      padding: "6px 10px",
                      borderRadius: "8px",
                      background: "rgba(255,255,255,0.04)",
                      border: "1px solid var(--border)",
                      color: "var(--text-muted)",
                    }}
                  >
                    Remove
                  </button>
                )}
                <input
                  ref={thumbInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (file.size > MAX_THUMB_BYTES) {
                      setError("Thumbnail is too large — 5 MB max.");
                      return;
                    }
                    setError("");
                    setThumbFile(file);
                    setThumbPreview((p) => {
                      if (p) URL.revokeObjectURL(p);
                      return URL.createObjectURL(file);
                    });
                  }}
                />
              </div>
            </div>

            {/* Private Room */}
            <div
              style={{
                background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: "14px",
                padding: "12px 14px",
              }}
            >
              <Toggle label="Private Room" checked={isPrivate} onChange={setIsPrivate} />
              {isPrivate && (
                <>
                  <div
                    style={{
                      margin: "10px 0 10px",
                      height: 1,
                      background: "rgba(255,255,255,0.05)",
                    }}
                  />
                  <div style={{ marginBottom: 10 }}>
                    <span
                      style={{
                        display: "block",
                        marginBottom: 8,
                        fontSize: "11px",
                        fontWeight: 600,
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                        color: "rgba(255,255,255,0.4)",
                      }}
                    >
                      Who can enter
                    </span>
                    <div className="flex flex-wrap gap-2">
                      <PillSelect
                        label="Invite code"
                        active={accessMode === "code"}
                        onClick={() => setAccessMode("code")}
                        activeColor="#2f7fe0"
                      />
                      <PillSelect
                        label="My followers"
                        active={accessMode === "followers"}
                        onClick={() => setAccessMode("followers")}
                        activeColor="#2f7fe0"
                      />
                      <PillSelect
                        label="Friends only"
                        active={accessMode === "friends"}
                        onClick={() => setAccessMode("friends")}
                        activeColor="#2f7fe0"
                      />
                      {communityId && (
                        <PillSelect
                          label={`${communityName ?? "Board"} members`}
                          active={accessMode === "community"}
                          onClick={() => setAccessMode("community")}
                          activeColor="#2f7fe0"
                        />
                      )}
                    </div>
                  </div>
                  {accessMode === "code" && (
                    <Toggle
                      label="Allow spectators to watch"
                      checked={allowSpectators}
                      onChange={setAllowSpectators}
                    />
                  )}
                  <p
                    style={{
                      marginTop: "8px",
                      fontSize: "11px",
                      lineHeight: 1.5,
                      color: "var(--text-dim)",
                    }}
                  >
                    {accessMode === "followers"
                      ? "Hidden from listings and search. Anyone who follows you can enter directly; your invite code also works for anyone else."
                      : accessMode === "friends"
                        ? "Hidden from listings and search. Only friends (people you follow back) can enter directly; your invite code also works for anyone else."
                      : accessMode === "community"
                        ? `Hidden from listings and search. Only members of ${communityName ?? "the community"} can enter directly; your invite code also works for anyone else.`
                        : allowSpectators
                          ? "Room will appear in public listings tagged “Private”. Visitors join as spectators only; speakers must use the invite code."
                          : "Room is completely hidden from all listings and search. Only people with the invite code can enter."}
                  </p>
                </>
              )}
            </div>

            {/* Footer */}
            <div
              className="flex items-center justify-between pt-4"
              style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}
            >
              <button
                onClick={() => setJoinMode(true)}
                className="cursor-pointer"
                style={{
                  background: "transparent",
                  border: "none",
                  color: "var(--text-muted)",
                  fontFamily: "'DM Sans', sans-serif",
                  fontSize: "12.5px",
                  padding: "9px 4px",
                  textDecoration: "underline",
                  textUnderlineOffset: "3px",
                }}
              >
                Have an invite code?
              </button>
              <button
                onClick={handleCreate}
                disabled={loading || !motion.trim()}
                className="cursor-pointer transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  background: "var(--accent-blue)",
                  border: "none",
                  color: "#fff",
                  fontFamily: "'DM Sans', sans-serif",
                  fontSize: "13.5px",
                  fontWeight: 600,
                  padding: "10px 24px",
                  borderRadius: "100px",
                }}
                onMouseEnter={(e) => {
                  if (!e.currentTarget.disabled)
                    e.currentTarget.style.background = "var(--accent-purple-light)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "var(--accent-blue)";
                }}
              >
                {loading
                  ? "Creating…"
                  : scheduleEnabled
                  ? "Schedule discussion"
                  : "Create room"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Helpers ─── */

function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label
        className="block mb-2"
        style={{
          fontSize: "11px",
          fontWeight: 600,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "rgba(255,255,255,0.4)",
        }}
      >
        {label}
      </label>
      {children}
    </div>
  );
}

function PillSelect({
  label,
  active,
  onClick,
  activeColor,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  activeColor?: string;
}) {
  return (
    <button
      onClick={onClick}
      className="cursor-pointer transition-all"
      style={{
        padding: "6px 14px",
        borderRadius: "100px",
        fontSize: "12px",
        fontWeight: 500,
        fontFamily: "'DM Sans', sans-serif",
        /* Solid fills — no translucency, matching the site's pill system. */
        background: active
          ? activeColor || "var(--accent-purple)"
          : "#2a2a32",
        border: "none",
        color: active ? "white" : "#c9c9d2",
      }}
    >
      {label}
    </button>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between cursor-pointer">
      <span style={{ fontSize: "13px", color: "var(--text-primary)" }}>{label}</span>
      <div
        onClick={() => onChange(!checked)}
        className="relative transition-colors"
        style={{
          width: "36px",
          height: "18px",
          borderRadius: "100px",
          background: checked ? "var(--accent-purple)" : "rgba(255,255,255,0.08)",
          border: checked ? "none" : "1px solid rgba(255,255,255,0.1)",
        }}
      >
        <div
          className="absolute rounded-full bg-white transition-transform"
          style={{
            top: "2px",
            width: "14px",
            height: "14px",
            transform: checked ? "translateX(19px)" : "translateX(2px)",
          }}
        />
      </div>
    </label>
  );
}

function StepperBtn({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="cursor-pointer transition-all disabled:opacity-30 disabled:cursor-not-allowed"
      style={{
        width: "26px",
        height: "26px",
        borderRadius: "8px",
        background: "rgba(255,255,255,0.05)",
        border: "1px solid rgba(255,255,255,0.1)",
        color: "var(--text-primary)",
        fontFamily: "'DM Sans', sans-serif",
        fontSize: "15px",
        fontWeight: 600,
        lineHeight: 1,
      }}
    >
      {children}
    </button>
  );
}
