"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import AuthShell from "@/components/auth/AuthShell";
import { LoadingLine } from "@/components/LoadingScreen";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";
import AvatarCropModal from "@/components/AvatarCropModal";
import { friendlyProfileError } from "@/lib/profileText";
import PeopleSuggestions from "@/components/people/PeopleSuggestions";
import { sessionUser } from "@/lib/session";

const USERNAME_REGEX = /^[a-z0-9_]{3,20}$/;
const AVAILABILITY_DEBOUNCE_MS = 450;

export default function WelcomePage() {
  const supabase = createClient();
  const router = useRouter();

  const [userId, setUserId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [initialUsername, setInitialUsername] = useState("");

  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /* Step 2 (optional): follow a few people. Skipped automatically when
     get_people_suggestions has nothing to offer. */
  const [step, setStep] = useState<"profile" | "follow">("profile");
  const [followed, setFollowed] = useState(0);

  const [availability, setAvailability] =
    useState<"idle" | "checking" | "ok" | "taken" | "invalid">("idle");
  const availabilityTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Object URL of the freshly picked image awaiting crop.
  const [cropSrc, setCropSrc] = useState<string | null>(null);

  // Load the signed-in user's profile; bounce to /login if signed out.
  const loadProfile = useCallback(async () => {
    const {
      data: { user },
    } = await sessionUser(supabase);
    if (!user) {
      router.replace("/login");
      return;
    }
    setUserId(user.id);
    const { data } = await supabase
      .from("users")
      .select("username, display_name, avatar_url, bio")
      .eq("id", user.id)
      .single();
    if (data) {
      setInitialUsername(data.username || "");
      setUsername(data.username || "");
      setAvatarUrl(data.avatar_url || "");
      setBio(data.bio || "");
      // Prefill display name from the profile, falling back to the name
      // Google provided at sign-up.
      setDisplayName(
        data.display_name ||
          user.user_metadata?.full_name ||
          user.user_metadata?.name ||
          ""
      );
    }
    setLoaded(true);
  }, [router, supabase]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  // Debounced username availability check.
  useEffect(() => {
    if (!loaded) return;
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
  }, [username, loaded, initialUsername, supabase]);

  function handleAvatarPick(file: File) {
    setError(null);
    if (file.size > 5 * 1024 * 1024) {
      setError("Image is too large — 5 MB max.");
      return;
    }
    setCropSrc(URL.createObjectURL(file));
  }

  function closeCrop() {
    if (cropSrc) URL.revokeObjectURL(cropSrc);
    setCropSrc(null);
  }

  async function handleCroppedUpload(blob: Blob) {
    if (!userId) return;
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

  async function handleContinue() {
    setError(null);
    const trimmed = username.trim().toLowerCase();
    if (!USERNAME_REGEX.test(trimmed)) {
      setError("Username must be 3–20 characters: lowercase letters, numbers, or underscores.");
      return;
    }
    if (availability === "taken") {
      setError("That username is already taken.");
      return;
    }
    setSaving(true);
    const { error: rpcErr } = await supabase.rpc("update_profile", {
      p_username: trimmed,
      p_avatar_url: avatarUrl || null,
      p_bio: bio || null,
      p_display_name: displayName,
    });
    setSaving(false);
    if (rpcErr) {
      const msg = rpcErr.message || "";
      setError(friendlyProfileError(msg) ?? "Could not save — " + msg);
      return;
    }
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("profile-updated"));
    }
    setStep("follow");
  }

  const canContinue =
    !saving && !uploading && availability !== "taken" && availability !== "invalid";

  const hint =
    availability === "checking" ? "Checking availability…"
    : availability === "ok" ? "Available"
    : availability === "taken" ? "Already taken — try another"
    : availability === "invalid" ? "3–20 characters: a–z, 0–9, underscores"
    : "3–20 characters: lowercase letters, numbers, underscores";

  return (
    <>
      <AuthShell
        width={420}
        brandHref={null}
        footer={
          <button type="button" onClick={() => router.replace("/")} className="auth-quiet">
            {step === "follow" ? "Skip" : "Skip for now"}
          </button>
        }
      >
        {step === "follow" && (
          <>
            <h1 className="auth-title">Follow a few people</h1>
            <p className="auth-sub">
              Their discussions and posts will show up in your feed. Optional — you can always find more under People.
            </p>
            <PeopleSuggestions
              limit={8}
              layout="row"
              title={null}
              onLoaded={(n) => { if (n === 0) router.replace("/"); }}
              onFollowChange={(_, f) => setFollowed((c) => Math.max(0, c + (f ? 1 : -1)))}
            />
            <button onClick={() => router.replace("/")} className="auth-primary" style={{ marginTop: 18 }}>
              {followed > 0 ? `Continue (${followed} followed)` : "Continue"}
            </button>
          </>
        )}

        {step === "profile" && (
          <>
            <h1 className="auth-title">Set up your profile</h1>
            <p className="auth-sub">This is how other speakers will see you. You can change it anytime.</p>
            {error && <div className="auth-error">{error}</div>}

            {!loaded ? (
              <div className="auth-wait"><LoadingLine label="Loading your profile" /></div>
            ) : (
              <>
                <div className="auth-avatar">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    className="auth-avatar-btn"
                    title="Change photo"
                  >
                    {avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={avatarUrl} alt="Your avatar" referrerPolicy="no-referrer" />
                    ) : (
                      <div className="auth-avatar-empty"><Icon name="user" size={32} strokeWidth={1.5} /></div>
                    )}
                    <span className="auth-avatar-badge"><Icon name="camera" size={14} /></span>
                  </button>
                  <span className="auth-avatar-caption">{uploading ? "Uploading…" : "Add a photo"}</span>
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

                <div className="auth-form">
                  <div className="auth-field-group">
                    <label className="auth-label" htmlFor="display-name">Display name <small>optional</small></label>
                    <input
                      id="display-name"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value.slice(0, 40))}
                      placeholder="e.g. Jordan J."
                      className="auth-field"
                    />
                  </div>
                  <div className="auth-field-group">
                    <label className="auth-label" htmlFor="username">Username</label>
                    <div className="auth-handle">
                      <span aria-hidden="true">@</span>
                      <input
                        id="username"
                        value={username}
                        onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 20))}
                        placeholder="your_handle"
                        autoComplete="username"
                        className="auth-field is-mono"
                      />
                    </div>
                    <div className={`auth-hint${availability === "ok" ? " is-ok" : availability === "taken" || availability === "invalid" ? " is-bad" : ""}`}>
                      {hint}
                    </div>
                  </div>
                  <div className="auth-field-group">
                    <label className="auth-label" htmlFor="bio">Bio <small>optional</small></label>
                    <textarea
                      id="bio"
                      value={bio}
                      onChange={(e) => setBio(e.target.value.slice(0, 240))}
                      placeholder="Tell the community something about you…"
                      rows={3}
                      className="auth-field"
                    />
                  </div>
                  <button onClick={handleContinue} disabled={!canContinue} className="auth-primary">
                    {saving ? "Saving…" : "Continue"}
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </AuthShell>

      <AvatarCropModal
        open={!!cropSrc}
        src={cropSrc}
        onCancel={closeCrop}
        onApply={handleCroppedUpload}
      />
    </>
  );
}
