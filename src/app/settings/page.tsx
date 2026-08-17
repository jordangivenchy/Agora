"use client";

/* /settings — the account settings center.
   Every control here is backed by real behavior:
   - profile edits reuse EditProfileModal (username cooldown, avatar crop)
   - email/password go through Supabase Auth (verification / re-auth)
   - discussion defaults are honored by the room page's LiveKit connect
   - reduce motion toggles a root class consumed by globals.css
   - show_debate_history is enforced server-side in the profile RPCs
   - blocked users list/unblock uses the moderation RPCs
   - delete account calls delete_own_account (anonymize + kill sessions)
   Settings persist in public.user_settings (RLS: own row only). */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";
import { validateNewPassword } from "@/lib/passwordPolicy";
import EditProfileModal from "@/components/EditProfileModal";
import type { User } from "@supabase/supabase-js";
import { displayName } from "@/lib/names";

/* ── types ─────────────────────────────────────────────────── */

type SettingsRow = {
  join_muted: boolean;
  join_camera_off: boolean;
  reduce_motion: boolean;
  show_debate_history: boolean;
  notify_follows: boolean;
  notify_room_live: boolean;
};

const DEFAULT_SETTINGS: SettingsRow = {
  join_muted: false,
  join_camera_off: false,
  reduce_motion: false,
  show_debate_history: true,
  notify_follows: true,
  notify_room_live: true,
};

type ProfileRow = {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  email: string;
  username_changed_at: string | null;
  created_at: string;
  is_moderator: boolean;
};

type BlockedUser = { id: string; username: string; display_name?: string | null; avatar_url: string | null };

type SectionKey =
  | "profile"
  | "account"
  | "discussion"
  | "notifications"
  | "appearance"
  | "privacy"
  | "blocked"
  | "danger";

const SECTIONS: { key: SectionKey; label: string; sub: string }[] = [
  { key: "profile",    label: "Profile",                sub: "Name, username, bio, avatar" },
  { key: "account",    label: "Account & security",     sub: "Email, password, sessions" },
  { key: "discussion", label: "Discussion defaults",    sub: "Mic and camera on join" },
  { key: "notifications", label: "Notifications",       sub: "What you get notified about" },
  { key: "appearance", label: "Appearance & motion",    sub: "Animation preferences" },
  { key: "privacy",    label: "Privacy",                sub: "What others see" },
  { key: "blocked",    label: "Blocked users",          sub: "Manage your block list" },
  { key: "danger",     label: "Danger zone",            sub: "Delete your account" },
];

/* ── small building blocks ─────────────────────────────────── */

const card: React.CSSProperties = {
  background: "rgba(18,18,24,0.92)",
  border: "0.5px solid #2e2e38",
  borderRadius: 12,
};

function Toggle({
  on, disabled, onChange, label, sub,
}: {
  on: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
  label: string;
  sub: string;
}) {
  return (
    <button
      onClick={() => !disabled && onChange(!on)}
      disabled={disabled}
      className="flex w-full items-center justify-between gap-4 px-4 py-3.5 text-left cursor-pointer bg-transparent border-none"
      style={{ opacity: disabled ? 0.5 : 1 }}
      role="switch"
      aria-checked={on}
    >
      <span>
        <span className="block text-[13px]" style={{ color: "#f5f5f0" }}>{label}</span>
        <span className="block text-[11px] mt-0.5" style={{ color: "#8b8b94" }}>{sub}</span>
      </span>
      <span
        className="shrink-0 relative inline-block transition-colors"
        style={{
          width: 36, height: 20, borderRadius: 99,
          background: on ? "#1d9e75" : "#3a3a42",
        }}
      >
        <span
          className="absolute rounded-full bg-white transition-all"
          style={{ top: 3, left: on ? 19 : 3, width: 14, height: 14 }}
        />
      </span>
    </button>
  );
}

function SectionCard({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div style={card} className="mb-4 overflow-hidden">
      <div className="px-4 pt-4 pb-1">
        <p className="m-0 text-[14px]" style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, color: "#f5f5f0" }}>
          {title}
        </p>
        {sub && <p className="m-0 mt-0.5 text-[11px]" style={{ color: "#8b8b94" }}>{sub}</p>}
      </div>
      <div className="pb-1.5">{children}</div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%", boxSizing: "border-box",
  background: "rgba(10,10,14,0.8)", border: "0.5px solid #34343c",
  borderRadius: 9, color: "#f5f5f0", fontSize: 13,
  padding: "9px 12px", outline: "none", fontFamily: "inherit",
};

const btnPrimary: React.CSSProperties = {
  background: "rgba(24,48,82,0.9)", border: "0.5px solid #2c5382",
  color: "#9cc4f0", borderRadius: 9, padding: "8px 16px",
  fontSize: 12, cursor: "pointer", fontFamily: "inherit",
};

const btnGhost: React.CSSProperties = {
  background: "transparent", border: "0.5px solid #3a3a42",
  color: "#c0c0c8", borderRadius: 9, padding: "8px 16px",
  fontSize: 12, cursor: "pointer", fontFamily: "inherit",
};

/* ── page ──────────────────────────────────────────────────── */

export default function SettingsPage() {
  const [supabase] = useState(() => createClient());
  const router = useRouter();

  const [authUser, setAuthUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [settings, setSettings] = useState<SettingsRow>(DEFAULT_SETTINGS);
  const [blocked, setBlocked] = useState<BlockedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [active, setActive] = useState<SectionKey>("profile");
  // Mobile is list ⇄ panel; desktop always shows both.
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);

  const [savedFlash, setSavedFlash] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);

  const [editProfileOpen, setEditProfileOpen] = useState(false);

  /* ── load everything ── */
  const load = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.replace("/login"); return; }
      setAuthUser(user);

      const [profRes, setRes, blockRes] = await Promise.all([
        supabase.from("users")
          .select("id, username, display_name, avatar_url, bio, email, username_changed_at, created_at, is_moderator")
          .eq("id", user.id).maybeSingle(),
        supabase.from("user_settings").select("*").eq("user_id", user.id).maybeSingle(),
        supabase.from("user_blocks").select("blocked_id").eq("blocker_id", user.id),
      ]);

      if (profRes.error || !profRes.data) throw new Error(profRes.error?.message || "Profile not found");
      setProfile(profRes.data as ProfileRow);

      if (setRes.data) {
        const r = setRes.data as SettingsRow & Record<string, unknown>;
        setSettings({
          join_muted: r.join_muted,
          join_camera_off: r.join_camera_off,
          reduce_motion: r.reduce_motion,
          show_debate_history: r.show_debate_history,
          notify_follows: r.notify_follows ?? true,
          notify_room_live: r.notify_room_live ?? true,
        });
      }

      const ids = (blockRes.data ?? []).map((b: { blocked_id: string }) => b.blocked_id);
      if (ids.length) {
        const { data: blockedUsers } = await supabase
          .from("users").select("id, username, display_name, avatar_url").in("id", ids);
        setBlocked((blockedUsers ?? []) as BlockedUser[]);
      } else {
        setBlocked([]);
      }
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load settings");
    } finally {
      setLoading(false);
    }
  }, [supabase, router]);

  useEffect(() => { load(); }, [load]);

  /* ── toggle persistence: optimistic, rolled back on failure ── */
  const saveToggle = useCallback(
    async (key: keyof SettingsRow, value: boolean) => {
      if (!authUser) return;
      const prev = settings[key];
      setSettings((s) => ({ ...s, [key]: value }));
      setToggleError(null);

      // Reduce motion also applies instantly, and is cached for pre-auth boot.
      if (key === "reduce_motion") {
        document.documentElement.classList.toggle("reduce-motion", value);
        try { localStorage.setItem("agora-reduce-motion", value ? "1" : "0"); } catch {}
      }

      const { error } = await supabase
        .from("user_settings")
        .upsert({ user_id: authUser.id, ...settings, [key]: value }, { onConflict: "user_id" });

      if (error) {
        setSettings((s) => ({ ...s, [key]: prev }));
        if (key === "reduce_motion") {
          document.documentElement.classList.toggle("reduce-motion", prev);
          try { localStorage.setItem("agora-reduce-motion", prev ? "1" : "0"); } catch {}
        }
        setToggleError("Couldn't save — check your connection and try again.");
      } else {
        setSavedFlash(true);
        setTimeout(() => setSavedFlash(false), 1400);
      }
    },
    [authUser, settings, supabase]
  );

  /* ── email change ── */
  const [newEmail, setNewEmail] = useState("");
  const [emailMsg, setEmailMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [emailBusy, setEmailBusy] = useState(false);

  async function changeEmail(e: React.FormEvent) {
    e.preventDefault();
    const email = newEmail.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setEmailMsg({ kind: "err", text: "Enter a valid email address." });
      return;
    }
    setEmailBusy(true);
    setEmailMsg(null);
    const { error } = await supabase.auth.updateUser({ email });
    setEmailBusy(false);
    if (error) setEmailMsg({ kind: "err", text: error.message });
    else {
      setEmailMsg({
        kind: "ok",
        text: "Confirmation links sent. Your email only changes after you confirm from the new address.",
      });
      setNewEmail("");
    }
  }

  /* ── password change ── */
  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwMsg, setPwMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [pwBusy, setPwBusy] = useState(false);

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    if (!authUser?.email) return;
    const policyError = validateNewPassword(newPw, confirmPw);
    if (policyError) { setPwMsg({ kind: "err", text: policyError }); return; }

    setPwBusy(true);
    setPwMsg(null);
    // Re-authenticate with the current password before allowing the change.
    const { error: reauthErr } = await supabase.auth.signInWithPassword({
      email: authUser.email, password: curPw,
    });
    if (reauthErr) {
      setPwBusy(false);
      setPwMsg({ kind: "err", text: "Current password is incorrect." });
      return;
    }
    const { error } = await supabase.auth.updateUser({ password: newPw });
    setPwBusy(false);
    if (error) setPwMsg({ kind: "err", text: error.message });
    else {
      setPwMsg({ kind: "ok", text: "Password updated." });
      setCurPw(""); setNewPw(""); setConfirmPw("");
    }
  }

  /* ── sign out everywhere ── */
  const [signoutBusy, setSignoutBusy] = useState(false);
  async function signOutEverywhere() {
    setSignoutBusy(true);
    await supabase.auth.signOut({ scope: "global" });
    window.location.href = "/login";
  }

  /* ── unblock ── */
  const [unblockBusy, setUnblockBusy] = useState<string | null>(null);
  async function unblock(target: BlockedUser) {
    setUnblockBusy(target.id);
    const { error } = await supabase.rpc("unblock_user", { p_target: target.id });
    setUnblockBusy(null);
    if (!error) setBlocked((b) => b.filter((u) => u.id !== target.id));
  }

  /* ── delete account ── */
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);

  async function deleteAccount() {
    if (!profile || deleteConfirm !== profile.username) return;
    setDeleteBusy(true);
    setDeleteErr(null);
    const { error } = await supabase.rpc("delete_own_account");
    if (error) {
      setDeleteBusy(false);
      setDeleteErr(error.message);
      return;
    }
    // Server already revoked every session; clear the local one and leave.
    await supabase.auth.signOut().catch(() => {});
    window.location.href = "/login";
  }

  /* ── section renderers ── */

  function renderSection(key: SectionKey) {
    if (!profile) return null;
    switch (key) {
      case "profile":
        return (
          <SectionCard title="Profile" sub="How you appear across AgoraSphere.">
            <div className="flex items-center gap-3.5 px-4 py-3">
              <span
                className="flex items-center justify-center shrink-0 overflow-hidden"
                style={{ width: 52, height: 52, borderRadius: "50%", background: "#2c5382", color: "#fff", fontSize: 20, fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700 }}
              >
                {profile.avatar_url
                  ? // eslint-disable-next-line @next/next/no-img-element
                    <img src={profile.avatar_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  : displayName(profile).charAt(0).toUpperCase()}
              </span>
              <div className="flex-1 min-w-0">
                <p className="m-0 text-[14px]" style={{ color: "#f5f5f0" }}>
                  {displayName(profile)}
                </p>
                <p className="m-0 text-[11px]" style={{ color: "#8b8b94" }}>@{profile.username}</p>
                {profile.bio && (
                  <p className="m-0 mt-1 text-[11px] truncate" style={{ color: "#9a9aa2" }}>{profile.bio}</p>
                )}
              </div>
              <button style={btnPrimary} onClick={() => setEditProfileOpen(true)}>
                Edit profile
              </button>
            </div>
            <p className="mx-4 mb-3 mt-1 text-[10px]" style={{ color: "#6b6b74" }}>
              Username changes are limited to once every 7 days.
            </p>
          </SectionCard>
        );

      case "account":
        return (
          <>
            <SectionCard title="Email" sub={`Signed in as ${profile.email}`}>
              <form onSubmit={changeEmail} className="px-4 pb-3.5 flex flex-col gap-2.5">
                <input
                  style={inputStyle}
                  type="email"
                  placeholder="New email address"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  autoComplete="email"
                />
                {emailMsg && (
                  <p className="m-0 text-[11px]" style={{ color: emailMsg.kind === "ok" ? "#97c459" : "#fca5a5" }}>
                    {emailMsg.text}
                  </p>
                )}
                <div>
                  <button style={btnPrimary} disabled={emailBusy || !newEmail.trim()} type="submit">
                    {emailBusy ? "Sending…" : "Change email"}
                  </button>
                </div>
              </form>
            </SectionCard>

            <SectionCard title="Password" sub="Requires your current password.">
              <form onSubmit={changePassword} className="px-4 pb-3.5 flex flex-col gap-2.5">
                <input style={inputStyle} type="password" placeholder="Current password"
                  value={curPw} onChange={(e) => setCurPw(e.target.value)} autoComplete="current-password" />
                <input style={inputStyle} type="password" placeholder="New password"
                  value={newPw} onChange={(e) => setNewPw(e.target.value)} autoComplete="new-password" />
                <input style={inputStyle} type="password" placeholder="Confirm new password"
                  value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} autoComplete="new-password" />
                {pwMsg && (
                  <p className="m-0 text-[11px]" style={{ color: pwMsg.kind === "ok" ? "#97c459" : "#fca5a5" }}>
                    {pwMsg.text}
                  </p>
                )}
                <div className="flex items-center gap-3">
                  <button style={btnPrimary} disabled={pwBusy || !curPw || !newPw} type="submit">
                    {pwBusy ? "Updating…" : "Update password"}
                  </button>
                  <a href="/forgot-password" className="text-[11px]" style={{ color: "#8b8b94" }}>
                    Forgot your password?
                  </a>
                </div>
              </form>
            </SectionCard>

            <SectionCard title="Sessions" sub="Signs you out on every device, including this one.">
              <div className="px-4 pb-3.5">
                <button style={btnGhost} onClick={signOutEverywhere} disabled={signoutBusy}>
                  {signoutBusy ? "Signing out…" : "Sign out everywhere"}
                </button>
              </div>
            </SectionCard>
          </>
        );

      case "discussion":
        return (
          <SectionCard
            title="Joining a discussion"
            sub="Applied whenever you join as a speaker. You can always unmute or enable your camera in the room."
          >
            <Toggle
              on={settings.join_muted}
              onChange={(v) => saveToggle("join_muted", v)}
              label="Join with microphone muted"
              sub="Your mic stays off until you turn it on yourself"
            />
            <Toggle
              on={settings.join_camera_off}
              onChange={(v) => saveToggle("join_camera_off", v)}
              label="Join with camera off"
              sub="Your camera stays off until you turn it on yourself"
            />
          </SectionCard>
        );

      case "notifications":
        return (
          <SectionCard
            title="In-app notifications"
            sub="Applied when the notification is created — turning one off stops it at the source."
          >
            <Toggle
              on={settings.notify_follows}
              onChange={(v) => saveToggle("notify_follows", v)}
              label="New followers"
              sub="When someone starts following you"
            />
            <Toggle
              on={settings.notify_room_live}
              onChange={(v) => saveToggle("notify_room_live", v)}
              label="Live discussions"
              sub="When someone you follow goes live"
            />
          </SectionCard>
        );

      case "appearance":
        return (
          <SectionCard title="Motion" sub="AgoraSphere uses a single dark theme by design.">
            <Toggle
              on={settings.reduce_motion}
              onChange={(v) => saveToggle("reduce_motion", v)}
              label="Reduce motion"
              sub="Disables the starfield, sparkles, and interface animations"
            />
          </SectionCard>
        );

      case "privacy":
        return (
          <SectionCard title="Profile privacy" sub="Enforced on the server, not just hidden in the interface.">
            <Toggle
              on={settings.show_debate_history}
              onChange={(v) => saveToggle("show_debate_history", v)}
              label="Show my discussions on my profile"
              sub="When off, other people can't see your past or scheduled discussions"
            />
          </SectionCard>
        );

      case "blocked":
        return (
          <SectionCard
            title="Blocked users"
            sub="Blocked users can't see your profile details or interact with you."
          >
            {blocked.length === 0 ? (
              <p className="px-4 pb-4 pt-1 m-0 text-[12px]" style={{ color: "#8b8b94" }}>
                You haven't blocked anyone.
              </p>
            ) : (
              blocked.map((u) => (
                <div key={u.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span
                    className="flex items-center justify-center shrink-0 overflow-hidden"
                    style={{ width: 32, height: 32, borderRadius: "50%", background: "#3a3a42", color: "#fff", fontSize: 13 }}
                  >
                    {u.avatar_url
                      ? // eslint-disable-next-line @next/next/no-img-element
                        <img src={u.avatar_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      : displayName(u).charAt(0).toUpperCase()}
                  </span>
                  <span className="flex-1 text-[13px]" style={{ color: "#f5f5f0" }}>
                    {displayName(u)}{" "}
                    <span className="text-[11px]" style={{ color: "#8b8b94" }}>@{u.username}</span>
                  </span>
                  <button style={btnGhost} onClick={() => unblock(u)} disabled={unblockBusy === u.id}>
                    {unblockBusy === u.id ? "Unblocking…" : "Unblock"}
                  </button>
                </div>
              ))
            )}
          </SectionCard>
        );

      case "danger":
        return (
          <div style={{ ...card, border: "0.5px solid rgba(239,68,68,0.35)" }} className="mb-4 overflow-hidden">
            <div className="px-4 pt-4 pb-1">
              <p className="m-0 text-[14px]" style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, color: "#fca5a5" }}>
                Delete account
              </p>
              <p className="m-0 mt-1 text-[11px] leading-relaxed" style={{ color: "#9a9aa2" }}>
                Permanently removes your profile, sign-in credentials, follows, blocks, and settings, and signs
                you out everywhere. Discussions you took part in are kept for the other participants, attributed
                to an anonymous &ldquo;deleted&rdquo; identity. This cannot be undone.
              </p>
            </div>
            <div className="px-4 py-3.5 flex flex-col gap-2.5">
              <input
                style={inputStyle}
                placeholder={`Type "${profile.username}" to confirm`}
                value={deleteConfirm}
                onChange={(e) => setDeleteConfirm(e.target.value)}
                autoComplete="off"
              />
              {deleteErr && <p className="m-0 text-[11px]" style={{ color: "#fca5a5" }}>{deleteErr}</p>}
              <div>
                <button
                  onClick={deleteAccount}
                  disabled={deleteBusy || deleteConfirm !== profile.username}
                  style={{
                    background: "rgba(239,68,68,0.12)", border: "0.5px solid rgba(239,68,68,0.4)",
                    color: "#fca5a5", borderRadius: 9, padding: "8px 16px", fontSize: 12,
                    cursor: deleteConfirm === profile.username ? "pointer" : "not-allowed",
                    opacity: deleteConfirm === profile.username ? 1 : 0.55, fontFamily: "inherit",
                  }}
                >
                  {deleteBusy ? "Deleting…" : "Delete my account permanently"}
                </button>
              </div>
            </div>
          </div>
        );
    }
  }

  const activeMeta = useMemo(() => SECTIONS.find((s) => s.key === active), [active]);

  /* ── frame ── */

  if (loading) {
    return (
      <div className="flex items-center justify-center" style={{ width: "100vw", height: "100vh", background: "var(--bg-primary, #0a0a0c)" }}>
        <div className="animate-spin" style={{ width: 28, height: 28, borderRadius: "50%", border: "2px solid var(--accent-blue, #3b82f6)", borderTopColor: "transparent" }} />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 px-6 text-center" style={{ width: "100vw", height: "100vh", background: "var(--bg-primary, #0a0a0c)" }}>
        <p className="m-0 text-[14px]" style={{ color: "#f5f5f0" }}>{loadError}</p>
        <button style={btnPrimary} onClick={() => { setLoading(true); load(); }}>Try again</button>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-primary, #0a0a0c)", fontFamily: "'DM Sans', sans-serif" }}>
      <div className="mx-auto px-4 py-6" style={{ maxWidth: 980 }}>

        {/* header */}
        <div className="flex items-center gap-3 mb-5">
          {/* Mobile back: panel → list */}
          {mobilePanelOpen && (
            <button
              className="md:hidden"
              style={{ ...btnGhost, padding: "6px 12px" }}
              onClick={() => setMobilePanelOpen(false)}
              aria-label="Back to settings sections"
            >
              ← Back
            </button>
          )}
          <a href="/" className="hidden md:inline-block" style={{ ...btnGhost, padding: "6px 12px", textDecoration: "none" }}>
            ← Home
          </a>
          <h1 className="m-0 text-[22px]" style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 800, color: "#f5f5f0" }}>
            {mobilePanelOpen ? activeMeta?.label : "Settings"}
          </h1>
          <span
            className="ml-auto text-[11px] transition-opacity"
            style={{ color: "#97c459", opacity: savedFlash ? 1 : 0 }}
            aria-live="polite"
          >
            ✓ Saved
          </span>
        </div>

        {toggleError && (
          <p className="mb-4 px-4 py-2.5 rounded-lg text-[12px]"
            style={{ background: "rgba(239,68,68,0.08)", border: "0.5px solid rgba(239,68,68,0.3)", color: "#fca5a5" }}>
            {toggleError}
          </p>
        )}

        <div className="md:grid md:gap-6" style={{ gridTemplateColumns: "230px 1fr" }}>

          {/* section nav — full-width list on mobile (hidden once a panel is open) */}
          <nav className={mobilePanelOpen ? "hidden md:block" : "block"}>
            {SECTIONS.map((s) => (
              <button
                key={s.key}
                onClick={() => { setActive(s.key); setMobilePanelOpen(true); }}
                className="block w-full text-left cursor-pointer mb-1.5 px-3.5 py-3 border-none"
                style={{
                  borderRadius: 10,
                  background: active === s.key ? "rgba(255,255,255,0.07)" : "transparent",
                  border: "0.5px solid " + (active === s.key ? "#3a3a44" : "transparent"),
                }}
              >
                <span className="block text-[13px]" style={{ color: s.key === "danger" ? "#fca5a5" : "#f5f5f0" }}>
                  {s.label}
                </span>
                <span className="block text-[10px] mt-0.5" style={{ color: "#6b6b74" }}>{s.sub}</span>
              </button>
            ))}
            {/* Moderators get a link to the report queue; the /mod page and
                its RPCs enforce the role server-side regardless. */}
            {profile?.is_moderator && (
              <a
                href="/mod"
                className="block w-full text-left mb-1.5 px-3.5 py-3 no-underline"
                style={{ borderRadius: 10, border: "0.5px solid rgba(244,212,124,0.25)" }}
              >
                <span className="block text-[13px]" style={{ color: "#f4d47c" }}>Moderation</span>
                <span className="block text-[10px] mt-0.5" style={{ color: "#6b6b74" }}>Open the report queue</span>
              </a>
            )}
          </nav>

          {/* active panel — hidden on mobile until a section is chosen */}
          <main className={mobilePanelOpen ? "block" : "hidden md:block"}>
            {renderSection(active)}
          </main>
        </div>
      </div>

      {/* Profile editing reuses the existing modal — cooldown, availability
          check, and avatar cropping all live there already. */}
      {profile && (
        <EditProfileModal
          open={editProfileOpen}
          userId={profile.id}
          initialUsername={profile.username}
          initialDisplayName={profile.display_name}
          initialAvatarUrl={profile.avatar_url}
          initialBio={profile.bio}
          usernameChangedAt={profile.username_changed_at}
          accountCreatedAt={profile.created_at}
          onClose={() => setEditProfileOpen(false)}
          onSaved={() => { setEditProfileOpen(false); load(); }}
        />
      )}
    </div>
  );
}
