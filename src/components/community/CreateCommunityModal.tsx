"use client";

/* Create a community — a three-step sheet, the same shell as the
   create-discussion modal:
     1. Basics   name (with the handle it will live at), type, description
     2. Look     accent colour, avatar, banner — with a live preview card
     3. Access   public or private (with the application prompt), rules
   Everything is written in one insert, then the creator becomes owner.
   Mounted by the Communities page (its "+ New community") and by the home
   shell for the site-wide entry points (?create=community, the link at
   the foot of the discussion modal). */

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase-browser";
import useEscapeClose from "@/lib/useEscapeClose";
import { Icon, type IconName } from "@/components/icons";
import { uploadPostImage, uploadSquareImage } from "@/lib/postImages";

export const COMMUNITY_KINDS: { key: string; label: string; icon: IconName; hint: string }[] = [
  { key: "topic-circle", label: "Topic circle", icon: "users-round", hint: "People around an interest" },
  { key: "university", label: "University", icon: "landmark", hint: "A campus or society" },
  { key: "hs-team", label: "HS team", icon: "trophy", hint: "A school debate team" },
  { key: "mun", label: "Model UN", icon: "globe", hint: "Delegations and committees" },
  { key: "pre-law", label: "Pre-law", icon: "hammer", hint: "Moot court, LSAT, admissions" },
];

const COLORS = ["#4a9eff", "#ffb700", "#00b894", "#e05a5a", "#9d8fd9", "#d98fb9", "#e0956a", "#64B5F6"];

/* community_creation_status() / the creation trigger (20260889). */
type CreationStatus = {
  allowed: boolean;
  reason: "signed_out" | "email_unverified" | "account_too_new" | "community_limit" | null;
  count: number;
  cap: number | null;
  account_age_hours?: number;
};
const GUARD_MESSAGES: Record<string, string> = {
  email_unverified: "Verify your email address before creating a community.",
  account_too_new: "New accounts can create communities after their first day.",
  community_limit: "You've reached the limit of communities one account can create.",
};
const NAME_MIN = 3;
const NAME_MAX = 40;
const DESC_MAX = 300;
const RULES_MAX = 4000;
const PROMPT_MAX = 500;

/* Preview of the handle — the real slug can gain a short suffix if the
   name is taken (src/lib/communityUrls.ts). */
function previewSlug(name: string): string {
  return name.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
}

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated?: (c: { id: string; name: string }) => void;
  /* The Discussion | Community switch in the header; hidden when absent. */
  onCreateDiscussion?: () => void;
  /* See CreateRoomModal: crossfade phases for the switch. */
  switchPhase?: "in" | "out";
}

const field: CSSProperties = {
  background: "rgba(10,10,12,0.7)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 10,
  color: "#eeeef5",
  fontSize: 14,
  padding: "10px 12px",
  outline: "none",
  fontFamily: "inherit",
  width: "100%",
  boxSizing: "border-box",
};
const label: CSSProperties = {
  display: "block",
  fontSize: 12,
  fontWeight: 600,
  color: "rgba(238,238,245,0.7)",
  marginBottom: 6,
};
const hintStyle: CSSProperties = { fontSize: 11.5, color: "rgba(238,238,245,0.42)", marginTop: 5 };

export default function CreateCommunityModal({ open, onClose, onCreated, onCreateDiscussion, switchPhase }: Props) {
  const [supabase] = useState(() => createClient());
  useEscapeClose(open, onClose);

  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [kind, setKind] = useState(COMMUNITY_KINDS[0].key);
  const [description, setDescription] = useState("");
  const [color, setColor] = useState(COLORS[0]);
  const [avatar, setAvatar] = useState<File | null>(null);
  const [banner, setBanner] = useState<File | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [bannerUrl, setBannerUrl] = useState<string | null>(null);
  const [isPrivate, setIsPrivate] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [rules, setRules] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  /* What the database will say to an insert right now (20260889):
     null while loading; allowed, or a reason the sheet explains instead
     of showing the form. */
  const [gate, setGate] = useState<CreationStatus | null>(null);
  const [resent, setResent] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const avatarInput = useRef<HTMLInputElement>(null);
  const bannerInput = useRef<HTMLInputElement>(null);

  /* Fresh every time it opens; focus the name. */
  useEffect(() => {
    if (!open) return;
    setStep(0); setName(""); setKind(COMMUNITY_KINDS[0].key); setDescription("");
    setColor(COLORS[0]); setAvatar(null); setBanner(null); setIsPrivate(false);
    setPrompt(""); setRules(""); setBusy(false); setError(null); setGate(null); setResent(false);
    supabase.auth.getUser().then(({ data }) => {
      setUserId(data.user?.id ?? null);
      setUserEmail(data.user?.email ?? null);
    });
    supabase.rpc("community_creation_status").then(({ data, error: err }) => {
      if (err || !data) { setGate({ allowed: true, reason: null, count: 0, cap: null }); return; }
      setGate(data as CreationStatus);
    });
    const t = setTimeout(() => nameRef.current?.focus(), 60);
    return () => clearTimeout(t);
  }, [open, supabase]);

  /* Object URLs for the previews, revoked when they change. */
  useEffect(() => {
    if (!avatar) { setAvatarUrl(null); return; }
    const u = URL.createObjectURL(avatar);
    setAvatarUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [avatar]);
  useEffect(() => {
    if (!banner) { setBannerUrl(null); return; }
    const u = URL.createObjectURL(banner);
    setBannerUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [banner]);

  const trimmed = name.trim();
  const nameOk = trimmed.length >= NAME_MIN && trimmed.length <= NAME_MAX;
  const slug = previewSlug(trimmed);
  const canNext = step === 0 ? nameOk && description.length <= DESC_MAX : true;
  const canCreate = nameOk && rules.length <= RULES_MAX && (!isPrivate || prompt.length <= PROMPT_MAX);

  const create = useCallback(async () => {
    if (!canCreate || busy) return;
    if (!userId) { window.location.href = "/login"; return; }
    setBusy(true);
    setError(null);
    try {
      const [avatar_url, banner_url] = await Promise.all([
        avatar ? uploadSquareImage(supabase, userId, avatar) : Promise.resolve(null),
        banner ? uploadPostImage(supabase, userId, banner) : Promise.resolve(null),
      ]);
      const { data, error: err } = await supabase
        .from("communities")
        .insert({
          name: trimmed,
          kind,
          color,
          description: description.trim() || null,
          rules: rules.trim() || null,
          is_private: isPrivate,
          application_prompt: isPrivate && prompt.trim() ? prompt.trim() : null,
          avatar_url,
          banner_url,
          created_by: userId,
        })
        .select("id, name")
        .single();
      if (err || !data) throw new Error(GUARD_MESSAGES[err?.message ?? ""] ?? err?.message ?? "Couldn't create the community.");
      await supabase.from("community_members").insert({ community_id: data.id, user_id: userId, role: "owner" });
      onCreated?.({ id: data.id, name: data.name });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create the community.");
    } finally {
      setBusy(false);
    }
  }, [canCreate, busy, userId, avatar, banner, supabase, trimmed, kind, color, description, rules, isPrivate, prompt, onCreated, onClose]);

  /* Portaled to <body>: mounted inside the Communities panel (a fixed
     layer with its own stacking context) the overlay could never rise
     above the phone tab bar, whatever its z-index. */
  if (!open || typeof document === "undefined") return null;

  const kindMeta = COMMUNITY_KINDS.find((k) => k.key === kind) ?? COMMUNITY_KINDS[0];
  const initial = (trimmed || "?").charAt(0).toUpperCase();

  const preview = (
    <div style={{ borderRadius: 14, overflow: "hidden", border: "1px solid rgba(255,255,255,0.1)", background: "rgba(14,14,17,0.8)" }}>
      <div
        style={{
          height: 84,
          background: bannerUrl
            ? `url(${bannerUrl}) center/cover`
            : `linear-gradient(120deg, ${color}66 0%, ${color}14 60%, rgba(0,0,0,0) 100%)`,
        }}
      />
      <div style={{ display: "flex", alignItems: "flex-end", gap: 12, padding: "0 14px 12px", marginTop: -26 }}>
        <span
          style={{
            width: 56, height: 56, borderRadius: 16, flexShrink: 0,
            background: avatarUrl ? `url(${avatarUrl}) center/cover` : color,
            border: "3px solid #101014",
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            color: "#fff", fontWeight: 800, fontSize: 22, fontFamily: "'Space Grotesk', sans-serif",
          }}
        >
          {avatarUrl ? "" : initial}
        </span>
        <span style={{ minWidth: 0, paddingBottom: 2 }}>
          <span style={{ display: "block", color: "#f5f5f0", fontWeight: 700, fontSize: 15, fontFamily: "'Space Grotesk', sans-serif", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {trimmed || "Your community"}
          </span>
          <span style={{ display: "block", color: "rgba(238,238,245,0.5)", fontSize: 11.5, marginTop: 2 }}>
            {kindMeta.label} · {isPrivate ? "private" : "public"} · 1 member
          </span>
        </span>
      </div>
    </div>
  );

  const steps = ["Basics", "Look", "Access"];

  return createPortal(
    <div
      className="fixed inset-0 z-[500] flex items-center justify-center p-5 ccm-overlay"
      style={{
        background: switchPhase === "out" ? "transparent" : "rgba(0,0,0,0.78)",
        backdropFilter: switchPhase === "out" ? "none" : "blur(4px)",
        animation: switchPhase ? "none" : "modalIn 0.2s ease",
        pointerEvents: switchPhase === "out" ? "none" : undefined,
      }}
      onClick={onClose}
    >
      <div
        className="w-full overflow-y-auto ccm-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ccm-title"
        style={{
          maxWidth: 560,
          maxHeight: "92vh",
          background: "#000",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 20,
          boxShadow: "0 24px 80px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.04)",
          animation: switchPhase === "out" ? "modalPanelOut 0.16s ease forwards" : "modalPanelIn 0.25s cubic-bezier(0.25, 0.46, 0.45, 0.94)",
          fontFamily: "'DM Sans', sans-serif",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between ccm-head" style={{ padding: "20px 24px 14px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <div>
            <h2 id="ccm-title" style={{ margin: 0, fontSize: 18, fontWeight: 700, letterSpacing: "-0.02em", color: "#f5f5f0" }}>
              Create a community
            </h2>
            {onCreateDiscussion && (
              <div
                role="tablist"
                aria-label="What to create"
                className="inline-flex items-center"
                style={{ marginTop: 10, padding: 3, borderRadius: 999, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)" }}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected="false"
                  onClick={onCreateDiscussion}
                  className="cursor-pointer inline-flex items-center gap-1.5"
                  style={{ padding: "5px 12px", borderRadius: 999, background: "transparent", border: "none", color: "rgba(238,238,245,0.7)", fontSize: 12, fontWeight: 600, fontFamily: "inherit" }}
                >
                  <Icon name="mic" size={12} /> Discussion
                </button>
                <span
                  role="tab"
                  aria-selected="true"
                  className="inline-flex items-center gap-1.5"
                  style={{ padding: "5px 12px", borderRadius: 999, background: "#ffb700", color: "#1a0e00", fontSize: 12, fontWeight: 700, fontFamily: "inherit" }}
                >
                  <Icon name="users-round" size={12} /> Community
                </span>
              </div>
            )}
            <div className="flex items-center gap-2" style={{ marginTop: 8 }} aria-label={`Step ${step + 1} of ${steps.length}`}>
              {steps.map((s, i) => (
                <span key={s} className="inline-flex items-center gap-1.5" style={{ fontSize: 11.5, fontWeight: 600, color: i === step ? "#ffb700" : i < step ? "rgba(238,238,245,0.7)" : "rgba(238,238,245,0.35)" }}>
                  <span style={{ width: 18, height: 18, borderRadius: 999, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 10.5, background: i === step ? "#ffb700" : i < step ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.06)", color: i === step ? "#1a0e00" : "inherit" }}>
                    {i < step ? <Icon name="check" size={10} /> : i + 1}
                  </span>
                  {s}
                  {i < steps.length - 1 && <span style={{ width: 14, height: 1, background: "rgba(255,255,255,0.12)", marginLeft: 4 }} />}
                </span>
              ))}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex items-center justify-center cursor-pointer"
            style={{ width: 28, height: 28, borderRadius: 8, color: "rgba(238,238,245,0.6)", background: "rgba(255,255,255,0.04)", border: "none" }}
          >
            <Icon name="x" size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="ccm-body" style={{ padding: "18px 24px 8px", display: "flex", flexDirection: "column", gap: 18 }}>
          {/* Gate: the database would refuse this account right now. */}
          {gate && !gate.allowed && gate.reason && (
            <div className="ccm-gate" style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", padding: "26px 12px 18px" }}>
              <span style={{ width: 54, height: 54, borderRadius: 999, display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: 12, background: "rgba(255,183,0,0.12)", color: "#ffb700", border: "1px solid rgba(255,183,0,0.25)" }}>
                <Icon name={gate.reason === "email_unverified" ? "mail" : gate.reason === "account_too_new" ? "clock" : "landmark"} size={22} />
              </span>
              <p style={{ margin: 0, fontFamily: "'Space Grotesk', sans-serif", fontSize: 16, fontWeight: 700, color: "#f5f5f0" }}>
                {gate.reason === "email_unverified" && "Verify your email first"}
                {gate.reason === "account_too_new" && "Your account is brand new"}
                {gate.reason === "community_limit" && "You've made the most boards one account can"}
                {gate.reason === "signed_out" && "Sign in to create a community"}
              </p>
              <p style={{ margin: "6px 0 0", fontSize: 13, lineHeight: 1.5, color: "rgba(238,238,245,0.55)", maxWidth: 340 }}>
                {gate.reason === "email_unverified" && <>We sent a link to <span style={{ color: "rgba(238,238,245,0.85)" }}>{userEmail ?? "your inbox"}</span>. Open it, then come back — communities need a verified address.</>}
                {gate.reason === "account_too_new" && `Communities open up after your first day (${Math.max(0, 24 - (gate.account_age_hours ?? 0))}h to go). Join a few boards and post in the meantime.`}
                {gate.reason === "community_limit" && `You've created ${gate.count} of ${gate.cap ?? 3}. Owner upgrades with more boards are coming; for now, grow the ones you have.`}
                {gate.reason === "signed_out" && "Communities are created from an account."}
              </p>
              {gate.reason === "email_unverified" && userEmail && (
                <button
                  type="button"
                  disabled={resent}
                  onClick={async () => {
                    const { error: err } = await supabase.auth.resend({ type: "signup", email: userEmail });
                    if (err) setError(err.message); else setResent(true);
                  }}
                  className="cursor-pointer disabled:cursor-default"
                  style={{ marginTop: 14, fontSize: 13, fontWeight: 700, padding: "9px 16px", borderRadius: 999, background: resent ? "rgba(255,255,255,0.08)" : "#ffb700", border: "none", color: resent ? "#c9c9d2" : "#1a0e00", fontFamily: "inherit" }}
                >
                  {resent ? "Sent — check your inbox" : "Resend the link"}
                </button>
              )}
            </div>
          )}

          {(!gate || gate.allowed) && step === 0 && (
            <>
              <div>
                <label style={label} htmlFor="ccm-name">Name</label>
                <input
                  id="ccm-name"
                  ref={nameRef}
                  value={name}
                  onChange={(e) => setName(e.target.value.slice(0, NAME_MAX + 10))}
                  placeholder="e.g. Georgetown Debate Society"
                  style={field}
                  maxLength={NAME_MAX}
                />
                <p style={{ ...hintStyle, display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {slug ? <>Lives at <span style={{ color: "rgba(238,238,245,0.7)" }}>agorasphere.net/communities/{slug}</span></> : `${NAME_MIN}–${NAME_MAX} characters.`}
                  </span>
                  <span style={{ flexShrink: 0, color: trimmed.length > NAME_MAX ? "#ff8a80" : undefined }}>{trimmed.length}/{NAME_MAX}</span>
                </p>
              </div>

              <div>
                <span style={label}>Type</span>
                <div className="ccm-kinds" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 8 }}>
                  {COMMUNITY_KINDS.map((k) => {
                    const on = k.key === kind;
                    return (
                      <button
                        key={k.key}
                        type="button"
                        onClick={() => setKind(k.key)}
                        aria-pressed={on}
                        className="cursor-pointer text-left"
                        style={{
                          display: "flex", alignItems: "center", gap: 10, padding: "9px 11px", borderRadius: 11,
                          background: on ? "rgba(255,183,0,0.12)" : "rgba(255,255,255,0.04)",
                          border: `1px solid ${on ? "rgba(255,183,0,0.55)" : "rgba(255,255,255,0.09)"}`,
                          color: "#eeeef5", fontFamily: "inherit",
                        }}
                      >
                        <span style={{ width: 30, height: 30, borderRadius: 9, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0, background: on ? "rgba(255,183,0,0.18)" : "rgba(255,255,255,0.06)", color: on ? "#ffb700" : "#c0c0c8" }}>
                          <Icon name={k.icon} size={15} />
                        </span>
                        <span style={{ minWidth: 0 }}>
                          <span style={{ display: "block", fontSize: 13, fontWeight: 600 }}>{k.label}</span>
                          <span style={{ display: "block", fontSize: 11, color: "rgba(238,238,245,0.45)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{k.hint}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label style={label} htmlFor="ccm-desc">Description <span style={{ fontWeight: 400, color: "rgba(238,238,245,0.4)" }}>(optional)</span></label>
                <textarea
                  id="ccm-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value.slice(0, DESC_MAX))}
                  placeholder="What is this board for, and who is it for?"
                  rows={3}
                  style={{ ...field, resize: "vertical", lineHeight: 1.45 }}
                />
                <p style={{ ...hintStyle, textAlign: "right" }}>{description.length}/{DESC_MAX}</p>
              </div>
            </>
          )}

          {(!gate || gate.allowed) && step === 1 && (
            <>
              {preview}
              <div>
                <span style={label}>Accent colour</span>
                <div className="flex items-center gap-2 flex-wrap">
                  {COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setColor(c)}
                      aria-label={`Colour ${c}`}
                      aria-pressed={color === c}
                      className="cursor-pointer"
                      style={{
                        width: 30, height: 30, borderRadius: 999, background: c, border: "none", padding: 0,
                        boxShadow: color === c ? `0 0 0 2px #101014, 0 0 0 4px ${c}` : "none",
                        transform: color === c ? "scale(1.05)" : "none",
                      }}
                    />
                  ))}
                  <label className="cursor-pointer inline-flex items-center gap-1.5" style={{ fontSize: 12, color: "rgba(238,238,245,0.6)", marginLeft: 4 }}>
                    <input type="color" value={color} onChange={(e) => setColor(e.target.value)} style={{ width: 26, height: 26, border: "none", background: "none", padding: 0, cursor: "pointer" }} aria-label="Custom colour" />
                    Custom
                  </label>
                </div>
              </div>
              <div className="ccm-images" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {([
                  ["avatar", "Avatar", "Square, shown beside the name.", avatar, avatarInput, setAvatar],
                  ["banner", "Banner", "Wide, across the top of the board.", banner, bannerInput, setBanner],
                ] as const).map(([key, title, hint, file, ref, set]) => (
                  <div key={key} style={{ padding: 12, borderRadius: 12, border: "1px solid rgba(255,255,255,0.09)", background: "rgba(255,255,255,0.03)" }}>
                    <span style={{ ...label, marginBottom: 2 }}>{title} <span style={{ fontWeight: 400, color: "rgba(238,238,245,0.4)" }}>(optional)</span></span>
                    <p style={{ ...hintStyle, marginTop: 0, marginBottom: 10 }}>{hint}</p>
                    <input ref={ref} type="file" accept="image/*" hidden onChange={(e) => set(e.target.files?.[0] ?? null)} />
                    <div className="flex items-center gap-2 flex-wrap">
                      <button type="button" onClick={() => ref.current?.click()} className="cursor-pointer inline-flex items-center gap-1.5" style={{ fontSize: 12, fontWeight: 600, padding: "6px 11px", borderRadius: 999, background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)", color: "#e8e8ee", fontFamily: "inherit" }}>
                        <Icon name="image" size={13} /> {file ? "Replace" : "Upload"}
                      </button>
                      {file && (
                        <button type="button" onClick={() => set(null)} className="cursor-pointer" style={{ fontSize: 12, background: "none", border: "none", color: "rgba(238,238,245,0.5)", fontFamily: "inherit" }}>
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {(!gate || gate.allowed) && step === 2 && (
            <>
              <div>
                <span style={label}>Who can join</span>
                <div className="ccm-access" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {([
                    [false, "unlock", "Public", "Anyone can find it and join."],
                    [true, "lock", "Private", "People request to join; you approve."],
                  ] as const).map(([priv, icon, title, hint]) => {
                    const on = isPrivate === priv;
                    return (
                      <button
                        key={title}
                        type="button"
                        onClick={() => setIsPrivate(priv)}
                        aria-pressed={on}
                        className="cursor-pointer text-left"
                        style={{
                          display: "flex", gap: 10, alignItems: "flex-start", padding: "11px 12px", borderRadius: 12,
                          background: on ? "rgba(255,183,0,0.12)" : "rgba(255,255,255,0.04)",
                          border: `1px solid ${on ? "rgba(255,183,0,0.55)" : "rgba(255,255,255,0.09)"}`,
                          color: "#eeeef5", fontFamily: "inherit",
                        }}
                      >
                        <span style={{ color: on ? "#ffb700" : "#c0c0c8", marginTop: 1 }}><Icon name={icon} size={15} /></span>
                        <span>
                          <span style={{ display: "block", fontSize: 13, fontWeight: 600 }}>{title}</span>
                          <span style={{ display: "block", fontSize: 11.5, color: "rgba(238,238,245,0.5)", marginTop: 2 }}>{hint}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
              {isPrivate && (
                <div>
                  <label style={label} htmlFor="ccm-prompt">Ask applicants <span style={{ fontWeight: 400, color: "rgba(238,238,245,0.4)" }}>(optional)</span></label>
                  <textarea
                    id="ccm-prompt"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value.slice(0, PROMPT_MAX))}
                    placeholder="e.g. Which school are you at, and who do you know here?"
                    rows={2}
                    style={{ ...field, resize: "vertical", lineHeight: 1.45 }}
                  />
                  <p style={hintStyle}>Shown when someone requests to join; their answer comes with the request.</p>
                </div>
              )}
              <div>
                <label style={label} htmlFor="ccm-rules">Rules <span style={{ fontWeight: 400, color: "rgba(238,238,245,0.4)" }}>(optional)</span></label>
                <textarea
                  id="ccm-rules"
                  value={rules}
                  onChange={(e) => setRules(e.target.value.slice(0, RULES_MAX))}
                  placeholder={"1. Stay on topic\n2. Argue the point, not the person"}
                  rows={4}
                  style={{ ...field, resize: "vertical", lineHeight: 1.45 }}
                />
                <p style={hintStyle}>Pinned in the board&rsquo;s sidebar. You can edit everything later in the board&rsquo;s settings.</p>
              </div>
              {preview}
            </>
          )}

          {error && (
            <p className="m-0 px-4 py-2.5 rounded-lg" style={{ fontSize: 12.5, background: "rgba(239,68,68,0.08)", border: "0.5px solid rgba(239,68,68,0.3)", color: "#fca5a5" }}>
              {error}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 ccm-foot" style={{ padding: "12px 24px 20px" }}>
          {gate && !gate.allowed ? (
            <>
              <span style={{ marginLeft: "auto" }} />
              <button type="button" onClick={onClose} className="cursor-pointer" style={{ fontSize: 13, fontWeight: 600, padding: "9px 16px", borderRadius: 999, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "#e8e8ee", fontFamily: "inherit" }}>
                Close
              </button>
            </>
          ) : step > 0 ? (
            <button type="button" onClick={() => setStep((s) => s - 1)} className="cursor-pointer inline-flex items-center gap-1.5" style={{ fontSize: 13, fontWeight: 600, padding: "9px 14px", borderRadius: 999, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "#e8e8ee", fontFamily: "inherit" }}>
              <Icon name="arrow-left" size={13} /> Back
            </button>
          ) : (
            <span style={{ fontSize: 12, color: "rgba(238,238,245,0.4)" }}>You&rsquo;ll be the owner. You can add mods later.</span>
          )}
          <span style={{ marginLeft: "auto" }} />
          {step < steps.length - 1 ? (
            <button
              type="button"
              onClick={() => canNext && setStep((s) => s + 1)}
              disabled={!canNext}
              className="cursor-pointer disabled:cursor-default disabled:opacity-50"
              style={{ fontSize: 13, fontWeight: 700, padding: "9px 18px", borderRadius: 999, background: "#ffb700", border: "none", color: "#1a0e00", fontFamily: "inherit" }}
            >
              Next
            </button>
          ) : (
            <button
              type="button"
              onClick={create}
              disabled={!canCreate || busy}
              className="cursor-pointer disabled:cursor-default disabled:opacity-50"
              style={{ fontSize: 13, fontWeight: 700, padding: "9px 18px", borderRadius: 999, background: "#ffb700", border: "none", color: "#1a0e00", fontFamily: "inherit" }}
            >
              {busy ? "Creating…" : "Create community"}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
