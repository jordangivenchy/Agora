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
import { DEFAULT_SETTINGS, fetchSettingsInitial, type BlockedUser, type ProfileRow, type SettingsInitial, type SettingsRow } from "@/lib/settingsData";
import { validateNewPassword } from "@/lib/passwordPolicy";
import RouteLoading from "@/components/RouteLoading";
import EditProfileModal from "@/components/EditProfileModal";
import DataAndCoachPanel from "@/components/DataAndCoachPanel";
import { SectionCard, SwitchRow } from "@/components/SettingsParts";
import type { User } from "@supabase/supabase-js";
import { displayName } from "@/lib/names";
import { PREF_GROUPS } from "@/lib/notifications";
import VerifiedMark from "@/components/VerifiedMark";

/* ── types ─────────────────────────────────────────────────── */

/* SettingsRow, DEFAULT_SETTINGS, ProfileRow, BlockedUser: lib/settingsData.ts. */

type SectionKey =
  | "profile"
  | "account"
  | "discussion"
  | "recordings"
  | "notifications"
  | "appearance"
  | "privacy"
  | "data"
  | "blocked"
  | "danger";

const SECTIONS: { key: SectionKey; label: string; sub: string }[] = [
  { key: "profile",    label: "Profile",                sub: "Name, username, bio, avatar" },
  { key: "account",    label: "Account & security",     sub: "Email, password, sessions" },
  { key: "discussion", label: "Discussion defaults",    sub: "Mic and camera on join" },
  { key: "recordings", label: "Recordings & storage",   sub: "Recordings and storage space" },
  { key: "notifications", label: "Notifications",       sub: "What you get notified about" },
  { key: "appearance", label: "Appearance & motion",    sub: "Animation preferences" },
  { key: "privacy",    label: "Privacy",                sub: "What others see" },
  { key: "data",       label: "Data & Coach",           sub: "Your data controls" },
  { key: "blocked",    label: "Blocked users",          sub: "Manage your block list" },
  { key: "danger",     label: "Danger zone",            sub: "Delete your account" },
];

/* ── small building blocks ─────────────────────────────────── */

/* The site's solid look, the same values as the notifications page and
   the call card: black bodies with a hairline, near-black tiles for what
   you press or type in, and the brand yellow for what is switched on.
   Nothing tinted or see-through — the starfield behind the page showed
   through the old cards. The card and the switch row are
   SettingsParts.tsx; every size and gap is a `.stg-*` rule in
   globals.css, one set for the whole page. */

/* ── page ──────────────────────────────────────────────────── */

export default function SettingsPage({ initial }: {
  /** The first view, fetched by the route on the server: the page
      renders with it at once and refreshes in the browser as before. */
  initial?: SettingsInitial;
}) {
  const seed = initial && initial.status === "ok" ? initial : null;
  const [supabase] = useState(() => createClient());
  const router = useRouter();

  const [authUser, setAuthUser] = useState<User | null>(seed?.authUser ?? null);
  const [profile, setProfile] = useState<ProfileRow | null>(seed?.profile ?? null);
  const [settings, setSettings] = useState<SettingsRow>(seed?.settings ?? DEFAULT_SETTINGS);
  const [blocked, setBlocked] = useState<BlockedUser[]>(seed?.blocked ?? []);
  const [loading, setLoading] = useState(!seed);
  const [loadError, setLoadError] = useState<string | null>(initial && initial.status === "error" ? initial.message : null);

  const [active, setActive] = useState<SectionKey>("profile");

  /* Recording storage usage — fetched when the Recordings section opens. */
  const [recUsage, setRecUsage] = useState<{ used_bytes: number; limit_mb: number } | null>(null);
  useEffect(() => {
    if (active !== "recordings" || !authUser) return;
    let cancelled = false;
    supabase.rpc("get_recording_usage").then(({ data }) => {
      if (cancelled || !data || typeof data !== "object") return;
      const d = data as { used_bytes?: number; limit_mb?: number };
      setRecUsage({ used_bytes: d.used_bytes ?? 0, limit_mb: d.limit_mb ?? 5120 });
    });
    return () => { cancelled = true; };
  }, [active, authUser, supabase]);
  // Mobile is list ⇄ panel; desktop always shows both.
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);

  const [savedFlash, setSavedFlash] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);

  const [editProfileOpen, setEditProfileOpen] = useState(false);

  /* ── load everything ── */
  const load = useCallback(async () => {
    try {
      const r = await fetchSettingsInitial(supabase);
      if (r.status === "login") { router.replace("/login"); return; }
      if (r.status === "error") throw new Error(r.message);
      setAuthUser(r.authUser);
      setProfile(r.profile);
      setSettings(r.settings);
      setBlocked(r.blocked);
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

  /* ── per-type notification prefs (get/set_notification_pref RPCs) ── */
  const [prefs, setPrefs] = useState<Record<string, boolean> | null>(null);
  useEffect(() => {
    if (!authUser) return;
    let cancelled = false;
    supabase.rpc("get_notification_prefs").then(({ data }) => {
      if (!cancelled) setPrefs((data as Record<string, boolean> | null) ?? {});
    });
    return () => { cancelled = true; };
  }, [authUser, supabase]);

  const savePref = useCallback(
    async (type: string, value: boolean) => {
      if (!prefs) return;
      const prev = prefs[type] ?? true;
      setPrefs((p) => ({ ...(p ?? {}), [type]: value }));
      setToggleError(null);
      const { data, error } = await supabase.rpc("set_notification_pref", { p_type: type, p_enabled: value });
      if (error) {
        setPrefs((p) => ({ ...(p ?? {}), [type]: prev }));
        setToggleError("Couldn't save — check your connection and try again.");
      } else {
        if (data) setPrefs(data as Record<string, boolean>);
        // Mirror the legacy booleans the rest of the form still carries.
        if (type === "new_follower" || type === "friend_accepted") setSettings((s) => ({ ...s, notify_follows: value }));
        if (type === "room_live" || type === "followed_live") setSettings((s) => ({ ...s, notify_room_live: value }));
        if (type === "community_post") setSettings((s) => ({ ...s, notify_community_posts: value }));
        setSavedFlash(true);
        setTimeout(() => setSavedFlash(false), 1400);
      }
    },
    [prefs, supabase]
  );

  /* ── email notification prefs (get/set_email_* RPCs, 20260854) ── */
  type EmailPrefs = { types: Record<string, boolean>; digest: "off" | "weekly"; unsubscribed: boolean };
  const [emailPrefs, setEmailPrefs] = useState<EmailPrefs | null>(null);
  useEffect(() => {
    if (!authUser) return;
    let cancelled = false;
    supabase.rpc("get_email_prefs").then(({ data, error }) => {
      if (cancelled) return;
      // Pre-migration DBs have no RPC yet: leave the section disabled.
      setEmailPrefs(error ? null : ((data as EmailPrefs | null) ?? { types: {}, digest: "weekly", unsubscribed: false }));
    });
    return () => { cancelled = true; };
  }, [authUser, supabase]);

  const applyEmailRpc = useCallback(
    async (fn: "set_email_pref" | "set_email_digest" | "set_email_unsubscribed", args: Record<string, unknown>, optimistic: (p: EmailPrefs) => EmailPrefs) => {
      if (!emailPrefs) return;
      const prev = emailPrefs;
      setEmailPrefs(optimistic(prev));
      setToggleError(null);
      const { data, error } = await supabase.rpc(fn, args);
      if (error) {
        setEmailPrefs(prev);
        setToggleError("Couldn't save — check your connection and try again.");
      } else {
        if (data) setEmailPrefs(data as EmailPrefs);
        setSavedFlash(true);
        setTimeout(() => setSavedFlash(false), 1400);
      }
    },
    [emailPrefs, supabase]
  );
  const saveEmailPref = (type: string, value: boolean) =>
    applyEmailRpc("set_email_pref", { p_type: type, p_enabled: value }, (p) => ({ ...p, types: { ...p.types, [type]: value } }));
  const saveEmailDigest = (on: boolean) =>
    applyEmailRpc("set_email_digest", { p_mode: on ? "weekly" : "off" }, (p) => ({ ...p, digest: on ? "weekly" : "off" }));
  const saveEmailUnsub = (on: boolean) =>
    applyEmailRpc("set_email_unsubscribed", { p_on: on }, (p) => ({ ...p, unsubscribed: on }));

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
    // Server-side so the check passes the 2FA password-verification hook.
    const reauthRes = await fetch("/api/auth/reauth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: curPw }),
    }).catch(() => null);
    if (!reauthRes?.ok) {
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
      // Security notification email (no-op until Resend is configured).
      fetch("/api/notify/password-changed", { method: "POST" }).catch(() => {});
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

  /* ── 2FA (email codes, server-verified) ──
     Enabling: /enroll/start emails a code, /enroll/verify flips the flag —
     proving the inbox works before the account depends on it. Disabling
     re-checks the password server-side. Status is the one client-readable
     surface (RLS: select own row). */
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);
  const [twoFactorBusy, setTwoFactorBusy] = useState(false);
  const [twoFactorMsg, setTwoFactorMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [enrollPending, setEnrollPending] = useState<string | null>(null);
  const [enrollCode, setEnrollCode] = useState("");
  const [disableOpen, setDisableOpen] = useState(false);
  const [disablePw, setDisablePw] = useState("");
  const hasPasswordIdentity = (authUser?.identities ?? []).some((i) => i.provider === "email");

  useEffect(() => {
    if (!authUser) return;
    (async () => {
      const { data } = await supabase
        .from("user_2fa")
        .select("enabled")
        .eq("user_id", authUser.id)
        .maybeSingle();
      if (data) setTwoFactorEnabled(data.enabled);
    })();
  }, [authUser, supabase]);

  async function twoFactorPost(path: string, body: Record<string, unknown>) {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, error: (json as { error?: string }).error };
  }

  async function startEnrollFlow() {
    setTwoFactorBusy(true);
    setTwoFactorMsg(null);
    try {
      const res = await fetch("/api/auth/2fa/enroll/start", { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.pending) {
        setTwoFactorMsg({ kind: "err", text: json.error ?? "Couldn't start enrollment." });
        return;
      }
      setEnrollPending(json.pending);
      setEnrollCode("");
      setTwoFactorMsg({ kind: "ok", text: "We emailed you a 6-digit code — enter it below." });
    } catch {
      setTwoFactorMsg({ kind: "err", text: "Couldn't start enrollment. Check your connection." });
    } finally {
      setTwoFactorBusy(false);
    }
  }

  async function verifyEnroll(e: React.FormEvent) {
    e.preventDefault();
    if (!enrollPending || enrollCode.length !== 6) return;
    setTwoFactorBusy(true);
    setTwoFactorMsg(null);
    const { ok, error } = await twoFactorPost("/api/auth/2fa/enroll/verify", {
      pending: enrollPending,
      code: enrollCode,
    });
    setTwoFactorBusy(false);
    if (!ok) {
      setEnrollCode("");
      setTwoFactorMsg({ kind: "err", text: error ?? "Invalid or expired code." });
      return;
    }
    setTwoFactorEnabled(true);
    setEnrollPending(null);
    setEnrollCode("");
    setTwoFactorMsg({ kind: "ok", text: "Two-factor authentication is on. You'll enter an emailed code when signing in." });
  }

  async function disable2fa(e: React.FormEvent) {
    e.preventDefault();
    if (hasPasswordIdentity && !disablePw) return;
    setTwoFactorBusy(true);
    setTwoFactorMsg(null);
    const { ok, error } = await twoFactorPost("/api/auth/2fa/disable", { password: disablePw });
    setTwoFactorBusy(false);
    setDisablePw("");
    if (!ok) {
      setTwoFactorMsg({ kind: "err", text: error ?? "Couldn't disable two-factor authentication." });
      return;
    }
    setTwoFactorEnabled(false);
    setDisableOpen(false);
    setTwoFactorMsg({ kind: "ok", text: "Two-factor authentication has been disabled." });
  }

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
            <div className="stg-row">
              <div className="stg-person is-large">
                <span className="stg-avatar is-large">
                  {profile.avatar_url
                    ? // eslint-disable-next-line @next/next/no-img-element
                      <img src={profile.avatar_url} alt="" />
                    : displayName(profile).charAt(0).toUpperCase()}
                </span>
                <div className="stg-person-text">
                  <p className="stg-person-name">
                    <span>{displayName(profile)}</span>
                    <VerifiedMark username={profile.username} />
                  </p>
                  <p className="stg-person-handle">@{profile.username}</p>
                  {profile.bio && <p className="stg-person-bio">{profile.bio}</p>}
                </div>
                <button className="stg-btn" onClick={() => setEditProfileOpen(true)}>
                  Edit profile
                </button>
              </div>
            </div>
            <p className="stg-row is-note">Username changes are limited to once every 7 days.</p>
          </SectionCard>
        );

      case "account":
        return (
          <>
            <SectionCard title="Email" sub={`Signed in as ${profile.email}`}>
              <form onSubmit={changeEmail} className="stg-body">
                <input
                  className="stg-input"
                  type="email"
                  placeholder="New email address"
                  aria-label="New email address"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  autoComplete="email"
                />
                {emailMsg && <p className={`stg-msg is-${emailMsg.kind}`}>{emailMsg.text}</p>}
                <div className="stg-actions">
                  <button className="stg-btn" disabled={emailBusy || !newEmail.trim()} type="submit">
                    {emailBusy ? "Sending…" : "Change email"}
                  </button>
                </div>
              </form>
            </SectionCard>

            <SectionCard title="Password" sub="Requires your current password.">
              <form onSubmit={changePassword} className="stg-body">
                <input className="stg-input" type="password" placeholder="Current password" aria-label="Current password"
                  value={curPw} onChange={(e) => setCurPw(e.target.value)} autoComplete="current-password" />
                <input className="stg-input" type="password" placeholder="New password" aria-label="New password"
                  value={newPw} onChange={(e) => setNewPw(e.target.value)} autoComplete="new-password" />
                <input className="stg-input" type="password" placeholder="Confirm new password" aria-label="Confirm new password"
                  value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} autoComplete="new-password" />
                {pwMsg && <p className={`stg-msg is-${pwMsg.kind}`}>{pwMsg.text}</p>}
                <div className="stg-actions">
                  <button className="stg-btn" disabled={pwBusy || !curPw || !newPw} type="submit">
                    {pwBusy ? "Updating…" : "Update password"}
                  </button>
                  <a href="/forgot-password" className="stg-link">
                    Forgot your password?
                  </a>
                </div>
              </form>
            </SectionCard>

            <SectionCard title="Sessions" sub="Signs you out on every device, including this one.">
              <div className="stg-body">
                <div className="stg-actions">
                  <button className="stg-btn stg-btn--quiet" onClick={signOutEverywhere} disabled={signoutBusy}>
                    {signoutBusy ? "Signing out…" : "Sign out everywhere"}
                  </button>
                </div>
              </div>
            </SectionCard>

            <SectionCard title="Two-factor authentication" sub="Enter an emailed code each time you sign in with your password.">
              <div className="stg-body">
                {/* What just happened, or what to do next, reads before the
                    field it is about ("we emailed you a code"). */}
                {twoFactorMsg && <p className={`stg-msg is-${twoFactorMsg.kind}`}>{twoFactorMsg.text}</p>}

                {!twoFactorEnabled && !enrollPending && (
                  <div className="stg-actions">
                    <button onClick={startEnrollFlow} disabled={twoFactorBusy} className="stg-btn">
                      {twoFactorBusy ? "Sending code…" : "Enable 2FA"}
                    </button>
                  </div>
                )}

                {!twoFactorEnabled && enrollPending && (
                  <form onSubmit={verifyEnroll} className="stg-inline">
                    <input
                      className="stg-input is-code"
                      type="text"
                      inputMode="numeric"
                      placeholder="000000"
                      aria-label="6-digit code"
                      autoComplete="off"
                      value={enrollCode}
                      onChange={(e) => setEnrollCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    />
                    <button className="stg-btn" disabled={twoFactorBusy || enrollCode.length !== 6} type="submit">
                      {twoFactorBusy ? "Verifying…" : "Verify"}
                    </button>
                    <button
                      className="stg-btn stg-btn--quiet"
                      type="button"
                      onClick={() => {
                        setEnrollPending(null);
                        setEnrollCode("");
                        setTwoFactorMsg(null);
                      }}
                    >
                      Cancel
                    </button>
                  </form>
                )}

                {twoFactorEnabled && !disableOpen && (
                  <div className="stg-actions">
                    <button className="stg-btn stg-btn--quiet" onClick={() => setDisableOpen(true)}>
                      Disable 2FA
                    </button>
                    <p className="stg-msg is-ok">
                      ✓ Active — you&apos;ll be asked for an emailed code at sign-in.
                    </p>
                  </div>
                )}

                {twoFactorEnabled && disableOpen && (
                  <form onSubmit={disable2fa} className="stg-inline">
                    {hasPasswordIdentity && (
                      <input
                        className="stg-input"
                        type="password"
                        placeholder="Current password"
                        aria-label="Current password"
                        autoComplete="current-password"
                        value={disablePw}
                        onChange={(e) => setDisablePw(e.target.value)}
                      />
                    )}
                    <button
                      className="stg-btn"
                      disabled={twoFactorBusy || (hasPasswordIdentity && !disablePw)}
                      type="submit"
                    >
                      {twoFactorBusy ? "Disabling…" : "Confirm disable"}
                    </button>
                    <button
                      className="stg-btn stg-btn--quiet"
                      type="button"
                      onClick={() => {
                        setDisableOpen(false);
                        setDisablePw("");
                        setTwoFactorMsg(null);
                      }}
                    >
                      Cancel
                    </button>
                  </form>
                )}
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
            <SwitchRow
              on={settings.join_muted}
              onChange={(v) => saveToggle("join_muted", v)}
              label="Join with microphone muted"
              sub="Your mic stays off until you turn it on yourself"
            />
            <SwitchRow
              on={settings.join_camera_off}
              onChange={(v) => saveToggle("join_camera_off", v)}
              label="Join with camera off"
              sub="Your camera stays off until you turn it on yourself"
            />
          </SectionCard>
        );

      case "recordings": {
        const usedGb = recUsage ? recUsage.used_bytes / (1024 ** 3) : null;
        const limitGb = recUsage ? recUsage.limit_mb / 1024 : null;
        const pct = recUsage
          ? Math.min(100, (recUsage.used_bytes / (recUsage.limit_mb * 1024 * 1024)) * 100)
          : 0;
        const full = recUsage
          ? recUsage.used_bytes >= recUsage.limit_mb * 1024 * 1024
          : false;
        return (
          <>
            <SectionCard
              title="Discussion recordings (VODs)"
              sub="Recordings let people rewatch your ended discussions and let big audiences watch over the broadcast stream."
            >
              <SwitchRow
                on={settings.record_debates}
                onChange={(v) => saveToggle("record_debates", v)}
                label="Record discussions I host"
                sub="Turning this off means no recording exists afterward, and very large audiences can't overflow to the broadcast view"
              />
            </SectionCard>
            <SectionCard title="Storage" sub="Recordings of discussions you host count against your space.">
              <div className="stg-body">
                {recUsage ? (
                  <>
                    <p className="stg-usage">
                      <span>
                        <strong>{usedGb! < 0.1 && recUsage.used_bytes > 0 ? "<0.1" : usedGb!.toFixed(1)} GB</strong>
                        {" "}of {limitGb!.toFixed(0)} GB used
                      </span>
                      {full && (
                        <span className="stg-msg is-err">
                          Storage full — new discussions aren&rsquo;t recorded
                        </span>
                      )}
                    </p>
                    <div
                      className={`stg-meter${full ? " is-full" : ""}`}
                      role="progressbar"
                      aria-label="Recording space used"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(pct)}
                    >
                      <span style={{ width: `${pct}%` }} />
                    </div>
                  </>
                ) : (
                  <p className="stg-text">Loading your usage…</p>
                )}
                <p className="stg-note">
                  Every account includes 5 GB of recording space — roughly 2½ hours of discussion.
                  More storage is coming with AgoraSphere subscriptions.
                </p>
              </div>
            </SectionCard>
          </>
        );
      }

      case "notifications":
        return (
          <>
            {PREF_GROUPS.map((g) => (
              <SectionCard
                key={g.title}
                title={g.title}
                sub={g.title === "Discussions"
                  ? "Applied when the notification is created — turning one off stops it at the source."
                  : undefined}
              >
                {g.items.map((it) => (
                  <SwitchRow
                    key={it.type}
                    on={prefs?.[it.type] ?? true}
                    disabled={prefs === null}
                    onChange={(v) => savePref(it.type, v)}
                    label={it.label}
                    sub={it.sub}
                  />
                ))}
              </SectionCard>
            ))}
            <SectionCard title="Push" sub="Web push is enabled per browser from the bell menu.">
              <div className="stg-body">
                <p className="stg-text">
                  Live, scheduled and replay-ready alerts from people you follow go out as push notifications
                  on every browser where you&apos;ve enabled them. Each one still respects the toggles above.
                </p>
              </div>
            </SectionCard>

            <SectionCard
              title="Email"
              sub={emailPrefs === null
                ? "Email preferences aren't available yet."
                : `Sent to ${profile?.email ?? "your address"}. Several at once are grouped into one message. Security emails always arrive.`}
            >
              {emailPrefs?.unsubscribed && (
                <div className="stg-banner">
                  <span>Unsubscribed from all email</span>
                  <button type="button" onClick={() => saveEmailUnsub(false)}>
                    Resubscribe
                  </button>
                </div>
              )}
              <SwitchRow
                on={emailPrefs?.digest === "weekly"}
                disabled={emailPrefs === null || Boolean(emailPrefs?.unsubscribed)}
                onChange={saveEmailDigest}
                label="Weekly digest"
                sub="Saturday mornings: unread, upcoming discussions from people you follow, top posts in your communities"
              />
              {PREF_GROUPS.map((g) => (
                <div key={g.title} role="group" aria-label={`Email: ${g.title}`}>
                  <p className="stg-group">{g.title}</p>
                  {g.items.map((it) => (
                    <SwitchRow
                      key={it.type}
                      on={emailPrefs?.types[it.type] ?? false}
                      disabled={emailPrefs === null || Boolean(emailPrefs?.unsubscribed) || prefs?.[it.type] === false}
                      onChange={(v) => saveEmailPref(it.type, v)}
                      label={it.label}
                      sub={prefs?.[it.type] === false ? "Turned off above — enable the notification first" : it.sub}
                    />
                  ))}
                </div>
              ))}
            </SectionCard>
          </>
        );

      case "appearance":
        return (
          <SectionCard title="Motion" sub="AgoraSphere uses a single dark theme by design.">
            <SwitchRow
              on={settings.reduce_motion}
              onChange={(v) => saveToggle("reduce_motion", v)}
              label="Reduce motion"
              sub="Disables the starfield, sparkles, and interface animations"
            />
          </SectionCard>
        );

      case "data":
        return <DataAndCoachPanel />;

      case "privacy":
        return (
          <SectionCard title="Profile privacy" sub="Enforced on the server, not just hidden in the interface.">
            <SwitchRow
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
              <p className="stg-row is-empty">You haven&apos;t blocked anyone.</p>
            ) : (
              blocked.map((u) => (
                <div key={u.id} className="stg-row">
                  <div className="stg-person">
                    <span className="stg-avatar">
                      {u.avatar_url
                        ? // eslint-disable-next-line @next/next/no-img-element
                          <img src={u.avatar_url} alt="" />
                        : displayName(u).charAt(0).toUpperCase()}
                    </span>
                    <div className="stg-person-text">
                      <p className="stg-person-name">
                        <span>{displayName(u)}</span>
                        <VerifiedMark id={u.id} username={u.username} />
                      </p>
                      <p className="stg-person-handle">@{u.username}</p>
                    </div>
                  </div>
                  <button className="stg-btn stg-btn--quiet" onClick={() => unblock(u)} disabled={unblockBusy === u.id}>
                    {unblockBusy === u.id ? "Unblocking…" : "Unblock"}
                  </button>
                </div>
              ))
            )}
          </SectionCard>
        );

      case "danger":
        return (
          <SectionCard
            danger
            title="Delete account"
            text={<>
              Permanently removes your profile, sign-in credentials, follows, blocks, and settings, and signs
              you out everywhere. Discussions you took part in are kept for the other participants, attributed
              to an anonymous &ldquo;deleted&rdquo; identity. This cannot be undone.
            </>}
          >
            <div className="stg-body">
              <input
                className="stg-input"
                placeholder={`Type "${profile.username}" to confirm`}
                aria-label={`Type ${profile.username} to confirm`}
                value={deleteConfirm}
                onChange={(e) => setDeleteConfirm(e.target.value)}
                autoComplete="off"
              />
              {deleteErr && <p className="stg-msg is-err">{deleteErr}</p>}
              <div className="stg-actions">
                <button
                  onClick={deleteAccount}
                  disabled={deleteBusy || deleteConfirm !== profile.username}
                  className="stg-btn stg-btn--danger"
                >
                  {deleteBusy ? "Deleting…" : "Delete my account permanently"}
                </button>
              </div>
            </div>
          </SectionCard>
        );
    }
  }

  const activeMeta = useMemo(() => SECTIONS.find((s) => s.key === active), [active]);

  /* ── frame ── */

  if (loading) return <RouteLoading />;

  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 px-6 text-center" style={{ width: "100vw", height: "100vh", background: "var(--bg-primary, #0a0a0c)" }}>
        <p className="m-0 text-[14px]" style={{ color: "#f5f5f0" }}>{loadError}</p>
        <button className="stg-btn" onClick={() => { setLoading(true); load(); }}>Try again</button>
      </div>
    );
  }

  return (
    <>
    <div className="replay-beside-sidebar settings-shell" style={{ fontFamily: "'DM Sans', sans-serif" }}>
      <div className="settings-inner" style={{ maxWidth: 980, margin: 0, padding: "var(--page-gap-top, 12px) 20px 24px" }}>

        {/* header */}
        <div className="flex items-center gap-3 mb-5 settings-head">
          {/* No back button. The site's own bar goes anywhere from here;
              on a phone, inside a section, the title reads "Settings ›
              Account & security" and its first word is the way back to
              the list. */}
          <h1 className="m-0 text-[22px] settings-title" style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 800, color: "#f5f5f0" }}>
            <span className={mobilePanelOpen ? "hidden md:inline" : undefined}>Settings</span>
            {mobilePanelOpen && (
              <span className="md:hidden">
                <button type="button" className="stg-crumb" onClick={() => setMobilePanelOpen(false)} aria-label="Back to settings sections">
                  Settings
                </button>
                <span className="stg-crumb-sep" aria-hidden="true" />
                {activeMeta?.label}
              </span>
            )}
          </h1>
          <span
            className="ml-auto text-[11px] transition-opacity"
            style={{ color: "#97c459", opacity: savedFlash ? 1 : 0 }}
            aria-live="polite"
          >
            ✓ Saved
          </span>
        </div>

        {toggleError && <p className="stg-banner is-page" role="alert">{toggleError}</p>}

        {/* Two columns on a wide page; on a phone the list, or the section
            stepped into (`data-panel`), never both. */}
        <div className="stg-layout" data-panel={mobilePanelOpen ? "open" : undefined}>

          <nav className="stg-nav" aria-label="Settings sections">
            {SECTIONS.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => { setActive(s.key); setMobilePanelOpen(true); }}
                className={`stg-nav-item${active === s.key ? " is-active" : ""}${s.key === "danger" ? " is-danger" : ""}`}
                aria-current={active === s.key ? "page" : undefined}
              >
                <span className="stg-nav-label">{s.label}</span>
                <span className="stg-nav-sub">{s.sub}</span>
              </button>
            ))}
            {/* Moderators get a link to the report queue; the /mod page and
                its RPCs enforce the role server-side regardless. */}
            {profile?.is_moderator && (
              <a href="/mod" className="stg-nav-item is-mod">
                <span className="stg-nav-label">Moderation</span>
                <span className="stg-nav-sub">Open the report queue</span>
              </a>
            )}
          </nav>

          <main className="stg-main">
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
    </>
  );
}
