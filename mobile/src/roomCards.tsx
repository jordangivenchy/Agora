/* The cards that float over the stage: the invite from a host, the
   mic or camera that failed, the queue pill, the host's button, the
   community note request, the discussion ended, and the doors to a
   room this visitor can't enter yet. */
import { useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "./supabase";
import { openAppSettings } from "./liveRoom";
import { gateCopy, joinWithCode, requestCommunityNote, type Gate, type RoomDetail } from "./roomData";
import { colors, fonts } from "./theme";
import { LoadingLine } from "./sky";

const CARD = { backgroundColor: "#0e0e11", borderWidth: 1, borderColor: "#2a2a33", borderRadius: 14 } as const;

function Btn({ label, onPress, primary, danger, disabled }: { label: string; onPress: () => void; primary?: boolean; danger?: boolean; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={({ pressed }) => ({ flex: 1, height: 38, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: danger ? "#c0392b" : primary ? colors.yellow : "#141418", borderWidth: 1, borderColor: danger ? "#c0392b" : primary ? colors.yellow : "#2a2a33", opacity: disabled ? 0.5 : pressed ? 0.85 : 1 })}>
      <Text style={{ color: danger ? "#fff" : primary ? colors.ink : colors.text, fontFamily: fonts.bold, fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}

export function InviteCard({ inviterName, busy, onJoin, onDecline }: { inviterName: string; busy: boolean; onJoin: () => void; onDecline: () => void }) {
  return (
    <View style={[CARD, { padding: 12, gap: 10 }]} accessibilityRole="alert">
      <Text style={{ color: colors.text, fontFamily: fonts.body, fontSize: 13 }}>
        <Text style={{ fontFamily: fonts.bold }}>{inviterName}</Text> has invited you to join the discussion.
      </Text>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Btn label="Join the stage" primary disabled={busy} onPress={onJoin} />
        <Btn label="Decline" disabled={busy} onPress={onDecline} />
      </View>
    </View>
  );
}

export function MediaErrorCard({ message, settings, onDismiss }: { message: string; settings: boolean; onDismiss: () => void }) {
  return (
    <View style={[CARD, { padding: 10, paddingLeft: 12, flexDirection: "row", alignItems: "center", gap: 8, borderColor: colors.red }]} accessibilityRole="alert">
      <Text style={{ flex: 1, color: colors.text, fontFamily: fonts.body, fontSize: 12.5, lineHeight: 17 }}>{message}</Text>
      {settings && (
        <Pressable onPress={openAppSettings} style={{ paddingHorizontal: 10, height: 30, borderRadius: 8, backgroundColor: colors.yellow, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: colors.ink, fontFamily: fonts.bold, fontSize: 12 }}>Settings</Text>
        </Pressable>
      )}
      <Pressable onPress={onDismiss} hitSlop={8} accessibilityLabel="Dismiss" style={{ width: 28, height: 28, alignItems: "center", justifyContent: "center" }}><Ionicons name="close" size={18} color={colors.muted} /></Pressable>
    </View>
  );
}

export function QueuePill({ amMicHolder, position }: { amMicHolder: boolean; position: number | null }) {
  if (!amMicHolder && position === null) return null;
  const tone = amMicHolder ? "#1f9d55" : position === 1 ? colors.yellow : "#2a2a33";
  const ink = amMicHolder ? "#fff" : position === 1 ? colors.ink : colors.text;
  return (
    <View style={{ alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 6, height: 34, paddingHorizontal: 11, borderRadius: 999, backgroundColor: amMicHolder || position === 1 ? tone : "#0e0e11", borderWidth: 1, borderColor: tone }}>
      <Ionicons name={amMicHolder ? "mic" : position === 1 ? "sparkles" : "people-outline"} size={13} color={ink} />
      <Text style={{ color: ink, fontFamily: fonts.bold, fontSize: 11 }}>
        {amMicHolder ? "You have the mic" : position === 1 ? "YOU'RE NEXT" : `#${position} in queue · ${(position ?? 1) - 1} ahead of you`}
      </Text>
    </View>
  );
}

export function HostButton({ requests, onPress }: { requests: number; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityLabel="Host controls" style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 6, height: 34, paddingHorizontal: 12, borderRadius: 999, backgroundColor: pressed ? "#1b1b21" : "#0e0e11", borderWidth: 1, borderColor: colors.gold })}>
      <Ionicons name="ribbon-outline" size={13} color={colors.gold} />
      <Text style={{ color: colors.text, fontFamily: fonts.bold, fontSize: 11.5 }}>Host controls</Text>
      {requests > 0 && (
        <View style={{ minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 5, backgroundColor: colors.red, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: "#fff", fontFamily: fonts.bold, fontSize: 10 }}>{requests}</Text>
        </View>
      )}
    </Pressable>
  );
}

export function NoteRequestSheet({ open, onClose, room }: { open: boolean; onClose: () => void; room: RoomDetail }) {
  const insets = useSafeAreaInsets();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => { onClose(); setTimeout(() => { setText(""); setDone(false); setError(null); }, 300); };
  const send = async () => {
    setBusy(true);
    const err = await requestCommunityNote(supabase, room, text);
    setBusy(false);
    if (err) setError(err);
    else setDone(true);
  };
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={close}>
      <Pressable onPress={close} style={{ flex: 1 }} accessibilityLabel="Close" />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={{ backgroundColor: "#0b0b0d", borderTopLeftRadius: 18, borderTopRightRadius: 18, borderWidth: 1, borderBottomWidth: 0, borderColor: "#26262e", padding: 16, paddingBottom: insets.bottom + 14, gap: 10 }}>
          {done ? (
            <>
              <Text style={{ color: colors.text, fontFamily: fonts.body, fontSize: 13.5 }}>Request sent — reviewers will see it with this room attached.</Text>
              <View style={{ flexDirection: "row" }}><Btn label="Done" primary onPress={close} /></View>
            </>
          ) : (
            <>
              <Text style={{ color: colors.text, fontFamily: fonts.body, fontSize: 13.5 }}><Text style={{ fontFamily: fonts.bold }}>Request a community note.</Text> What should it address?</Text>
              <TextInput value={text} onChangeText={(t) => setText(t.slice(0, 800))} multiline placeholder="A claim made in this discussion that needs context…" placeholderTextColor={colors.faint} style={{ minHeight: 64, borderRadius: 10, borderWidth: 1, borderColor: "#2a2a33", backgroundColor: "#111114", color: colors.text, fontFamily: fonts.body, fontSize: 13.5, padding: 10, textAlignVertical: "top" }} />
              {error && <Text style={{ color: "#fca5a5", fontFamily: fonts.body, fontSize: 12 }}>{error}</Text>}
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Btn label="Cancel" disabled={busy} onPress={close} />
                <Btn label={busy ? "Sending…" : "Send request"} primary disabled={busy || !text.trim()} onPress={() => void send()} />
              </View>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function EndedCard({ room, onWatch, onHome }: { room: RoomDetail; onWatch: () => void; onHome: () => void }) {
  return (
    <View style={[CARD, { padding: 16, gap: 10 }]} accessibilityRole="alert">
      <Text style={{ color: colors.text, fontFamily: fonts.title, fontSize: 16 }}>Discussion ended</Text>
      <Text style={{ color: "#c9c9d2", fontFamily: fonts.body, fontSize: 13, lineHeight: 18 }}>
        The host closed the stage.{room.recording_url ? " The recording will be available shortly — it finalizes a few seconds after the stream stops." : " The transcript and discussion are open now."}
      </Text>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Btn label={room.recording_url ? "Watch the discussion" : "Transcript & discussion"} primary onPress={onWatch} />
        <Btn label="Back to home" onPress={onHome} />
      </View>
    </View>
  );
}

/* ── The doors ─────────────────────────────────────────────────────── */
function Door({ kicker, title, children }: { kicker: string; title: string; children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center", paddingHorizontal: 24, paddingTop: insets.top, paddingBottom: insets.bottom }}>
      <Text style={{ color: "#c9a6f0", fontFamily: fonts.title, fontSize: 11, letterSpacing: 1 }}>{kicker}</Text>
      <Text style={{ color: colors.text, fontFamily: fonts.title, fontSize: 21, lineHeight: 27, textAlign: "center", marginTop: 8 }}>{title}</Text>
      {children}
    </View>
  );
}

export function DeniedDoor({ gate, roomId, signedIn, onEntered }: { gate: Gate; roomId: string; signedIn: boolean; onEntered: () => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    if (code.trim().length < 6 || busy) return;
    setBusy(true);
    setErr(null);
    const r = await joinWithCode(supabase, code);
    setBusy(false);
    if (r.error) { setErr(r.error); return; }
    if (r.roomId === roomId) onEntered();
    else if (r.roomId) router.replace({ pathname: "/room/[id]", params: { id: r.roomId } });
  };
  return (
    <Door kicker="PRIVATE ROOM" title={gate.motion ?? "Private room"}>
      <Text style={{ color: "#c0c0c8", fontFamily: fonts.body, fontSize: 13, lineHeight: 20, textAlign: "center", marginTop: 12, maxWidth: 360 }}>{gateCopy(gate)}{!signedIn ? " Sign in if that's you." : ""}</Text>
      {signedIn ? (
        <View style={{ alignItems: "center", gap: 8, marginTop: 20 }}>
          <Text style={{ color: colors.faint, fontFamily: fonts.body, fontSize: 12 }}>Have an invite code?</Text>
          <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
            <TextInput value={code} onChangeText={(t) => { setCode(t.toUpperCase().slice(0, 6)); setErr(null); }} placeholder="ABC123" placeholderTextColor={colors.faint} autoCapitalize="characters" autoCorrect={false} maxLength={6} onSubmitEditing={() => void submit()} style={{ width: 130, height: 42, borderRadius: 10, textAlign: "center", letterSpacing: 4, fontSize: 15, fontFamily: fonts.semi, color: colors.text, backgroundColor: "#111114", borderWidth: 1, borderColor: err ? colors.red : "#2a2a33" }} />
            <Pressable onPress={() => void submit()} disabled={busy || code.trim().length < 6} style={{ height: 42, paddingHorizontal: 18, borderRadius: 999, backgroundColor: "#d9a238", alignItems: "center", justifyContent: "center", opacity: busy || code.trim().length < 6 ? 0.5 : 1 }}>
              <Text style={{ color: "#2b1a02", fontFamily: fonts.bold, fontSize: 13 }}>{busy ? "Joining…" : "Enter"}</Text>
            </Pressable>
          </View>
          {err && <Text style={{ color: "#fca5a5", fontFamily: fonts.body, fontSize: 12 }}>{err}</Text>}
        </View>
      ) : (
        <Text style={{ color: colors.faint, fontFamily: fonts.body, fontSize: 12, marginTop: 8 }}>Have an invite code? Sign in to use it.</Text>
      )}
      <Pressable onPress={() => router.navigate("/")} style={{ marginTop: 20, height: 40, paddingHorizontal: 22, borderRadius: 999, backgroundColor: "#2f7fe0", alignItems: "center", justifyContent: "center" }}>
        <Text style={{ color: "#fff", fontFamily: fonts.bold, fontSize: 13 }}>Back to the Agora</Text>
      </Pressable>
    </Door>
  );
}

export function ScheduledDoor({ room, opensAt, now }: { room: RoomDetail; opensAt: number; now: number }) {
  const start = room.scheduled_start ? new Date(room.scheduled_start) : null;
  const opens = new Date(opensAt);
  const minsLeft = Math.max(1, Math.ceil((opensAt - now) / 60000));
  const countdown = minsLeft >= 1440 ? `${Math.floor(minsLeft / 1440)}d ${Math.floor((minsLeft % 1440) / 60)}h` : minsLeft >= 60 ? `${Math.floor(minsLeft / 60)}h ${minsLeft % 60}m` : `${minsLeft}m`;
  return (
    <Door kicker="SCHEDULED DISCUSSION" title={room.motion}>
      {start && <Text style={{ color: "#c0c0c8", fontFamily: fonts.body, fontSize: 13, marginTop: 12 }}>Starts {start.toLocaleDateString([], { month: "short", day: "numeric" })} at {start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</Text>}
      <Text style={{ color: colors.faint, fontFamily: fonts.body, fontSize: 12, marginTop: 6, textAlign: "center" }}>Doors open 30 minutes before start — come back at {opens.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} (in {countdown}).</Text>
      <Pressable onPress={() => router.navigate("/")} style={{ marginTop: 20, height: 38, paddingHorizontal: 16, borderRadius: 10, backgroundColor: "#141418", borderWidth: 1, borderColor: "#2a2a33", alignItems: "center", justifyContent: "center" }}>
        <Text style={{ color: "#e0e0e6", fontFamily: fonts.semi, fontSize: 12.5 }}>← Back to home</Text>
      </Pressable>
    </Door>
  );
}

export function TroubleCard({ message, onRetry, onBack }: { message: string; onRetry?: () => void; onBack: () => void }) {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 12 }}>
      <Text style={{ color: colors.text, fontFamily: fonts.body, fontSize: 14, textAlign: "center", lineHeight: 20 }}>{message}</Text>
      <View style={{ flexDirection: "row", gap: 8, width: 260 }}>
        {onRetry && <Btn label="Try again" primary onPress={onRetry} />}
        <Btn label="Back" onPress={onBack} />
      </View>
    </View>
  );
}

export function WaitLine({ label }: { label: string }) {
  return <LoadingLine label={label} />;
}
