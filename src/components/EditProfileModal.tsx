"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import AvatarCropModal from "./AvatarCropModal";

interface Props {
  open: boolean;
  userId: string;
  initialUsername: string;
  initialDisplayName: string | null;
  initialAvatarUrl: string | null;
  initialBio: string | null;
  /** When the username was last changed — drives the 7-day cooldown lock. */
  usernameChangedAt: string | null;
  /** Account creation time — accounts under 1h old are exempt from the cooldown. */
  accountCreatedAt: string | null;
  onClose: () => void;
  /** Called after a successful save so the parent can refetch the profile. */
  onSaved: () => void;
}

const USERNAME_REGEX = /^[a-z0-9_]{3,20}$/;
const AVAILABILITY_DEBOUNCE_MS = 450;
const MAX_AVATAR_BYTES = 5 * 1024 * 1024; // 5 MB
const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const NEW_ACCOUNT_GRACE_MS = 60 * 60 * 1000;

export default function EditProfileModal({
  open, userId, initialUsername, initialDisplayName, initialAvatarUrl, initialBio,
  usernameChangedAt, accountCreatedAt,
  onClose, onSaved,
}: Props) {
  const supabase = createClient();

  const [username, setUsername] = useState(initialUsername || "");
  const [displayName, setDisplayName] = useState(initialDisplayName || "");
  const [bio, setBio] = useState(initialBio || "");
  const [avatarUrl, setAvatarUrl] = useState(initialAvatarUrl || "");
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [availability, setAvailability] =
    useState<"idle" | "checking" | "ok" | "taken" | "invalid">("idle");
  const availabilityTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Object URL of the freshly picked image awaiting crop.
  const [cropSrc, setCropSrc] = useState<string | null>(null);

  // Username cooldown: locked when last change was < 7 days ago, unless the
  // account itself is under an hour old (onboarding grace, mirrors the RPC).
  const cooldownUntil = (() => {
    if (!usernameChangedAt) return null;
    const changed = new Date(usernameChangedAt).getTime();
    const created = accountCreatedAt ? new Date(accountCreatedAt).getTime() : 0;
    if (Date.now() - created < NEW_ACCOUNT_GRACE_MS) return null;
    const until = changed + COOLDOWN_MS;
    return until > Date.now() ? new Date(until) : null;
  })();
  const usernameLocked = !!cooldownUntil;

  // Reset when re-opened
  useEffect(() => {
    if (!open) return;
    setUsername(initialUsername || "");
    setDisplayName(initialDisplayName || "");
    setBio(initialBio || "");
    setAvatarUrl(initialAvatarUrl || "");
    setError(null);
    setAvailability("idle");
  }, [open, initialUsername, initialDisplayName, initialAvatarUrl, initialBio]);

  // Debounced availability check
  useEffect(() => {
    if (!open || usernameLocked) return;
    if (availabilityTimer.current) clearTimeout(availabilityTimer.current);

    const trimmed = username.trim().toLowerCase();
    if (trimmed === initialUsername.toLowerCase()) {
      setAvailability("idle");
      return;
    }
    if (!USERNAME_REGEX.test(trimmed)) {
      setAvailability("invalid");
      return;
    }
    setAvailability("checking");
    availabilityTimer.current = setTimeout(async () => {
      const { data, error: rpcErr } = await supabase.rpc("check_username_available", {
        p_username: trimmed,
      });
      if (rpcErr) {
        setAvailability("invalid");
        return;
      }
      setAvailability(data ? "ok" : "taken");
    }, AVAILABILITY_DEBOUNCE_MS);

    return () => {
      if (availabilityTimer.current) clearTimeout(availabilityTimer.current);
    };
  }, [username, open, initialUsername, usernameLocked, supabase]);

  function handleAvatarPick(file: File) {
    setError(null);
    if (file.size > MAX_AVATAR_BYTES) {
      setError("Image is too large — 5 MB max.");
      return;
    }
    // Open the crop step; the upload happens after Apply.
    setCropSrc(URL.createObjectURL(file));
  }

  function closeCrop() {
    if (cropSrc) URL.revokeObjectURL(cropSrc);
    setCropSrc(null);
  }

  async function handleCroppedUpload(blob: Blob) {
    setUploading(true);
    try {
      const path = `${userId}/${Date.now()}.webp`;
      const { error: upErr } = await supabase.storage
        .from("avatars")
        .upload(path, blob, { upsert: true, cacheControl: "3600", contentType: "image/webp" });
      if (upErr) {
        setError("Upload failed: " + upErr.message);
        return;
      }
      const { data: urlData } = supabase.storage.from("avatars").getPublicUrl(path);
      setAvatarUrl(urlData.publicUrl);
    } finally {
      setUploading(false);
      closeCrop();
    }
  }

  async function handleSave() {
    setError(null);
    const trimmed = username.trim().toLowerCase();
    if (!USERNAME_REGEX.test(trimmed)) {
      setError("Username must be 3–20 chars, lowercase letters, numbers, or underscores.");
      return;
    }
    if (availability === "taken") {
      setError("That username is already taken.");
      return;
    }
    setSaving(true);
    const { error: rpcErr } = await supabase.rpc("update_profile", {
      p_username: usernameLocked ? initialUsername : trimmed,
      p_avatar_url: avatarUrl, // empty string clears the avatar
      p_bio: bio,              // empty string clears the bio
      p_display_name: displayName,
    });
    setSaving(false);
    if (rpcErr) {
      const msg = rpcErr.message || "";
      if (msg.includes("username_cooldown"))
        setError("You can only change your username once every 7 days.");
      else if (msg.includes("username_taken")) setError("That username is already taken.");
      else if (msg.includes("invalid_username"))
        setError("Username must be 3–20 chars, lowercase letters, numbers, or underscores.");
      else if (msg.includes("display_name_too_long"))
        setError("Display name must be 40 characters or fewer.");
      else setError("Could not save — " + msg);
      return;
    }
    onSaved();
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("profile-updated"));
    }
    onClose();
  }

  if (!open) return null;

  const canSave = !saving && !uploading && availability !== "taken" && availability !== "invalid";

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontFamily: "'DM Sans', sans-serif",
    fontSize: 11.5,
    fontWeight: 600,
    letterSpacing: "0.02em",
    color: "var(--text-muted)",
    marginBottom: 6,
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "10px 14px",
    background: "rgba(255,255,255,0.04)",
    border: "1px solid var(--border)",
    borderRadius: 10,
    color: "var(--text-primary)",
    fontFamily: "'DM Sans', sans-serif",
    fontSize: 13.5,
    outline: "none",
  };

  return (
    <div
      className="fixed inset-0 z-[970] flex items-center justify-center p-5"
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
          maxWidth: 460,
          maxHeight: "92vh",
          background: "rgba(18,18,21,0.95)",
          border: "1px solid var(--border)",
          borderRadius: 20,
          boxShadow: "0 24px 80px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.04)",
          padding: "24px 24px 22px",
          animation: "modalPanelIn 0.25s cubic-bezier(0.25, 0.46, 0.45, 0.94)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <h2
            style={{
              fontFamily: "'DM Sans', sans-serif",
              fontSize: 17,
              fontWeight: 700,
              letterSpacing: "-0.02em",
              color: "var(--text-primary)",
            }}
          >
            Edit profile
          </h2>
          <button
            onClick={onClose}
            className="flex items-center justify-center cursor-pointer transition-all"
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
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

        {error && (
          <div
            className="rounded-lg px-3 py-2 mb-4"
            style={{
              background: "rgba(239,68,68,0.08)",
              border: "1px solid rgba(239,68,68,0.3)",
              color: "#fca5a5",
              fontSize: 12.5,
              lineHeight: 1.5,
            }}
          >
            {error}
          </div>
        )}

        {/* Avatar */}
        <div className="flex items-center gap-4 mb-5">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="relative cursor-pointer shrink-0"
            style={{ background: "none", border: "none", padding: 0 }}
            title="Change photo"
          >
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={avatarUrl}
                alt="avatar preview"
                className="rounded-full object-cover"
                style={{ width: 72, height: 72, border: "2px solid var(--border-hover)" }}
                referrerPolicy="no-referrer"
              />
            ) : (
              <div
                className="rounded-full flex items-center justify-center"
                style={{
                  width: 72,
                  height: 72,
                  background: "rgba(255,255,255,0.05)",
                  border: "2px dashed var(--border-hover)",
                  color: "var(--text-dim)",
                }}
              >
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
              </div>
            )}
            <span
              className="absolute flex items-center justify-center"
              style={{
                width: 26,
                height: 26,
                right: -2,
                bottom: -2,
                borderRadius: "50%",
                background: "var(--accent-blue)",
                border: "2.5px solid var(--bg-secondary)",
                color: "#fff",
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
                <circle cx="12" cy="13" r="3" />
              </svg>
            </span>
          </button>
          <div className="flex flex-col gap-1.5">
            <span style={{ fontSize: 12.5, color: "var(--text-muted)", fontWeight: 500 }}>
              {uploading ? "Uploading…" : "Click the photo to upload a new one"}
            </span>
            <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
              PNG, JPG, or WebP — 5 MB max
            </span>
            {avatarUrl && (
              <button
                onClick={() => setAvatarUrl("")}
                className="cursor-pointer text-left"
                style={{
                  padding: 0,
                  background: "none",
                  border: "none",
                  color: "#fca5a5",
                  fontSize: 11.5,
                  fontWeight: 500,
                }}
              >
                Remove photo
              </button>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleAvatarPick(f);
              e.target.value = "";
            }}
          />
        </div>

        {/* Display name */}
        <label style={labelStyle}>
          Display name{" "}
          <span style={{ color: "var(--text-dim)", fontWeight: 400 }}>
            — shown next to your handle, change anytime
          </span>
        </label>
        <input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value.slice(0, 40))}
          placeholder="e.g. Jordan J."
          className="transition-all"
          style={{ ...inputStyle, marginBottom: 14 }}
          onFocus={(e) => { e.currentTarget.style.borderColor = "rgba(59,130,246,0.55)"; }}
          onBlur={(e) => { e.currentTarget.style.borderColor = "var(--border)"; }}
        />

        {/* Username */}
        <label style={labelStyle}>
          Username{" "}
          <span style={{ color: "var(--text-dim)", fontWeight: 400 }}>
            — your @handle, once every 7 days
          </span>
        </label>
        <div className="relative mb-1">
          <span
            style={{
              position: "absolute",
              left: 14,
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--text-dim)",
              fontFamily: "'DM Mono', monospace",
              fontSize: 13,
            }}
          >
            @
          </span>
          <input
            value={username}
            disabled={usernameLocked}
            onChange={(e) =>
              setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 20))
            }
            placeholder="your_handle"
            className="transition-all"
            style={{
              ...inputStyle,
              paddingLeft: 32,
              fontFamily: "'DM Mono', monospace",
              fontSize: 13,
              opacity: usernameLocked ? 0.55 : 1,
              cursor: usernameLocked ? "not-allowed" : "text",
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = "rgba(59,130,246,0.55)"; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = "var(--border)"; }}
          />
          {usernameLocked && (
            <span
              className="absolute flex items-center"
              style={{ right: 14, top: "50%", transform: "translateY(-50%)", color: "var(--text-dim)" }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </span>
          )}
        </div>
        <div
          style={{
            minHeight: 18,
            fontFamily: "'DM Sans', sans-serif",
            fontSize: 11.5,
            marginBottom: 14,
            color:
              availability === "ok" ? "#22c55e"
              : availability === "taken" || availability === "invalid" ? "#fca5a5"
              : "var(--text-dim)",
          }}
        >
          {usernameLocked
            ? `Locked — you can change it again on ${cooldownUntil!.toLocaleDateString(undefined, { month: "long", day: "numeric" })}`
            : availability === "checking" ? "Checking availability…"
            : availability === "ok" ? "✓ Available"
            : availability === "taken" ? "Already taken"
            : availability === "invalid" ? "3–20 chars: a–z, 0–9, underscores"
            : "3–20 chars: lowercase letters, numbers, underscores"}
        </div>

        {/* Bio */}
        <label style={labelStyle}>
          Bio <span style={{ color: "var(--text-dim)", fontWeight: 400 }}>(optional)</span>
        </label>
        <textarea
          value={bio}
          onChange={(e) => setBio(e.target.value.slice(0, 240))}
          placeholder="Tell the community something about you…"
          rows={3}
          className="w-full transition-all"
          style={{ ...inputStyle, resize: "none", marginBottom: 20 }}
          onFocus={(e) => { e.currentTarget.style.borderColor = "rgba(59,130,246,0.55)"; }}
          onBlur={(e) => { e.currentTarget.style.borderColor = "var(--border)"; }}
        />

        <div className="flex gap-2">
          <button
            onClick={onClose}
            disabled={saving}
            className="flex-1 cursor-pointer transition-all"
            style={{
              padding: "11px 16px",
              borderRadius: 100,
              background: "rgba(255,255,255,0.04)",
              border: "1px solid var(--border)",
              color: "var(--text-muted)",
              fontFamily: "'DM Sans', sans-serif",
              fontSize: 13.5,
              fontWeight: 600,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "var(--text-primary)";
              e.currentTarget.style.borderColor = "var(--border-hover)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "var(--text-muted)";
              e.currentTarget.style.borderColor = "var(--border)";
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!canSave}
            className="flex-1 cursor-pointer transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              padding: "11px 16px",
              borderRadius: 100,
              background: "var(--accent-blue)",
              border: "none",
              color: "#fff",
              fontFamily: "'DM Sans', sans-serif",
              fontSize: 13.5,
              fontWeight: 600,
            }}
            onMouseEnter={(e) => {
              if (canSave) e.currentTarget.style.background = "var(--accent-purple-light)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "var(--accent-blue)";
            }}
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>

      <AvatarCropModal
        open={!!cropSrc}
        src={cropSrc}
        onCancel={closeCrop}
        onApply={handleCroppedUpload}
      />
    </div>
  );
}
