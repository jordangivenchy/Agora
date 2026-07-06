"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";
import AvatarCropModal from "@/components/AvatarCropModal";

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
    } = await supabase.auth.getUser();
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
      if (msg.includes("username_taken")) setError("That username is already taken.");
      else if (msg.includes("invalid_username"))
        setError("Username must be 3–20 characters: lowercase letters, numbers, or underscores.");
      else setError("Could not save — " + msg);
      return;
    }
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("profile-updated"));
    }
    router.replace("/");
  }

  const canContinue =
    !saving && !uploading && availability !== "taken" && availability !== "invalid";

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center relative overflow-hidden px-4 py-10"
      style={{ background: "var(--bg-primary)" }}
    >
      {/* Ambient glow */}
      <div
        className="absolute pointer-events-none"
        style={{
          width: "720px",
          height: "720px",
          top: "-360px",
          left: "50%",
          transform: "translateX(-50%)",
          background:
            "radial-gradient(circle, rgba(59,130,246,0.14) 0%, rgba(59,130,246,0.05) 40%, transparent 70%)",
        }}
      />

      <main className="relative flex flex-col items-center w-full" style={{ maxWidth: "420px" }}>
        {/* Brand */}
        <img src="/logo.png" alt="AgoraSphere" className="h-[22px] w-auto mb-7" />

        <div
          className="w-full"
          style={{
            background: "rgba(18,18,21,0.7)",
            border: "1px solid var(--border)",
            borderRadius: "20px",
            padding: "32px 32px 26px",
            boxShadow: "0 24px 80px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.04)",
            backdropFilter: "blur(16px)",
            WebkitBackdropFilter: "blur(16px)",
          }}
        >
          <h1
            className="text-center"
            style={{
              fontFamily: "'DM Sans', sans-serif",
              fontWeight: 700,
              fontSize: "22px",
              letterSpacing: "-0.02em",
              color: "var(--text-primary)",
              marginBottom: "6px",
            }}
          >
            Set up your profile
          </h1>
          <p
            className="text-center"
            style={{
              color: "var(--text-muted)",
              fontSize: "13px",
              lineHeight: 1.55,
              marginBottom: "26px",
            }}
          >
            This is how other debaters will see you. You can change it anytime.
          </p>

          {error && (
            <div
              style={{
                background: "rgba(239,68,68,0.08)",
                border: "1px solid rgba(239,68,68,0.3)",
                borderRadius: "10px",
                color: "#fca5a5",
                fontSize: "12.5px",
                lineHeight: 1.5,
                padding: "10px 14px",
                marginBottom: "18px",
              }}
            >
              {error}
            </div>
          )}

          {!loaded ? (
            <div className="flex items-center justify-center py-14">
              <div
                className="animate-spin"
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: "50%",
                  border: "2px solid var(--accent-blue)",
                  borderTopColor: "transparent",
                }}
              />
            </div>
          ) : (
            <>
              {/* Avatar */}
              <div className="flex flex-col items-center mb-6">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="relative cursor-pointer group"
                  style={{ background: "none", border: "none", padding: 0 }}
                  title="Change photo"
                >
                  {avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={avatarUrl}
                      alt="Your avatar"
                      className="rounded-full object-cover"
                      style={{
                        width: 92,
                        height: 92,
                        border: "2px solid var(--border-hover)",
                      }}
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div
                      className="rounded-full flex items-center justify-center"
                      style={{
                        width: 92,
                        height: 92,
                        background: "rgba(255,255,255,0.05)",
                        border: "2px dashed var(--border-hover)",
                        color: "var(--text-dim)",
                      }}
                    >
                      <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                        <circle cx="12" cy="7" r="4" />
                      </svg>
                    </div>
                  )}
                  {/* Camera badge */}
                  <span
                    className="absolute flex items-center justify-center"
                    style={{
                      width: 30,
                      height: 30,
                      right: -2,
                      bottom: -2,
                      borderRadius: "50%",
                      background: "var(--accent-blue)",
                      border: "2.5px solid var(--bg-secondary)",
                      color: "#fff",
                    }}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
                      <circle cx="12" cy="13" r="3" />
                    </svg>
                  </span>
                </button>
                <span
                  style={{
                    marginTop: 10,
                    fontSize: "11.5px",
                    color: "var(--text-dim)",
                    fontWeight: 500,
                  }}
                >
                  {uploading ? "Uploading…" : "Click to upload a photo"}
                </span>
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
              <label
                style={{
                  display: "block",
                  fontSize: "11.5px",
                  fontWeight: 600,
                  letterSpacing: "0.02em",
                  color: "var(--text-muted)",
                  marginBottom: "6px",
                }}
              >
                Display name{" "}
                <span style={{ color: "var(--text-dim)", fontWeight: 400 }}>(optional)</span>
              </label>
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value.slice(0, 40))}
                placeholder="e.g. Jordan J."
                className="w-full outline-none transition-all"
                style={{
                  height: "42px",
                  padding: "0 14px",
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid var(--border)",
                  borderRadius: "10px",
                  color: "var(--text-primary)",
                  fontFamily: "'DM Sans', sans-serif",
                  fontSize: "13.5px",
                  marginBottom: "14px",
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = "rgba(59,130,246,0.55)";
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = "var(--border)";
                }}
              />

              {/* Username */}
              <label
                style={{
                  display: "block",
                  fontSize: "11.5px",
                  fontWeight: 600,
                  letterSpacing: "0.02em",
                  color: "var(--text-muted)",
                  marginBottom: "6px",
                }}
              >
                Username
              </label>
              <div className="relative">
                <span
                  style={{
                    position: "absolute",
                    left: 14,
                    top: "50%",
                    transform: "translateY(-50%)",
                    color: "var(--text-dim)",
                    fontFamily: "'DM Mono', monospace",
                    fontSize: 13.5,
                  }}
                >
                  @
                </span>
                <input
                  value={username}
                  onChange={(e) =>
                    setUsername(
                      e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 20)
                    )
                  }
                  placeholder="your_handle"
                  className="w-full outline-none transition-all"
                  style={{
                    height: "42px",
                    padding: "0 14px 0 32px",
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid var(--border)",
                    borderRadius: "10px",
                    color: "var(--text-primary)",
                    fontFamily: "'DM Mono', monospace",
                    fontSize: "13.5px",
                  }}
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor = "rgba(59,130,246,0.55)";
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = "var(--border)";
                  }}
                />
              </div>
              <div
                style={{
                  minHeight: 18,
                  fontSize: "11.5px",
                  marginTop: 5,
                  marginBottom: 14,
                  color:
                    availability === "ok"
                      ? "#22c55e"
                      : availability === "taken" || availability === "invalid"
                        ? "#fca5a5"
                        : "var(--text-dim)",
                }}
              >
                {availability === "checking" && "Checking availability…"}
                {availability === "ok" && "✓ Available"}
                {availability === "taken" && "Already taken — try another"}
                {availability === "invalid" && "3–20 chars: a–z, 0–9, underscores"}
                {availability === "idle" && "3–20 chars: lowercase letters, numbers, underscores"}
              </div>

              {/* Bio */}
              <label
                style={{
                  display: "block",
                  fontSize: "11.5px",
                  fontWeight: 600,
                  letterSpacing: "0.02em",
                  color: "var(--text-muted)",
                  marginBottom: "6px",
                }}
              >
                Bio <span style={{ color: "var(--text-dim)", fontWeight: 400 }}>(optional)</span>
              </label>
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value.slice(0, 240))}
                placeholder="Tell the community something about you…"
                rows={3}
                className="w-full outline-none transition-all"
                style={{
                  padding: "10px 14px",
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid var(--border)",
                  borderRadius: "10px",
                  color: "var(--text-primary)",
                  fontFamily: "'DM Sans', sans-serif",
                  fontSize: "13px",
                  resize: "none",
                  marginBottom: "20px",
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = "rgba(59,130,246,0.55)";
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = "var(--border)";
                }}
              />

              <button
                onClick={handleContinue}
                disabled={!canContinue}
                className="w-full cursor-pointer transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  background: "var(--accent-blue)",
                  border: "none",
                  borderRadius: "100px",
                  color: "#fff",
                  fontFamily: "'DM Sans', sans-serif",
                  fontSize: "14px",
                  fontWeight: 600,
                  padding: "12px 20px",
                }}
                onMouseEnter={(e) => {
                  if (canContinue)
                    e.currentTarget.style.background = "var(--accent-purple-light)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "var(--accent-blue)";
                }}
              >
                {saving ? "Saving…" : "Continue"}
              </button>
            </>
          )}
        </div>

        <button
          onClick={() => router.replace("/")}
          className="cursor-pointer transition-colors"
          style={{
            marginTop: "16px",
            background: "none",
            border: "none",
            fontSize: "12.5px",
            color: "var(--text-muted)",
            fontWeight: 500,
          }}
        >
          Skip for now
        </button>
      </main>

      <AvatarCropModal
        open={!!cropSrc}
        src={cropSrc}
        onCancel={closeCrop}
        onApply={handleCroppedUpload}
      />
    </div>
  );
}
