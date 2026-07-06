"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { TOPICS, LANGUAGES } from "@/types/database";
import type { Stance } from "@/types/database";
import { useRouter } from "next/navigation";

interface Props {
  open: boolean;
  onClose: () => void;
  /* Optional prefill (e.g. "Start debate" from the News tab). */
  initialMotion?: string;
  initialTopic?: string;
}

/* Agora Stoa format variants — each maps onto the base room shape the
   create_room RPC understands; the variant itself is stored in room_meta
   (best-effort: skipped silently until the migration has run). */
const FORMAT_VARIANTS: { key: string | null; label: string; desc: string; pro?: number; con?: number; isNew?: boolean }[] = [
  { key: null, label: "Classic", desc: "Standard debate" },
  { key: "steelman", label: "Steelman round", desc: "Argue their side first", pro: 1, con: 1, isNew: true },
  { key: "blitz", label: "Blitz ⚡", desc: "90-second bursts", pro: 1, con: 1, isNew: true },
  { key: "town-hall", label: "Town hall", desc: "Audience Q&A", pro: 1, con: 1, isNew: true },
  { key: "fishbowl", label: "Fishbowl", desc: "Tap in, swap seats", pro: 2, con: 2, isNew: true },
  { key: "devils-advocate", label: "Devil's advocate", desc: "Random side assigned", pro: 1, con: 1, isNew: true },
  { key: "1v20", label: "1v20 panel", desc: "Jubilee-style gauntlet", pro: 1, con: 4, isNew: true },
];

const CURRICULA: { key: string; label: string; desc: string }[] = [
  { key: "agora-general", label: "Agora General", desc: "Clarity · evidence · rebuttal · delivery · conduct" },
  { key: "nsda-ld", label: "NSDA Lincoln-Douglas", desc: "30-pt speaker scale · values clash" },
  { key: "nsda-pf", label: "NSDA Public Forum", desc: "Evidence · teamwork · final focus" },
  { key: "bp", label: "British Parliamentary", desc: "Matter · manner · method (WUDC)" },
  { key: "oxford", label: "Oxford Union", desc: "Audience swing decides winner" },
  { key: "mun", label: "MUN Delegate", desc: "Position papers · blocs · resolutions" },
  { key: "moot-court", label: "Moot Court", desc: "Precedent · judicial questioning" },
];

type TimeLimitChoice = "none" | "2" | "5" | "10" | "custom";

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

export default function CreateRoomModal({ open, onClose, initialMotion, initialTopic }: Props) {
  const router = useRouter();
  const supabase = createClient();

  const [motion, setMotion] = useState("");
  const [topicKey, setTopicKey] = useState("politics-law");
  const [language, setLanguage] = useState("en");
  const [stance, setStance] = useState<Stance>("PRO");

  // Time limit
  const [timeChoice, setTimeChoice] = useState<TimeLimitChoice>("none");
  const [customMinutes, setCustomMinutes] = useState<number>(3);

  // Agora Stoa: format variant + AI scoring curriculum
  const [formatVariant, setFormatVariant] = useState<string | null>(null);
  const [curriculum, setCurriculum] = useState("agora-general");

  // Prefill (News → "Start debate")
  useEffect(() => {
    if (open && initialMotion) {
      setMotion(initialMotion);
      if (initialTopic) setTopicKey(initialTopic);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialMotion, initialTopic]);

  // Team sizes
  const [proSize, setProSize] = useState(1);
  const [conSize, setConSize] = useState(1);

  // Private rooms
  const [isPrivate, setIsPrivate] = useState(false);
  const [allowSpectators, setAllowSpectators] = useState(false);

  // Scheduling
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduleAt, setScheduleAt] = useState<string>(defaultScheduleValue());

  const [loading, setLoading] = useState(false);
  const [navigating, setNavigating] = useState(false);
  const [error, setError] = useState("");

  // Post-create invite-code display (private rooms only)
  const [createdInvite, setCreatedInvite] = useState<{ code: string; roomId: string } | null>(null);
  const [copied, setCopied] = useState(false);

  // Reset every field when the modal closes so reopening is always a fresh
  // form. We intentionally key this off `open` rather than doing it in
  // onClose so parent-side dismissal (e.g. clicking the backdrop) also resets.
  useEffect(() => {
    if (!open && !navigating) {
      setMotion("");
      setTopicKey("politics-law");
      setLanguage("en");
      setStance("PRO");
      setTimeChoice("none");
      setCustomMinutes(3);
      setProSize(1);
      setConSize(1);
      setIsPrivate(false);
      setAllowSpectators(false);
      setScheduleEnabled(false);
      setScheduleAt(defaultScheduleValue());
      setFormatVariant(null);
      setCurriculum("agora-general");
      setError("");
      setCreatedInvite(null);
      setCopied(false);
      setLoading(false);
    }
  }, [open, navigating]);

  if (!open && !navigating) return null;

  // Navigation spinner (seamless transition into /rooms/[id])
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

  function timeLimitSecondsForChoice(): number | null {
    if (timeChoice === "none") return null;
    if (timeChoice === "custom") {
      const m = Math.max(1, Math.min(60, Math.floor(customMinutes || 0)));
      return m * 60;
    }
    return parseInt(timeChoice, 10) * 60;
  }

  function adjustSize(side: "pro" | "con", delta: number) {
    if (side === "pro") {
      const next = Math.max(1, Math.min(19, proSize + delta));
      if (next + conSize <= 20) setProSize(next);
    } else {
      const next = Math.max(1, Math.min(19, conSize + delta));
      if (next + proSize <= 20) setConSize(next);
    }
  }

  async function handleCreate() {
    if (!motion.trim()) {
      setError("Please enter a motion or topic");
      return;
    }
    if (proSize + conSize > 20) {
      setError("Total debaters can't exceed 20");
      return;
    }

    let scheduledIso: string | null = null;
    if (scheduleEnabled) {
      if (!scheduleAt) {
        setError("Pick a start time for the scheduled debate");
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

      const timeLimitSeconds = timeLimitSecondsForChoice();

      // Single atomic RPC — creates the room AND inserts the host participant
      // in one transaction, so a network drop can never leave a zombie room.
      const { data: rows, error: rpcError } = await supabase.rpc("create_room", {
        p_motion:             motion.trim(),
        p_topic_key:          topicKey,
        p_language:           language,
        p_stance:             stance,
        p_is_private:         isPrivate,
        p_allow_spectators:   isPrivate ? allowSpectators : true,
        p_pro_size:           proSize,
        p_con_size:           conSize,
        p_time_limit_seconds: timeLimitSeconds,
        p_scheduled_start:    scheduledIso,
      });

      if (rpcError) {
        const msg = rpcError.message || "";
        if (msg.includes("max_scheduled_rooms") || msg.includes("schedule at most 3")) {
          setError("You can only have 3 scheduled debates at once. End or cancel one first.");
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

      // Best-effort: persist format variant + curriculum. Silently skipped
      // when the Agora Stoa migration hasn't been run yet.
      if (formatVariant || curriculum !== "agora-general") {
        await supabase
          .from("room_meta")
          .insert({ room_id: roomId, format_variant: formatVariant, curriculum });
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
      router.push(`/rooms/${roomId}`);
      return;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to create room";
      setError(message);
      setLoading(false);
    }
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
            Share this code with the people you want to invite. They can enter it from the
            &ldquo;Join Private&rdquo; button next to Create.
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
              ? "This room will appear in public listings marked “Private”. Anyone can watch as a spectator, but only invited users can debate."
              : "This room is fully hidden — it won't appear anywhere. Only people with the code can enter."}
          </div>

          <button
            onClick={() => {
              if (scheduleEnabled) {
                // Scheduled + private: skip immediate navigation. Just close.
                onClose();
              } else {
                setNavigating(true);
                router.push(`/rooms/${createdInvite.roomId}`);
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
  const timeOptions: { value: TimeLimitChoice; label: string }[] = [
    { value: "none", label: "None" },
    { value: "2", label: "2 min" },
    { value: "5", label: "5 min" },
    { value: "10", label: "10 min" },
    { value: "custom", label: "Custom" },
  ];

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
            Create a Debate
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
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
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
            <FieldGroup label="Motion / Topic">
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

            {/* Position */}
            <FieldGroup label="Your Position">
              <div className="flex gap-2">
                {(["PRO", "CON"] as Stance[]).map((s) => (
                  <PillSelect
                    key={s}
                    label={s}
                    active={stance === s}
                    onClick={() => setStance(s)}
                    activeColor={s === "PRO" ? "var(--pro-color)" : "var(--con-color)"}
                  />
                ))}
              </div>
            </FieldGroup>

            {/* Format variant (Agora Stoa) */}
            <FieldGroup label="Format">
              <div className="grid gap-1.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(148px, 1fr))" }}>
                {FORMAT_VARIANTS.map((f) => (
                  <button
                    key={f.key ?? "classic"}
                    type="button"
                    onClick={() => {
                      setFormatVariant(f.key);
                      if (f.pro) setProSize(f.pro);
                      if (f.con) setConSize(f.con);
                      if (f.key === "devils-advocate") setStance(Math.random() < 0.5 ? "PRO" : "CON");
                      if (f.key === "blitz") { setTimeChoice("2"); }
                    }}
                    className="cursor-pointer text-left rounded-lg px-2.5 py-2 transition-all"
                    style={{
                      background: formatVariant === f.key ? "rgba(74,158,255,0.12)" : "rgba(255,255,255,0.03)",
                      border: formatVariant === f.key ? "1px solid var(--accent-blue)" : "1px solid var(--border)",
                    }}
                  >
                    <span className="block text-[12px]" style={{ color: "var(--text-primary)" }}>
                      {f.label}
                      {f.isNew && (
                        <span
                          className="ml-1.5 text-[8px] font-medium px-1.5 py-px rounded-full align-middle"
                          style={{ background: "linear-gradient(135deg,#f7e3a0,#d9a238)", color: "#412402" }}
                        >
                          NEW
                        </span>
                      )}
                    </span>
                    <span className="block text-[10px]" style={{ color: "var(--text-muted)" }}>{f.desc}</span>
                  </button>
                ))}
              </div>
            </FieldGroup>

            {/* Team sizes */}
            <FieldGroup label={`Debaters — ${proSize}v${conSize} · ${proSize + conSize} total`}>
              <div
                className="flex items-stretch gap-3"
                style={{
                  background: "rgba(255,255,255,0.02)",
                  border: "1px solid rgba(255,255,255,0.06)",
                  borderRadius: "14px",
                  padding: "10px 12px",
                }}
              >
                <SideStepper
                  label="PRO"
                  color="var(--pro-color)"
                  value={proSize}
                  onDec={() => adjustSize("pro", -1)}
                  onInc={() => adjustSize("pro", +1)}
                  incDisabled={proSize + conSize >= 20 || proSize >= 19}
                />
                <div
                  className="flex items-center justify-center"
                  style={{
                    color: "rgba(255,255,255,0.25)",
                    fontFamily: "'DM Sans', sans-serif",
                    fontSize: "12px",
                    fontWeight: 700,
                    letterSpacing: "0.14em",
                  }}
                >
                  VS
                </div>
                <SideStepper
                  label="CON"
                  color="var(--con-color)"
                  value={conSize}
                  onDec={() => adjustSize("con", -1)}
                  onInc={() => adjustSize("con", +1)}
                  incDisabled={proSize + conSize >= 20 || conSize >= 19}
                />
              </div>
            </FieldGroup>

            {/* Time Limit per Speaker */}
            <FieldGroup label="Time Limit per Speaker">
              <div className="flex flex-wrap gap-2 items-center">
                {timeOptions.map((opt) => (
                  <PillSelect
                    key={opt.value}
                    label={opt.label}
                    active={timeChoice === opt.value}
                    onClick={() => setTimeChoice(opt.value)}
                  />
                ))}
                {timeChoice === "custom" && (
                  <div
                    className="flex items-center gap-1.5"
                    style={{
                      marginLeft: "4px",
                      padding: "4px 8px 4px 10px",
                      background: "rgba(255,255,255,0.04)",
                      border: "1px solid rgba(255,255,255,0.08)",
                      borderRadius: "100px",
                    }}
                  >
                    <input
                      type="number"
                      min={1}
                      max={60}
                      value={customMinutes}
                      onChange={(e) => setCustomMinutes(Number(e.target.value))}
                      className="outline-none bg-transparent text-center"
                      style={{
                        width: "42px",
                        color: "var(--text-primary)",
                        fontSize: "13px",
                        fontFamily: "'DM Mono', monospace",
                      }}
                    />
                    <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>min</span>
                  </div>
                )}
              </div>
            </FieldGroup>

            {/* AI scoring curriculum (Agora Stoa) */}
            <FieldGroup label="Scoring curriculum — how the AI judges this debate">
              <div className="grid gap-1.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))" }}>
                {CURRICULA.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => setCurriculum(c.key)}
                    className="cursor-pointer text-left rounded-lg px-2.5 py-2 flex items-center gap-2 transition-all"
                    style={{
                      background: curriculum === c.key ? "rgba(74,158,255,0.1)" : "rgba(255,255,255,0.03)",
                      border: curriculum === c.key ? "1px solid var(--accent-blue)" : "1px solid var(--border)",
                    }}
                  >
                    <span
                      className="shrink-0"
                      style={{
                        width: 12,
                        height: 12,
                        borderRadius: "50%",
                        border: curriculum === c.key ? "3.5px solid var(--accent-blue)" : "1.5px solid rgba(255,255,255,0.25)",
                      }}
                    />
                    <span>
                      <span className="block text-[12px]" style={{ color: "var(--text-primary)" }}>{c.label}</span>
                      <span className="block text-[10px]" style={{ color: "var(--text-muted)" }}>{c.desc}</span>
                    </span>
                  </button>
                ))}
                <div
                  className="text-left rounded-lg px-2.5 py-2 flex items-center gap-2"
                  style={{ border: "1px dashed rgba(217,162,56,0.5)", opacity: 0.85 }}
                >
                  <span className="text-[13px]" style={{ color: "#f4d47c" }}>+</span>
                  <span>
                    <span className="block text-[12px]" style={{ color: "#f4d47c" }}>Custom curriculum</span>
                    <span className="block text-[10px]" style={{ color: "var(--text-muted)" }}>Upload your team's rubric — coach tier, coming soon</span>
                  </span>
                </div>
              </div>
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
                    Scheduled debates appear on Explore under the Scheduled filter. People can queue up, but the room only goes live when you hit Start.
                    {" "}You can have at most 3 scheduled at once.
                  </p>
                </>
              )}
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
                  <Toggle
                    label="Allow spectators to watch"
                    checked={allowSpectators}
                    onChange={setAllowSpectators}
                  />
                  <p
                    style={{
                      marginTop: "8px",
                      fontSize: "11px",
                      lineHeight: 1.5,
                      color: "var(--text-dim)",
                    }}
                  >
                    {allowSpectators
                      ? "Room will appear in public listings tagged “Private”. Visitors join as spectators only; debaters must use the invite code."
                      : "Room is completely hidden from all listings and search. Only people with the invite code can enter."}
                  </p>
                </>
              )}
            </div>

            {/* Footer */}
            <div
              className="flex items-center justify-end pt-4"
              style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}
            >
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
                  ? "Schedule debate"
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
        background: active
          ? activeColor || "var(--accent-purple)"
          : "rgba(255,255,255,0.04)",
        border: active
          ? `1px solid ${activeColor || "var(--accent-purple)"}44`
          : "1px solid rgba(255,255,255,0.08)",
        color: active ? "white" : "var(--text-muted)",
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

function SideStepper({
  label,
  color,
  value,
  onDec,
  onInc,
  incDisabled,
}: {
  label: string;
  color: string;
  value: number;
  onDec: () => void;
  onInc: () => void;
  incDisabled?: boolean;
}) {
  return (
    <div
      className="flex-1 flex flex-col items-center justify-center"
      style={{
        background: "rgba(255,255,255,0.025)",
        border: "1px solid rgba(255,255,255,0.06)",
        borderRadius: "10px",
        padding: "8px 10px",
      }}
    >
      <span
        style={{
          fontFamily: "'DM Sans', sans-serif",
          fontSize: "10px",
          fontWeight: 700,
          letterSpacing: "0.14em",
          color,
          marginBottom: "4px",
        }}
      >
        {label}
      </span>
      <div className="flex items-center gap-2">
        <StepperBtn onClick={onDec} disabled={value <= 1}>−</StepperBtn>
        <span
          style={{
            fontFamily: "'DM Mono', monospace",
            fontSize: "20px",
            fontWeight: 600,
            color: "var(--text-primary)",
            width: "28px",
            textAlign: "center",
          }}
        >
          {value}
        </span>
        <StepperBtn onClick={onInc} disabled={!!incDisabled}>+</StepperBtn>
      </div>
    </div>
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
