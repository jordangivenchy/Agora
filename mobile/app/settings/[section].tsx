/* One settings panel, backed by the same rows and RPCs as the site's
   page (components/SettingsPage.tsx): profile, account & security,
   discussion defaults, recordings, notifications, appearance, privacy,
   data & coach, blocked users, the danger zone. */
import { useCallback, useEffect, useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, Share, Text, View } from "react-native";
import { Stack, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { supabase } from "../../src/supabase";
import { useSession } from "../../src/session";
import { apiFetch } from "../../src/api";
import { setReduceMotion } from "../../src/motion";
import { fetchSettings, saveSettings, validateNewPassword, CONSENT_CATEGORIES, DEFAULT_CONSENT, DEFAULT_SETTINGS, PREF_GROUPS, type BlockedUser, type Consent, type ConsentCategory, type EmailPrefs, type SettingsData, type SettingsRow } from "../../src/settings";
import { SECTIONS, type SectionKey } from "./index";
import { Btn, Input, Msg, Pad, SectionCard, Toggle } from "../../src/settingsUi";
import { Avatar } from "../../src/avatar";
import { LoadingLine } from "../../src/sky";
import { colors, fonts } from "../../src/theme";
import { Screen } from "../../src/ui";

/* The coach and the analysis built on it are coming soon (lib/features.ts). */
const AGORA_AI = false;
const ALL_OFF: Consent = { analytics: false, debate_analysis: false, personalization: false, coaching: false };
type M = { kind: "ok" | "err"; text: string } | null;

export default function SettingsSection() {
  const params = useLocalSearchParams<{ section: string }>();
  const key = (typeof params.section === "string" ? params.section : "profile") as SectionKey;
  const meta = SECTIONS.find((s) => s.key === key);
  const { session, pass, signOut } = useSession();
  const user = session?.user ?? null;
  const auth = { token: session?.access_token, pass };

  const [data, setData] = useState<SettingsData | null>(null);
  const [settings, setSettings] = useState<SettingsRow>(DEFAULT_SETTINGS);
  const [blocked, setBlocked] = useState<BlockedUser[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const d = await fetchSettings(supabase, user);
      setData(d);
      setSettings(d.settings);
      setBlocked(d.blocked);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load settings");
    }
  }, [user]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const flash = () => { setSaved(true); setTimeout(() => setSaved(false), 1400); };

  const saveToggle = async (k: keyof SettingsRow, value: boolean) => {
    if (!user) return;
    const prev = settings[k];
    const next = { ...settings, [k]: value };
    setSettings(next);
    setToggleError(null);
    if (k === "reduce_motion") setReduceMotion(value);
    const err = await saveSettings(supabase, user.id, next);
    if (err) {
      setSettings((s) => ({ ...s, [k]: prev }));
      if (k === "reduce_motion") setReduceMotion(prev);
      setToggleError(err);
    } else flash();
  };

  /* Recording storage usage. */
  const [recUsage, setRecUsage] = useState<{ used_bytes: number; limit_mb: number } | null>(null);
  useEffect(() => {
    if (key !== "recordings" || !user) return;
    let on = true;
    void supabase.rpc("get_recording_usage").then(({ data: d }) => {
      if (!on || !d || typeof d !== "object") return;
      const u = d as { used_bytes?: number; limit_mb?: number };
      setRecUsage({ used_bytes: u.used_bytes ?? 0, limit_mb: u.limit_mb ?? 5120 });
    });
    return () => { on = false; };
  }, [key, user]);

  /* Per-type notification preferences and the email ones. */
  const [prefs, setPrefs] = useState<Record<string, boolean> | null>(null);
  const [emailPrefs, setEmailPrefs] = useState<EmailPrefs | null | undefined>(undefined);
  useEffect(() => {
    if (key !== "notifications" || !user) return;
    let on = true;
    void supabase.rpc("get_notification_prefs").then(({ data: d }) => { if (on) setPrefs((d as Record<string, boolean> | null) ?? {}); });
    void supabase.rpc("get_email_prefs").then(({ data: d, error }) => {
      if (!on) return;
      setEmailPrefs(error ? null : ((d as EmailPrefs | null) ?? { types: {}, digest: "weekly", unsubscribed: false }));
    });
    return () => { on = false; };
  }, [key, user]);

  const savePref = async (type: string, value: boolean) => {
    if (!prefs) return;
    const prev = prefs[type] ?? true;
    setPrefs((p) => ({ ...(p ?? {}), [type]: value }));
    setToggleError(null);
    const { data: d, error } = await supabase.rpc("set_notification_pref", { p_type: type, p_enabled: value });
    if (error) {
      setPrefs((p) => ({ ...(p ?? {}), [type]: prev }));
      setToggleError("Couldn't save — check your connection and try again.");
    } else {
      if (d) setPrefs(d as Record<string, boolean>);
      flash();
    }
  };

  const applyEmailRpc = async (fn: "set_email_pref" | "set_email_digest" | "set_email_unsubscribed", args: Record<string, unknown>, optimistic: (p: EmailPrefs) => EmailPrefs) => {
    if (!emailPrefs) return;
    const prev = emailPrefs;
    setEmailPrefs(optimistic(prev));
    setToggleError(null);
    const { data: d, error } = await supabase.rpc(fn, args);
    if (error) {
      setEmailPrefs(prev);
      setToggleError("Couldn't save — check your connection and try again.");
    } else {
      if (d) setEmailPrefs(d as EmailPrefs);
      flash();
    }
  };

  /* Email change. */
  const [newEmail, setNewEmail] = useState("");
  const [emailMsg, setEmailMsg] = useState<M>(null);
  const [emailBusy, setEmailBusy] = useState(false);
  async function changeEmail() {
    const email = newEmail.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { setEmailMsg({ kind: "err", text: "Enter a valid email address." }); return; }
    setEmailBusy(true);
    setEmailMsg(null);
    const { error } = await supabase.auth.updateUser({ email });
    setEmailBusy(false);
    if (error) setEmailMsg({ kind: "err", text: error.message });
    else { setEmailMsg({ kind: "ok", text: "Confirmation links sent. Your email only changes after you confirm from the new address." }); setNewEmail(""); }
  }

  /* Password change: the current one is checked on the server first. */
  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwMsg, setPwMsg] = useState<M>(null);
  const [pwBusy, setPwBusy] = useState(false);
  const hasPasswordIdentity = (user?.identities ?? []).some((i) => i.provider === "email");
  async function changePassword() {
    if (!user?.email) return;
    const policyError = validateNewPassword(newPw, confirmPw);
    if (policyError) { setPwMsg({ kind: "err", text: policyError }); return; }
    setPwBusy(true);
    setPwMsg(null);
    const re = await apiFetch("/api/auth/reauth", auth, { method: "POST", body: JSON.stringify({ password: curPw }) }).catch(() => null);
    if (!re?.ok) { setPwBusy(false); setPwMsg({ kind: "err", text: "Current password is incorrect." }); return; }
    const { error } = await supabase.auth.updateUser({ password: newPw });
    setPwBusy(false);
    if (error) setPwMsg({ kind: "err", text: error.message });
    else {
      setPwMsg({ kind: "ok", text: "Password updated." });
      setCurPw(""); setNewPw(""); setConfirmPw("");
      apiFetch("/api/notify/password-changed", auth, { method: "POST" }).catch(() => {});
    }
  }

  /* Sign out everywhere. */
  const [signoutBusy, setSignoutBusy] = useState(false);
  async function signOutEverywhere() {
    setSignoutBusy(true);
    await supabase.auth.signOut({ scope: "global" }).catch(() => {});
    await signOut();
    router.replace("/sign-in");
  }

  /* Two-factor: emailed codes, verified on the server. */
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);
  const [twoFactorBusy, setTwoFactorBusy] = useState(false);
  const [twoFactorMsg, setTwoFactorMsg] = useState<M>(null);
  const [enrollPending, setEnrollPending] = useState<string | null>(null);
  const [enrollCode, setEnrollCode] = useState("");
  const [disableOpen, setDisableOpen] = useState(false);
  const [disablePw, setDisablePw] = useState("");
  useEffect(() => {
    if (key !== "account" || !user) return;
    let on = true;
    void supabase.from("user_2fa").select("enabled").eq("user_id", user.id).maybeSingle().then(({ data: d }) => { if (on && d) setTwoFactorEnabled(!!(d as { enabled: boolean }).enabled); });
    return () => { on = false; };
  }, [key, user]);
  async function twoFactorPost(path: string, body: Record<string, unknown>) {
    const res = await apiFetch(path, auth, { method: "POST", body: JSON.stringify(body) }).catch(() => null);
    const json = ((await res?.json().catch(() => ({}))) ?? {}) as { error?: string; pending?: string };
    return { ok: !!res?.ok, error: json.error, pending: json.pending };
  }
  async function startEnrollFlow() {
    setTwoFactorBusy(true);
    setTwoFactorMsg(null);
    const r = await twoFactorPost("/api/auth/2fa/enroll/start", {});
    setTwoFactorBusy(false);
    if (!r.ok || !r.pending) { setTwoFactorMsg({ kind: "err", text: r.error ?? "Couldn't start enrollment." }); return; }
    setEnrollPending(r.pending);
    setEnrollCode("");
    setTwoFactorMsg({ kind: "ok", text: "We emailed you a 6-digit code — enter it below." });
  }
  async function verifyEnroll() {
    if (!enrollPending || enrollCode.length !== 6) return;
    setTwoFactorBusy(true);
    setTwoFactorMsg(null);
    const r = await twoFactorPost("/api/auth/2fa/enroll/verify", { pending: enrollPending, code: enrollCode });
    setTwoFactorBusy(false);
    if (!r.ok) { setEnrollCode(""); setTwoFactorMsg({ kind: "err", text: r.error ?? "Invalid or expired code." }); return; }
    setTwoFactorEnabled(true);
    setEnrollPending(null);
    setEnrollCode("");
    setTwoFactorMsg({ kind: "ok", text: "Two-factor authentication is on. You'll enter an emailed code when signing in." });
  }
  async function disable2fa() {
    if (hasPasswordIdentity && !disablePw) return;
    setTwoFactorBusy(true);
    setTwoFactorMsg(null);
    const r = await twoFactorPost("/api/auth/2fa/disable", { password: disablePw });
    setTwoFactorBusy(false);
    setDisablePw("");
    if (!r.ok) { setTwoFactorMsg({ kind: "err", text: r.error ?? "Couldn't disable two-factor authentication." }); return; }
    setTwoFactorEnabled(false);
    setDisableOpen(false);
    setTwoFactorMsg({ kind: "ok", text: "Two-factor authentication has been disabled." });
  }

  /* Unblock. */
  const [unblockBusy, setUnblockBusy] = useState<string | null>(null);
  async function unblock(target: BlockedUser) {
    setUnblockBusy(target.id);
    const { error } = await supabase.rpc("unblock_user", { p_target: target.id });
    setUnblockBusy(null);
    if (!error) setBlocked((b) => b.filter((u) => u.id !== target.id));
  }

  /* Delete account. */
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);
  async function deleteAccount() {
    if (!data || deleteConfirm !== data.profile.username) return;
    setDeleteBusy(true);
    setDeleteErr(null);
    const { error } = await supabase.rpc("delete_own_account");
    if (error) { setDeleteBusy(false); setDeleteErr(error.message); return; }
    await signOut().catch(() => {});
    router.replace("/sign-in");
  }

  /* Data & coach: consent, download, erase. */
  const [consent, setConsent] = useState<Consent>(DEFAULT_CONSENT);
  const [consentLoaded, setConsentLoaded] = useState(false);
  const [dataBusy, setDataBusy] = useState(false);
  const [dataMsg, setDataMsg] = useState<M>(null);
  useEffect(() => {
    if (key !== "data" || !user) return;
    let on = true;
    void supabase.from("user_data_consent").select("analytics, debate_analysis, personalization, coaching").eq("user_id", user.id).maybeSingle().then(({ data: d }) => {
      if (!on) return;
      setConsent((d as Consent | null) ?? DEFAULT_CONSENT);
      setConsentLoaded(true);
    });
    return () => { on = false; };
  }, [key, user]);
  async function toggleConsent(k: ConsentCategory) {
    if (!user) return;
    const next = { ...consent, [k]: !consent[k] };
    setConsent(next);
    await supabase.from("user_data_consent").upsert({ user_id: user.id, ...next, updated_at: new Date().toISOString() });
  }
  async function download() {
    setDataBusy(true);
    setDataMsg(null);
    try {
      const res = await apiFetch("/api/me/data", auth);
      if (!res.ok) throw new Error(`Couldn't export your data (${res.status}).`);
      const body = (await res.json()) as { data: unknown };
      await Share.share({ message: JSON.stringify(body.data, null, 2), title: "My AgoraSphere data" });
    } catch (e) {
      setDataMsg({ kind: "err", text: e instanceof Error ? e.message : "Couldn't download your data." });
    } finally {
      setDataBusy(false);
    }
  }
  function erase() {
    Alert.alert(
      "Delete your derived data?",
      "Your account and your own words in past discussions stay; all profiles, positions, recommendations, and coach notes are permanently removed.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => {
          setDataBusy(true);
          apiFetch("/api/me/data", auth, { method: "DELETE" })
            .then((res) => { if (!res.ok) throw new Error(`Couldn't delete (${res.status}).`); setConsent(ALL_OFF); setDataMsg({ kind: "ok", text: "Deleted everything Agora had derived about you." }); })
            .catch((e: unknown) => setDataMsg({ kind: "err", text: e instanceof Error ? e.message : "Couldn't delete." }))
            .finally(() => setDataBusy(false));
        } },
      ]
    );
  }

  if (!user) { router.replace("/sign-in"); return null; }
  const profile = data?.profile ?? null;

  function body() {
    if (loadError) return <View style={{ paddingTop: 24, alignItems: "center", gap: 12 }}><Text style={{ color: colors.text, fontFamily: fonts.body, fontSize: 14 }}>{loadError}</Text><Btn label="Try again" onPress={() => void load()} /></View>;
    if (!profile) return <LoadingLine />;
    switch (key) {
      case "profile":
        return (
          <SectionCard title="Profile" sub="How you appear across AgoraSphere.">
            <View style={{ flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 16, paddingVertical: 12 }}>
              <Avatar url={profile.avatar_url} name={profile.display_name || profile.username} size={52} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontFamily: fonts.body, fontSize: 14 }}>{profile.display_name?.trim() || profile.username}</Text>
                <Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 11.5 }}>@{profile.username}</Text>
                {!!profile.bio && <Text numberOfLines={1} style={{ color: "#9a9aa2", fontFamily: fonts.body, fontSize: 11.5, marginTop: 3 }}>{profile.bio}</Text>}
              </View>
              <Btn label="Edit profile" onPress={() => router.push("/edit-profile")} />
            </View>
            <Text style={{ color: colors.faint, fontFamily: fonts.body, fontSize: 10.5, paddingHorizontal: 16, paddingBottom: 8 }}>Username changes are limited to once every 7 days.</Text>
          </SectionCard>
        );

      case "account":
        return (
          <>
            <SectionCard title="Email" sub={`Signed in as ${profile.email}`}>
              <Pad>
                <Input value={newEmail} onChangeText={setNewEmail} placeholder="New email address" keyboardType="email-address" autoCapitalize="none" autoCorrect={false} textContentType="emailAddress" />
                <Msg msg={emailMsg} />
                <Btn label={emailBusy ? "Sending…" : "Change email"} onPress={() => void changeEmail()} disabled={emailBusy || !newEmail.trim()} />
              </Pad>
            </SectionCard>
            <SectionCard title="Password" sub={hasPasswordIdentity ? "Requires your current password." : "You sign in with Google. To add a password, reset it from the sign-in screen."}>
              <Pad>
                <Input value={curPw} onChangeText={setCurPw} placeholder="Current password" secureTextEntry textContentType="password" />
                <Input value={newPw} onChangeText={setNewPw} placeholder="New password" secureTextEntry textContentType="newPassword" />
                <Input value={confirmPw} onChangeText={setConfirmPw} placeholder="Confirm new password" secureTextEntry textContentType="newPassword" />
                <Msg msg={pwMsg} />
                <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
                  <Btn label={pwBusy ? "Updating…" : "Update password"} onPress={() => void changePassword()} disabled={pwBusy || !curPw || !newPw} />
                  <Pressable onPress={() => router.push("/forgot-password")}><Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 11.5 }}>Forgot your password?</Text></Pressable>
                </View>
              </Pad>
            </SectionCard>
            <SectionCard title="Sessions" sub="Signs you out on every device, including this one.">
              <Pad><Btn kind="ghost" label={signoutBusy ? "Signing out…" : "Sign out everywhere"} onPress={() => void signOutEverywhere()} disabled={signoutBusy} /></Pad>
            </SectionCard>
            <SectionCard title="Two-factor authentication" sub="Enter an emailed code each time you sign in with your password.">
              <Pad>
                {!twoFactorEnabled && !enrollPending && <Btn label={twoFactorBusy ? "Sending code…" : "Enable 2FA"} onPress={() => void startEnrollFlow()} disabled={twoFactorBusy} />}
                {!twoFactorEnabled && !!enrollPending && (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <Input value={enrollCode} onChangeText={(t) => setEnrollCode(t.replace(/\D/g, "").slice(0, 6))} placeholder="000000" keyboardType="number-pad" style={{ width: 120, textAlign: "center", letterSpacing: 4 }} />
                    <Btn label={twoFactorBusy ? "Verifying…" : "Verify"} onPress={() => void verifyEnroll()} disabled={twoFactorBusy || enrollCode.length !== 6} />
                    <Btn kind="ghost" label="Cancel" onPress={() => { setEnrollPending(null); setEnrollCode(""); setTwoFactorMsg(null); }} />
                  </View>
                )}
                {twoFactorEnabled && !disableOpen && (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                    <Btn kind="ghost" label="Disable 2FA" onPress={() => setDisableOpen(true)} />
                    <Text style={{ color: "#97c459", fontFamily: fonts.body, fontSize: 11.5, flex: 1 }}>✓ Active — you'll be asked for an emailed code at sign-in.</Text>
                  </View>
                )}
                {twoFactorEnabled && disableOpen && (
                  <View style={{ gap: 10 }}>
                    {hasPasswordIdentity && <Input value={disablePw} onChangeText={setDisablePw} placeholder="Current password" secureTextEntry />}
                    <View style={{ flexDirection: "row", gap: 10 }}>
                      <Btn label={twoFactorBusy ? "Disabling…" : "Confirm disable"} onPress={() => void disable2fa()} disabled={twoFactorBusy || (hasPasswordIdentity && !disablePw)} />
                      <Btn kind="ghost" label="Cancel" onPress={() => { setDisableOpen(false); setDisablePw(""); setTwoFactorMsg(null); }} />
                    </View>
                  </View>
                )}
                <Msg msg={twoFactorMsg} />
              </Pad>
            </SectionCard>
          </>
        );

      case "discussion":
        return (
          <SectionCard title="Joining a discussion" sub="Applied whenever you join as a speaker. You can always unmute or enable your camera in the room.">
            <Toggle on={settings.join_muted} onChange={(v) => void saveToggle("join_muted", v)} label="Join with microphone muted" sub="Your mic stays off until you turn it on yourself" />
            <Toggle on={settings.join_camera_off} onChange={(v) => void saveToggle("join_camera_off", v)} label="Join with camera off" sub="Your camera stays off until you turn it on yourself" />
          </SectionCard>
        );

      case "recordings": {
        const usedGb = recUsage ? recUsage.used_bytes / 1024 ** 3 : null;
        const limitGb = recUsage ? recUsage.limit_mb / 1024 : null;
        const pct = recUsage ? Math.min(100, (recUsage.used_bytes / (recUsage.limit_mb * 1024 * 1024)) * 100) : 0;
        const full = recUsage ? recUsage.used_bytes >= recUsage.limit_mb * 1024 * 1024 : false;
        return (
          <>
            <SectionCard title="Discussion recordings (VODs)" sub="Recordings let people rewatch your ended discussions and let big audiences watch over the broadcast stream.">
              <Toggle on={settings.record_debates} onChange={(v) => void saveToggle("record_debates", v)} label="Record discussions I host" sub="Turning this off means no recording exists afterward, and very large audiences can't overflow to the broadcast view" />
            </SectionCard>
            <SectionCard title="Storage" sub="Recordings of discussions you host count against your space.">
              <Pad>
                {recUsage ? (
                  <>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
                      <Text style={{ color: colors.text, fontFamily: fonts.semi, fontSize: 13 }}>{usedGb! < 0.1 && recUsage.used_bytes > 0 ? "<0.1" : usedGb!.toFixed(1)} GB<Text style={{ color: colors.muted, fontFamily: fonts.body }}> of {limitGb!.toFixed(0)} GB used</Text></Text>
                      {full && <Text style={{ color: "#f0a5a5", fontFamily: fonts.body, fontSize: 11 }}>Storage full — new discussions aren't recorded</Text>}
                    </View>
                    <View style={{ height: 6, borderRadius: 3, backgroundColor: "#1f1f26", overflow: "hidden" }}>
                      <View style={{ width: `${pct}%`, height: "100%", borderRadius: 3, backgroundColor: full ? "#e05a5a" : pct > 80 ? "#e2b96b" : "#4a9eff" }} />
                    </View>
                  </>
                ) : <Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 12 }}>Loading your usage…</Text>}
                <Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 11, lineHeight: 16 }}>Every account includes 5 GB of recording space — roughly 2½ hours of discussion. More storage is coming with AgoraSphere subscriptions.</Text>
              </Pad>
            </SectionCard>
          </>
        );
      }

      case "notifications":
        return (
          <>
            {PREF_GROUPS.map((g) => (
              <SectionCard key={g.title} title={g.title} sub={g.title === "Discussions" ? "Applied when the notification is created — turning one off stops it at the source." : undefined}>
                {g.items.map((it) => <Toggle key={it.type} on={prefs?.[it.type] ?? true} disabled={prefs === null} onChange={(v) => void savePref(it.type, v)} label={it.label} sub={it.sub} />)}
              </SectionCard>
            ))}
            <SectionCard title="Push" sub="Alerts arrive in the app's bell; web push is enabled per browser on agorasphere.net.">
              <Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 12.5, lineHeight: 18, paddingHorizontal: 16, paddingVertical: 12 }}>Live, scheduled and replay-ready alerts from people you follow show up under the bell here and go out as push notifications on every browser where you've enabled them. Each one still respects the toggles above.</Text>
            </SectionCard>
            <SectionCard title="Email" sub={emailPrefs === null ? "Email preferences aren't available yet." : `Sent to ${profile.email || "your address"}. Several at once are grouped into one message. Security emails always arrive.`}>
              {emailPrefs?.unsubscribed && (
                <View style={{ marginHorizontal: 16, marginVertical: 8, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: "#1f1a0e", borderWidth: 1, borderColor: "#5a4a1e" }}>
                  <Text style={{ color: colors.text, fontFamily: fonts.body, fontSize: 12.5 }}>Unsubscribed from all email</Text>
                  <Pressable onPress={() => void applyEmailRpc("set_email_unsubscribed", { p_on: false }, (p) => ({ ...p, unsubscribed: false }))}><Text style={{ color: colors.blueText, fontFamily: fonts.semi, fontSize: 12 }}>Resubscribe</Text></Pressable>
                </View>
              )}
              <Toggle on={emailPrefs?.digest === "weekly"} disabled={!emailPrefs || !!emailPrefs.unsubscribed} onChange={(on) => void applyEmailRpc("set_email_digest", { p_mode: on ? "weekly" : "off" }, (p) => ({ ...p, digest: on ? "weekly" : "off" }))} label="Weekly digest" sub="Saturday mornings: unread, upcoming discussions from people you follow, top posts in your communities" />
              {PREF_GROUPS.map((g) => (
                <View key={g.title}>
                  <Text style={{ color: colors.muted, fontFamily: fonts.semi, fontSize: 11, letterSpacing: 0.8, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 2 }}>{g.title.toUpperCase()}</Text>
                  {g.items.map((it) => (
                    <Toggle key={it.type} on={emailPrefs?.types[it.type] ?? false} disabled={!emailPrefs || !!emailPrefs.unsubscribed || prefs?.[it.type] === false}
                      onChange={(v) => void applyEmailRpc("set_email_pref", { p_type: it.type, p_enabled: v }, (p) => ({ ...p, types: { ...p.types, [it.type]: v } }))}
                      label={it.label} sub={prefs?.[it.type] === false ? "Turned off above — enable the notification first" : it.sub} />
                  ))}
                </View>
              ))}
            </SectionCard>
          </>
        );

      case "appearance":
        return (
          <SectionCard title="Motion" sub="AgoraSphere uses a single dark theme by design.">
            <Toggle on={settings.reduce_motion} onChange={(v) => void saveToggle("reduce_motion", v)} label="Reduce motion" sub="Holds the sky, the starfield and the interface animations still" />
          </SectionCard>
        );

      case "privacy":
        return (
          <SectionCard title="Profile privacy" sub="Enforced on the server, not just hidden in the interface.">
            <Toggle on={settings.show_debate_history} onChange={(v) => void saveToggle("show_debate_history", v)} label="Show my discussions on my profile" sub="When off, other people can't see your past or scheduled discussions" />
          </SectionCard>
        );

      case "data":
        return (
          <SectionCard title="Your Data & Coach" sub={AGORA_AI
            ? "Agora builds your profile and coaching from how you use the app and speak on stage. You can turn any of it off here, and download or delete everything it derives."
            : "Agora's coach, the analysis of how you argue and the recommendations built on it, is coming soon. Until then nothing of the kind is collected. Activity analytics is the one thing that runs today; you can turn it off here, and download or delete everything the app holds about you."}>
            {consentLoaded ? CONSENT_CATEGORIES.map((cat) => (
              <View key={cat.key} style={{ flexDirection: "row", alignItems: "flex-start", gap: 12, paddingHorizontal: 16, paddingVertical: 12, opacity: cat.ai && !AGORA_AI ? 0.62 : 1 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontFamily: fonts.semi, fontSize: 13.5 }}>{cat.title}</Text>
                  <Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 11.5, lineHeight: 16, marginTop: 3 }}>{cat.blurb}</Text>
                </View>
                {cat.ai && !AGORA_AI ? (
                  <View style={{ borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface2, paddingHorizontal: 9, paddingVertical: 4 }}><Text style={{ color: colors.yellow, fontFamily: fonts.bold, fontSize: 11 }}>Coming soon</Text></View>
                ) : (
                  <Pressable onPress={() => void toggleConsent(cat.key)} accessibilityRole="switch" accessibilityState={{ checked: consent[cat.key] }} style={{ width: 40, height: 23, borderRadius: 999, backgroundColor: consent[cat.key] ? "#2563eb" : "#3a3a42" }}>
                    <View style={{ position: "absolute", top: 2, left: consent[cat.key] ? 19 : 2, width: 19, height: 19, borderRadius: 10, backgroundColor: "#eff6ff" }} />
                  </Pressable>
                )}
              </View>
            )) : <LoadingLine />}
            <Pad>
              <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
                <Btn label="Download my data" onPress={() => void download()} disabled={dataBusy} />
                <Btn kind="danger" label="Delete my derived data" onPress={erase} disabled={dataBusy} />
              </View>
              <Msg msg={dataMsg} />
            </Pad>
          </SectionCard>
        );

      case "blocked":
        return (
          <SectionCard title="Blocked users" sub="Blocked users can't see your profile details or interact with you.">
            {blocked.length === 0 ? (
              <Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 12, paddingHorizontal: 16, paddingVertical: 12 }}>You haven't blocked anyone.</Text>
            ) : blocked.map((u) => (
              <View key={u.id} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 10 }}>
                <Avatar url={u.avatar_url} name={u.display_name || u.username} size={32} />
                <Text style={{ flex: 1, color: colors.text, fontFamily: fonts.body, fontSize: 13 }}>{u.display_name?.trim() || u.username} <Text style={{ color: colors.muted, fontSize: 11 }}>@{u.username}</Text></Text>
                <Btn kind="ghost" label={unblockBusy === u.id ? "Unblocking…" : "Unblock"} onPress={() => void unblock(u)} disabled={unblockBusy === u.id} />
              </View>
            ))}
          </SectionCard>
        );

      case "danger":
        return (
          <SectionCard danger title="Delete account" sub="Permanently removes your profile, sign-in credentials, follows, blocks, and settings, and signs you out everywhere. Discussions you took part in are kept for the other participants, attributed to an anonymous “deleted” identity. This cannot be undone.">
            <Pad>
              <Input value={deleteConfirm} onChangeText={setDeleteConfirm} placeholder={`Type "${profile.username}" to confirm`} autoCapitalize="none" autoCorrect={false} />
              {!!deleteErr && <Msg msg={{ kind: "err", text: deleteErr }} />}
              <Btn kind="danger" label={deleteBusy ? "Deleting…" : "Delete my account permanently"} onPress={() => void deleteAccount()} disabled={deleteBusy || deleteConfirm !== profile.username} />
            </Pad>
          </SectionCard>
        );
    }
  }

  return (
    <Screen style={{ paddingHorizontal: 12 }}>
      <Stack.Screen options={{ title: meta?.label ?? "Settings", headerRight: () => (saved ? <Text style={{ color: "#97c459", fontFamily: fonts.body, fontSize: 11.5 }}>✓ Saved</Text> : null) }} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }} keyboardVerticalOffset={90}>
        <ScrollView contentContainerStyle={{ paddingTop: 10, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
          {toggleError && <Text style={{ color: "#fca5a5", fontFamily: fonts.body, fontSize: 12, marginBottom: 12, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 8, borderWidth: 1, borderColor: "#5a2a2a", backgroundColor: "#1c1010" }}>{toggleError}</Text>}
          {body()}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
