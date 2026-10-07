"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/icons";
import { createClient } from "@/lib/supabase-browser";
import useEscapeClose from "@/lib/useEscapeClose";
import AvatarCropModal from "./AvatarCropModal";
import { MAX_SOCIAL_LINKS, normalizeSocialLink } from "@/lib/socialLinks";
import {
  BIO_MAX,
  DISPLAY_NAME_MAX,
  USERNAME_REGEX,
  findBlockedTerm,
  friendlyProfileError,
  normalizeBio,
  normalizeDisplayName,
  normalizeUsername,
} from "@/lib/profileText";

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

const AVAILABILITY_DEBOUNCE_MS = 450;
const MAX_AVATAR_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_BANNER_WIDTH = 1600;
const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const NEW_ACCOUNT_GRACE_MS = 60 * 60 * 1000;

export default function EditProfileModal({
  open, userId, initialUsername, initialDisplayName, initialAvatarUrl, initialBio,
  usernameChangedAt, accountCreatedAt,
  onClose, onSaved,
}: Props) {
  const supabase = createClient();
  useEscapeClose(open, onClose);

  const [username, setUsername] = useState(initialUsername || "");
  const [displayName, setDisplayName] = useState(initialDisplayName || "");
  const [bio, setBio] = useState(initialBio || "");
  const [avatarUrl, setAvatarUrl] = useState(initialAvatarUrl || "");
  const [bannerUrl, setBannerUrl] = useState("");
  const [bannerUploading, setBannerUploading] = useState(false);
  const [links, setLinks] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [availability, setAvailability] =
    useState<"idle" | "checking" | "ok" | "taken" | "invalid">("idle");
  const availabilityTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const bannerInputRef = useRef<HTMLInputElement | null>(null);
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

  // Self-load banner + social links (props stay untouched for existing call sites).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("users")
        .select("banner_url, social_links")
        .eq("id", userId)
        .maybeSingle();
      if (cancelled || !data) return;
      setBannerUrl(data.banner_url || "");
      setLinks(Array.isArray(data.social_links) ? data.social_links.filter((l: unknown): l is string => typeof l === "string") : []);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, userId]);

  // Debounced availability check
  useEffect(() => {
    if (!open || usernameLocked) return;
    if (availabilityTimer.current) clearTimeout(availabilityTimer.current);

    const trimmed = normalizeUsername(username);
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

  function handleBannerPick(file: File) {
    setError(null);
    if (file.size > MAX_AVATAR_BYTES) {
      setError("Image is too large — 5 MB max.");
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = async () => {
      URL.revokeObjectURL(objectUrl);
      setBannerUploading(true);
      try {
        const scale = Math.min(1, MAX_BANNER_WIDTH / img.naturalWidth);
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.naturalWidth * scale);
        canvas.height = Math.round(img.naturalHeight * scale);
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          setError("Could not process the image in this browser.");
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, "image/webp", 0.85)
        );
        if (!blob) {
          setError("Could not process the image in this browser.");
          return;
        }
        const path = `${userId}/banner.webp`;
        const { error: upErr } = await supabase.storage
          .from("avatars")
          .upload(path, blob, { upsert: true, cacheControl: "3600", contentType: "image/webp" });
        if (upErr) {
          setError("Upload failed: " + upErr.message);
          return;
        }
        const { data: urlData } = supabase.storage.from("avatars").getPublicUrl(path);
        // Fixed path + upsert, so cache-bust the URL when replacing.
        setBannerUrl(`${urlData.publicUrl}?v=${Date.now()}`);
      } finally {
        setBannerUploading(false);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      setError("Could not read that image file.");
    };
    img.src = objectUrl;
  }

  const displayNameBlocked = findBlockedTerm(displayName) !== null;
  const bioBlocked = findBlockedTerm(bio) !== null;

  async function handleSave() {
    setError(null);
    const trimmed = normalizeUsername(username);
    const cleanDisplayName = normalizeDisplayName(displayName);
    const cleanBio = normalizeBio(bio);
    if (!usernameLocked && findBlockedTerm(trimmed)) {
      setError("Username contains a blocked term.");
      return;
    }
    if (displayNameBlocked) {
      setError("Display name contains a blocked term.");
      return;
    }
    if (bioBlocked) {
      setError("Bio contains a blocked term.");
      return;
    }
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
      p_bio: cleanBio,         // empty string clears the bio
      p_display_name: cleanDisplayName,
    });
    if (rpcErr) {
      setSaving(false);
      const msg = rpcErr.message || "";
      setError(friendlyProfileError(msg) ?? "Could not save — " + msg);
      return;
    }
    const normalizedLinks = links
      .map((l) => normalizeSocialLink(l))
      .filter((l): l is string => l !== null)
      .slice(0, MAX_SOCIAL_LINKS);
    const { error: extrasErr } = await supabase.rpc("update_profile_extras", {
      p_banner_url: bannerUrl, // empty string clears the banner
      p_social_links: normalizedLinks,
    });
    setSaving(false);
    if (extrasErr) {
      const msg = extrasErr.message || "";
      setError(friendlyProfileError(msg) ?? "Could not save — " + msg);
      return;
    }
    onSaved();
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("profile-updated"));
    }
    onClose();
  }

  if (!open || typeof document === "undefined") return null;

  const canSave =
    !saving && !uploading && !bannerUploading &&
    availability !== "taken" && availability !== "invalid" &&
    !displayNameBlocked && !bioBlocked;

  /* The line under a field: what is wrong with it on the left, how much
     of its length is used on the right. */
  const under = (n: number, max: number, blocked: boolean) =>
    `epm-under${blocked ? " is-bad" : n >= max ? " is-limit" : ""}`;

  /* The site's solid look (the `.epm-*` and `.stg-*` rules in globals.css):
     a black body with a hairline, near-black tiles to type in, yellow for
     the keyboard's focus and for Save. The title and the two buttons stay
     put; only the fields between them scroll, so Save is never below the
     fold. Drawn on the page's top layer (a portal): the page's own layer
     sits under the site's bar, which used to cover this title. */
  return createPortal(
    <div className="epm-veil" onClick={onClose}>
      <div
        className="epm"
        role="dialog"
        aria-modal="true"
        aria-label="Edit profile"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="epm-head">
          <h2 className="epm-title">Edit profile</h2>
          <button type="button" className="epm-x" onClick={onClose} aria-label="Close">
            <Icon name="x" size={13} />
          </button>
        </div>

        <div className="epm-body">
          {error && <p className="stg-banner is-page" role="alert">{error}</p>}

          {/* Avatar */}
          <div className="epm-photo">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="epm-avatar"
              title="Change photo"
            >
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatarUrl} alt="avatar preview" referrerPolicy="no-referrer" />
              ) : (
                <span className="epm-avatar-empty">
                  <Icon name="user" size={26} strokeWidth={1.5} />
                </span>
              )}
              <span className="epm-avatar-badge">
                <Icon name="camera" size={12} />
              </span>
            </button>
            <div className="epm-photo-text">
              <span className="epm-photo-lead">
                {uploading ? "Uploading…" : "Click the photo to upload a new one"}
              </span>
              <span className="epm-hint">PNG, JPG, or WebP — 5 MB max</span>
              {avatarUrl && (
                <button type="button" onClick={() => setAvatarUrl("")} className="epm-remove">
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

          {/* Banner */}
          <div className="epm-field">
            <span className="epm-label">
              Banner{" "}
              <span>— shown across the top of your profile · 1500 × 500 recommended (3:1)</span>
            </span>
            <button
              type="button"
              onClick={() => bannerInputRef.current?.click()}
              disabled={bannerUploading}
              className={`epm-banner${bannerUrl ? " has-image" : ""}`}
              title="Change banner"
            >
              {bannerUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={bannerUrl} alt="banner preview" referrerPolicy="no-referrer" />
              ) : (
                <span>
                  <Icon name="image" size={16} />
                  {bannerUploading ? "Uploading…" : "Click to upload a banner"}
                </span>
              )}
            </button>
            <div className="epm-under">
              <span>{bannerUploading ? "Uploading…" : "PNG, JPG, or WebP — 5 MB max, resized to 1600px"}</span>
              {bannerUrl && (
                <button type="button" onClick={() => setBannerUrl("")} className="epm-remove">
                  Remove banner
                </button>
              )}
            </div>
            <input
              ref={bannerInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleBannerPick(f);
                e.target.value = "";
              }}
            />
          </div>

          {/* Display name */}
          <div className="epm-field">
            <label className="epm-label" htmlFor="epm-display-name">
              Display name{" "}
              <span>— shown next to your handle, change anytime</span>
            </label>
            <input
              id="epm-display-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value.slice(0, DISPLAY_NAME_MAX))}
              onBlur={() => setDisplayName((v) => normalizeDisplayName(v))}
              maxLength={DISPLAY_NAME_MAX}
              placeholder="e.g. Jordan J."
              className={`stg-input${displayNameBlocked ? " is-bad" : ""}`}
            />
            <div className={under(displayName.length, DISPLAY_NAME_MAX, displayNameBlocked)}>
              <span>{displayNameBlocked ? "Display name contains a blocked term" : ""}</span>
              <span>{displayName.length}/{DISPLAY_NAME_MAX}</span>
            </div>
          </div>

          {/* Username */}
          <div className="epm-field">
            <label className="epm-label" htmlFor="epm-username">
              Username{" "}
              <span>— your @handle, once every 7 days</span>
            </label>
            <div className="epm-handle">
              <span className="epm-handle-at" aria-hidden="true">@</span>
              <input
                id="epm-username"
                value={username}
                disabled={usernameLocked}
                onChange={(e) =>
                  setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 20))
                }
                placeholder="your_handle"
                className="stg-input is-mono"
              />
              {usernameLocked && (
                <span className="epm-handle-lock">
                  <Icon name="lock" size={13} />
                </span>
              )}
            </div>
            <div
              className={`epm-under${
                availability === "ok" ? " is-ok"
                : availability === "taken" || availability === "invalid" ? " is-bad"
                : ""}`}
            >
              <span>
                {usernameLocked
                  ? `Locked — you can change it again on ${cooldownUntil!.toLocaleDateString(undefined, { month: "long", day: "numeric" })}`
                  : availability === "checking" ? "Checking availability…"
                  : availability === "ok" ? "✓ Available"
                  : availability === "taken" ? "Already taken"
                  : availability === "invalid" ? "3–20 chars: a–z, 0–9, underscores"
                  : "3–20 chars: lowercase letters, numbers, underscores"}
              </span>
            </div>
          </div>

          {/* Bio */}
          <div className="epm-field">
            <label className="epm-label" htmlFor="epm-bio">
              Bio <span>(optional)</span>
            </label>
            <textarea
              id="epm-bio"
              value={bio}
              onChange={(e) => setBio(e.target.value.slice(0, BIO_MAX))}
              onBlur={() => setBio((v) => normalizeBio(v))}
              maxLength={BIO_MAX}
              placeholder="Tell the community something about you…"
              rows={3}
              className={`stg-input${bioBlocked ? " is-bad" : ""}`}
            />
            <div className={under(bio.length, BIO_MAX, bioBlocked)}>
              <span>{bioBlocked ? "Bio contains a blocked term" : ""}</span>
              <span>{bio.length}/{BIO_MAX}</span>
            </div>
          </div>

          {/* Social links */}
          <div className="epm-field">
            <span className="epm-label">
              Social links{" "}
              <span>— up to {MAX_SOCIAL_LINKS}, https only</span>
            </span>
            {links.map((link, i) => {
              const invalid = link.trim() !== "" && normalizeSocialLink(link) === null;
              return (
                <div key={i} className="epm-link">
                  <input
                    value={link}
                    onChange={(e) =>
                      setLinks((prev) => prev.map((l, j) => (j === i ? e.target.value.slice(0, 200) : l)))
                    }
                    placeholder="e.g. instagram.com/your_handle"
                    aria-label={`Social link ${i + 1}`}
                    className={`stg-input is-mono${invalid ? " is-bad" : ""}`}
                  />
                  <button
                    type="button"
                    onClick={() => setLinks((prev) => prev.filter((_, j) => j !== i))}
                    className="epm-x is-remove"
                    title="Remove link"
                    aria-label={`Remove social link ${i + 1}`}
                  >
                    <Icon name="x" size={12} />
                  </button>
                </div>
              );
            })}
            {links.length < MAX_SOCIAL_LINKS && (
              <div className="stg-actions">
                <button
                  type="button"
                  onClick={() => setLinks((prev) => [...prev, ""])}
                  className="stg-btn stg-btn--quiet"
                >
                  + Add link
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="epm-foot">
          <button type="button" onClick={onClose} disabled={saving} className="stg-btn stg-btn--quiet">
            Cancel
          </button>
          <button type="button" onClick={handleSave} disabled={!canSave} className="stg-btn stg-btn--primary">
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
    </div>,
    document.body,
  );
}
