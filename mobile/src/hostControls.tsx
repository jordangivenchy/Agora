/* Host controls (components/agora/HostControls.tsx), the curation
   surface only hosts and co-hosts see, as a sheet with the site's four
   tabs: Requests (the line, oldest first — bring up next, invite,
   dismiss), Audience (search — invite, make speaker, profile, remove),
   Stage (mute, to audience, co-host), Room (lock requests, mute all,
   end, the thumbnail, the restream, the HLS broadcast). Every write
   goes to the same rows; realtime brings the result to everyone. */
import { useEffect, useMemo, useState } from "react";
import { Alert, Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Switch, Text, TextInput, View, useWindowDimensions } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "./supabase";
import { useSession } from "./session";
import { Avatar } from "./avatar";
import { host as seatHost } from "./seats";
import { pickImage } from "./postImages";
import { uploadRoomThumbnail } from "./roomThumbnail";
import { advanceQueue, egress, endDiscussion, muteAllSpeakers, removeFromRoom, sendInvite, setAutoAdvance, setSeatMuted, type RoomDetail } from "./roomData";
import { ROLE_LABEL, deriveStageRole, isHostRole, onStage, seatName, seatUser, sortRequests, type Seat, type StageRole } from "./stageModel";
import { colors, fonts } from "./theme";

type Tab = "requests" | "audience" | "stage" | "room";
const MIGRATION_HINT = "This needs the stage-roles migration applied to the database.";

function Act({ label, onPress, primary, danger, disabled, wide }: { label: string; onPress: () => void; primary?: boolean; danger?: boolean; disabled?: boolean; wide?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={{ paddingHorizontal: 10, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center", alignSelf: wide ? "stretch" : "auto", backgroundColor: primary ? colors.yellow : "#141418", borderWidth: 1, borderColor: primary ? colors.yellow : danger ? colors.red : "#2a2a33", opacity: disabled ? 0.45 : 1 }}>
      <Text style={{ color: primary ? colors.ink : danger ? "#ff9d92" : colors.text, fontFamily: fonts.semi, fontSize: 12 }}>{label}</Text>
    </Pressable>
  );
}

function Row({ seat, role, children }: { seat: Seat; role: StageRole; children: React.ReactNode }) {
  const u = seatUser(seat);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 7, borderBottomWidth: 1, borderColor: "#17171c" }}>
      {seat.hand_raised_at && !onStage(role) && <Ionicons name="hand-left" size={13} color={colors.yellow} />}
      <Avatar url={u?.avatar_url} name={seatName(seat)} size={28} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ color: colors.text, fontFamily: fonts.semi, fontSize: 12.5 }}>{seatName(seat)}</Text>
        <Text style={{ color: colors.faint, fontFamily: fonts.body, fontSize: 10.5 }}>{ROLE_LABEL[role]}</Text>
      </View>
      <View style={{ flexDirection: "row", gap: 5, flexWrap: "wrap", justifyContent: "flex-end", maxWidth: "58%" }}>{children}</View>
    </View>
  );
}

const Head = ({ t }: { t: string }) => <Text style={{ color: "rgba(255,255,255,0.4)", fontFamily: fonts.semi, fontSize: 10, letterSpacing: 0.9, marginTop: 14, marginBottom: 6 }}>{t.toUpperCase()}</Text>;
const Hint = ({ t }: { t: string }) => <Text style={{ color: colors.faint, fontFamily: fonts.body, fontSize: 11, lineHeight: 15, marginTop: 6 }}>{t}</Text>;

export function HostControlsSheet({ open, onClose, room, seats, meId, myRole, onChanged }: { open: boolean; onClose: () => void; room: RoomDetail; seats: Seat[]; meId: string; myRole: StageRole; onChanged: () => void }) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const { session, pass } = useSession();
  const auth = { token: session?.access_token, pass };
  const [tab, setTab] = useState<Tab>("requests");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const isPrimaryHost = meId === room.host_id;

  const active = useMemo(() => seats.filter((s) => !s.left_at && s.user_id !== meId), [seats, meId]);
  const withRole = useMemo(() => active.map((s) => ({ s, role: deriveStageRole(s, room.host_id) })), [active, room.host_id]);
  const requests = useMemo(() => sortRequests(active.filter((s) => s.hand_raised_at && !onStage(deriveStageRole(s, room.host_id)))), [active, room.host_id]);
  const audience = useMemo(() => {
    const q = search.trim().toLowerCase();
    return withRole.filter(({ role }) => role === "audience").filter(({ s }) => !q || (seatUser(s)?.username ?? "").toLowerCase().includes(q) || seatName(s).toLowerCase().includes(q));
  }, [withRole, search]);
  const stage = useMemo(() => withRole.filter(({ role }) => onStage(role)), [withRole]);

  async function run(key: string, fn: () => PromiseLike<{ error: { message: string } | null }>) {
    setBusy(key);
    setNotice(null);
    try {
      const { error } = await fn();
      if (error) setNotice(/stage_role|stage_invites|speaker_requests_locked/.test(error.message) ? MIGRATION_HINT : error.message);
      else onChanged();
    } finally {
      setBusy(null);
    }
  }
  const invite = (s: Seat) => run(`invite-${s.id}`, () => sendInvite(supabase, room.id, meId, s.user_id));
  const makeSpeaker = (s: Seat) => run(`speaker-${s.id}`, () => seatHost.bringUp(supabase, s.id));
  const dismiss = (s: Seat) => run(`dismiss-${s.id}`, () => seatHost.dismiss(supabase, s.id));
  const setMuted = (s: Seat, muted: boolean) => run(`mute-${s.id}`, () => setSeatMuted(supabase, s.id, muted));
  const toAudience = (s: Seat) => run(`down-${s.id}`, () => seatHost.toAudience(supabase, s.id));
  const remove = (s: Seat) => run(`remove-${s.id}`, () => removeFromRoom(supabase, s.id));
  const setCohost = (s: Seat, make: boolean) => run(`cohost-${s.id}`, () => seatHost.setCohost(supabase, s.id, make));
  const toggleLock = () => run("lock", () => seatHost.lockRequests(supabase, room.id, !room.speaker_requests_locked));
  const bringUpNext = () => run("advance", () => advanceQueue(supabase, room.id));
  const toggleAuto = () => run("auto", () => setAutoAdvance(supabase, room.id, !room.queue_auto_advance));
  const muteAll = () => run("muteall", () => muteAllSpeakers(supabase, room.id));
  const end = () =>
    Alert.alert("End this discussion for everyone?", undefined, [
      { text: "Cancel", style: "cancel" },
      { text: "End discussion", style: "destructive", onPress: () => void run("end", () => endDiscussion(supabase, room.id)).then(() => { void egress(auth, room.id, { action: "stop_all" }); onClose(); }) },
    ]);
  const profile = (s: Seat) => {
    const u = seatUser(s);
    if (!u?.username) return;
    onClose();
    setTimeout(() => router.push({ pathname: "/u/[username]", params: { username: u.username! } }), 320);
  };

  /* The thumbnail: square art for the room's card, the host's own folder. */
  const [thumbUrl, setThumbUrl] = useState<string | null>(room.thumbnail_url);
  const [thumbBusy, setThumbBusy] = useState(false);
  const [thumbError, setThumbError] = useState<string | null>(null);
  useEffect(() => { setThumbUrl(room.thumbnail_url); }, [room.thumbnail_url]);
  const changeThumbnail = async () => {
    setThumbError(null);
    try {
      const img = await pickImage();
      if (!img) return;
      setThumbBusy(true);
      const url = await uploadRoomThumbnail(room.host_id, room.id, img);
      setThumbUrl(`${url}?t=${Date.now()}`);
      onChanged();
    } catch (e) {
      setThumbError(e instanceof Error && e.message ? e.message : "Thumbnail update failed — try again.");
    } finally {
      setThumbBusy(false);
    }
  };

  /* The restream and the HLS broadcast: the site's /api/egress, the host's own. */
  const [rtmpUrl, setRtmpUrl] = useState("");
  const [portrait, setPortrait] = useState(true);
  const [egressId, setEgressId] = useState<string | null>(null);
  const [egressBusy, setEgressBusy] = useState(false);
  const [egressError, setEgressError] = useState<string | null>(null);
  const [hlsConfigured, setHlsConfigured] = useState(false);
  const [hlsLive, setHlsLive] = useState(!!room.hls_url);
  const [hlsEgressId, setHlsEgressId] = useState<string | null>(null);
  const [hlsBusy, setHlsBusy] = useState(false);
  const [hlsError, setHlsError] = useState<string | null>(null);
  useEffect(() => {
    if (!open || !isPrimaryHost) return;
    void egress(auth, room.id, { action: "status" }).then(({ ok, data }) => {
      if (!ok) return;
      if (typeof data.egressId !== "undefined") setEgressId((data.egressId as string | null) ?? null);
      if (typeof data.hlsConfigured === "boolean") setHlsConfigured(data.hlsConfigured);
      setHlsLive(!!room.hls_url);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, room.id]);
  const toggleEgress = async () => {
    setEgressBusy(true);
    setEgressError(null);
    const { ok, data } = await egress(auth, room.id, egressId ? { action: "stop", egressId } : { action: "start", rtmpUrl: rtmpUrl.trim(), portrait });
    setEgressBusy(false);
    if (!ok) { setEgressError((data.error as string) || "Restream failed — try again."); return; }
    if (egressId) setEgressId(null);
    else { setEgressId((data.egressId as string) ?? null); setRtmpUrl(""); }
  };
  const toggleHls = async () => {
    setHlsBusy(true);
    setHlsError(null);
    const { ok, data } = await egress(auth, room.id, hlsLive ? (hlsEgressId ? { action: "stop", egressId: hlsEgressId } : { action: "stop_all" }) : { action: "start_hls" });
    setHlsBusy(false);
    if (!ok) { setHlsError(data.error === "hls_not_configured" ? "HLS storage isn't configured yet." : (data.error as string) || "HLS failed"); return; }
    if (hlsLive) { setHlsLive(false); setHlsEgressId(null); }
    else { setHlsLive(true); setHlsEgressId((data.egressId as string) ?? null); }
  };

  const tabs: [Tab, string][] = [["requests", `Requests${requests.length ? ` · ${requests.length}` : ""}`], ["audience", "Audience"], ["stage", "Stage"], ["room", "Room"]];
  const off = busy !== null;
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1 }} accessibilityLabel="Close" />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={{ height: Math.round(height * 0.66), backgroundColor: "#0b0b0d", borderTopLeftRadius: 18, borderTopRightRadius: 18, borderWidth: 1, borderBottomWidth: 0, borderColor: "#26262e" }}>
          <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingTop: 12, gap: 6 }}>
            <Ionicons name="ribbon-outline" size={15} color={colors.gold} />
            <Text style={{ color: colors.text, fontFamily: fonts.title, fontSize: 14.5 }}>Host controls</Text>
            <View style={{ flex: 1 }} />
            <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Close" style={{ width: 32, height: 32, alignItems: "center", justifyContent: "center" }}><Ionicons name="close" size={20} color={colors.muted} /></Pressable>
          </View>
          <View style={{ flexDirection: "row", paddingHorizontal: 12, paddingTop: 6, gap: 4, borderBottomWidth: 1, borderColor: "#17171c" }}>
            {tabs.map(([key, label]) => (
              <Pressable key={key} onPress={() => setTab(key)} style={{ paddingHorizontal: 10, paddingVertical: 8, borderBottomWidth: 2, borderColor: tab === key ? colors.yellow : "transparent" }}>
                <Text style={{ color: tab === key ? colors.text : colors.muted, fontFamily: fonts.semi, fontSize: 12.5 }}>{label}</Text>
              </Pressable>
            ))}
          </View>
          {notice && <Text style={{ color: "#fca5a5", fontFamily: fonts.body, fontSize: 11.5, paddingHorizontal: 14, paddingTop: 8 }}>{notice}</Text>}
          <ScrollView contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: insets.bottom + 16 }} keyboardShouldPersistTaps="handled">
            {tab === "requests" && (
              <View>
                <View style={{ flexDirection: "row", gap: 6, paddingVertical: 10, flexWrap: "wrap" }}>
                  <Act label="Bring up next" primary disabled={off || requests.length === 0} onPress={bringUpNext} />
                  {isPrimaryHost && <Act label={`Auto-advance: ${room.queue_auto_advance ? "On" : "Off"}`} primary={!!room.queue_auto_advance} disabled={off} onPress={toggleAuto} />}
                </View>
                {requests.length === 0 && <Text style={{ color: colors.faint, fontFamily: fonts.body, fontSize: 12.5, paddingVertical: 10 }}>No raised hands.</Text>}
                {requests.map((s) => (
                  <Row key={s.id} seat={s} role="audience">
                    <Act label="Invite" primary disabled={off} onPress={() => invite(s)} />
                    <Act label="Dismiss" disabled={off} onPress={() => dismiss(s)} />
                  </Row>
                ))}
              </View>
            )}
            {tab === "audience" && (
              <View>
                <TextInput value={search} onChangeText={setSearch} placeholder="Search audience…" placeholderTextColor={colors.faint} style={{ marginTop: 10, height: 36, borderRadius: 8, paddingHorizontal: 10, backgroundColor: "#111114", borderWidth: 1, borderColor: "#2a2a33", color: colors.text, fontFamily: fonts.body, fontSize: 13 }} />
                {audience.length === 0 && <Text style={{ color: colors.faint, fontFamily: fonts.body, fontSize: 12.5, paddingVertical: 10 }}>Nobody here matches.</Text>}
                {audience.map(({ s }) => (
                  <Row key={s.id} seat={s} role="audience">
                    <Act label="Invite" primary disabled={off} onPress={() => invite(s)} />
                    <Act label="Make speaker" disabled={off} onPress={() => makeSpeaker(s)} />
                    <Act label="Profile" onPress={() => profile(s)} />
                    <Act label="Remove" danger disabled={off} onPress={() => remove(s)} />
                  </Row>
                ))}
              </View>
            )}
            {tab === "stage" && (
              <View>
                {stage.length === 0 && <Text style={{ color: colors.faint, fontFamily: fonts.body, fontSize: 12.5, paddingVertical: 10 }}>Stage is empty.</Text>}
                {stage.map(({ s, role }) => (
                  <Row key={s.id} seat={s} role={role}>
                    <Act label={s.mic_muted ? "Unmute" : "Mute"} disabled={off} onPress={() => setMuted(s, !s.mic_muted)} />
                    {!isHostRole(role) && <Act label="To audience" disabled={off} onPress={() => toAudience(s)} />}
                    {isPrimaryHost && role === "speaker" && <Act label="Co-host" disabled={off} onPress={() => setCohost(s, true)} />}
                    {isPrimaryHost && role === "cohost" && <Act label="Demote" disabled={off} onPress={() => setCohost(s, false)} />}
                  </Row>
                ))}
              </View>
            )}
            {tab === "room" && (
              <View style={{ paddingTop: 10, gap: 8 }}>
                <Act wide label={room.speaker_requests_locked ? "Unlock speaker requests" : "Lock speaker requests"} disabled={off} onPress={toggleLock} />
                <Act wide label="Mute all speakers" disabled={off} onPress={muteAll} />
                {isPrimaryHost && <Act wide label="End discussion" danger disabled={off} onPress={end} />}
                {isPrimaryHost && (
                  <View style={{ borderTopWidth: 1, borderColor: "#1f1f26", marginTop: 4 }}>
                    <Head t="Thumbnail" />
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                      {thumbUrl ? <Image source={{ uri: thumbUrl }} style={{ width: 48, height: 48, borderRadius: 8, borderWidth: 1, borderColor: "#2a2a33" }} /> : <View style={{ width: 48, height: 48, borderRadius: 8, borderWidth: 1, borderStyle: "dashed", borderColor: "#3a3a44" }} />}
                      <Act label={thumbBusy ? "Uploading…" : thumbUrl ? "Change" : "Add image"} disabled={thumbBusy} onPress={() => void changeThumbnail()} />
                    </View>
                    {thumbError && <Text style={{ color: "#fca5a5", fontFamily: fonts.body, fontSize: 11, marginTop: 5 }}>{thumbError}</Text>}
                    <Hint t="Square art shown on room cards. Center-cropped to 512px — 5MB max." />
                  </View>
                )}
                {isPrimaryHost && (
                  <View style={{ borderTopWidth: 1, borderColor: "#1f1f26" }}>
                    <Head t={`Restream${egressId ? " · LIVE" : ""}`} />
                    {!egressId && (
                      <>
                        <TextInput value={rtmpUrl} onChangeText={setRtmpUrl} placeholder="rtmp://… ingest URL + stream key" placeholderTextColor={colors.faint} autoCapitalize="none" autoCorrect={false} style={{ height: 34, borderRadius: 8, paddingHorizontal: 10, backgroundColor: "#111114", borderWidth: 1, borderColor: "#2a2a33", color: colors.text, fontFamily: fonts.body, fontSize: 12 }} />
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 }}>
                          <Switch value={portrait} onValueChange={setPortrait} trackColor={{ true: colors.yellow, false: "#2a2a33" }} thumbColor="#fff" />
                          <Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 11.5, flex: 1 }}>Portrait (TikTok) — off for Twitch/YouTube</Text>
                        </View>
                      </>
                    )}
                    <View style={{ marginTop: 8 }}>
                      <Act wide label={egressBusy ? "…" : egressId ? "Stop restream" : "Go live on TikTok / RTMP"} danger={!!egressId} disabled={egressBusy || (!egressId && !rtmpUrl.trim())} onPress={() => void toggleEgress()} />
                    </View>
                    {egressError && <Text style={{ color: "#fca5a5", fontFamily: fonts.body, fontSize: 11, marginTop: 5 }}>{egressError}</Text>}
                    <Hint t="Paste the RTMP server URL with your stream key appended (from TikTok LIVE Studio, Twitch, or YouTube). The stage broadcasts until you stop it." />
                  </View>
                )}
                {isPrimaryHost && hlsConfigured && (
                  <View style={{ borderTopWidth: 1, borderColor: "#1f1f26" }}>
                    <Head t={`HLS broadcast${hlsLive ? " · LIVE" : ""}`} />
                    <Act wide label={hlsBusy ? "…" : hlsLive ? "Stop HLS broadcast" : "Start HLS broadcast"} danger={hlsLive} disabled={hlsBusy} onPress={() => void toggleHls()} />
                    {hlsError && <Text style={{ color: "#fca5a5", fontFamily: fonts.body, fontSize: 11, marginTop: 5 }}>{hlsError}</Text>}
                    <Hint t="Gives the audience a low-cost stream view for big rooms — the stage stays on WebRTC." />
                  </View>
                )}
                <Hint t={`${myRole === "host" ? "You are the host." : "You are a co-host."} Hosts are set when the discussion is created — co-hosts can be promoted from the Stage tab.`} />
              </View>
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
