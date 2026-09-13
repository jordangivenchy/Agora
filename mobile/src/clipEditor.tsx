/* The clip editor (components/agora/ClipEditor.tsx) as a sheet over
   the replay: the last 30 seconds before the scissors were pressed
   are picked; the in and out points nudge by five seconds or take the
   player's own position; the player loops the selection while it's
   open; title it, save, and the clip's link is ready. */
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, Share, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { VideoPlayer } from "expo-video";
import { supabase } from "./supabase";
import { SITE } from "./api";
import { saveClip } from "./clips";
import { colors, fonts } from "./theme";

const MIN_LEN = 3, MAX_LEN = 90;
const fmt = (s: number) => `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, "0")}`;

export function ClipEditorSheet({ open, player, duration, captureAt, roomId, uid, onClose }: { open: boolean; player: VideoPlayer; duration: number; captureAt: number; roomId: string; uid: string | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    const e = Math.min(duration || captureAt, Math.max(MIN_LEN, captureAt));
    setEnd(e);
    setStart(Math.max(0, e - 30));
    setTitle("");
    setErr(null);
    setSavedId(null);
  }, [open, captureAt, duration]);
  /* The player loops the selection while the sheet is up. */
  useEffect(() => {
    if (!open || savedId) return;
    player.currentTime = start;
    player.play();
    const t = setInterval(() => {
      if (player.currentTime >= end - 0.05 || player.currentTime < start - 1) player.currentTime = start;
      if (!player.playing) player.play();
    }, 250);
    return () => { clearInterval(t); player.pause(); };
  }, [open, start, end, player, savedId]);

  const len = end - start;
  const setIn = (v: number) => { const ns = Math.max(0, Math.min(v, end - MIN_LEN)); setStart(Math.max(ns, end - MAX_LEN)); };
  const setOut = (v: number) => { const ne = Math.min(duration || v, Math.max(v, start + MIN_LEN)); setEnd(Math.min(ne, start + MAX_LEN)); };
  const save = async () => {
    if (busy) return;
    if (!uid) { onClose(); router.push("/sign-in"); return; }
    setBusy(true);
    setErr(null);
    const r = await saveClip(supabase, uid, roomId, title, start, end);
    setBusy(false);
    if (!r.id) { setErr(r.error ?? "Couldn't save the clip."); return; }
    setSavedId(r.id);
  };
  const nudge = (label: string, onPress: () => void) => (
    <Pressable onPress={onPress} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: "#17171c", borderWidth: 1, borderColor: "#2e2e38" }}><Text style={{ color: "#e8e8ee", fontFamily: fonts.semi, fontSize: 12 }}>{label}</Text></Pressable>
  );
  const link = savedId ? `${SITE}/clips/${savedId}` : "";
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1 }} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={{ backgroundColor: "#0e0e11", borderTopLeftRadius: 18, borderTopRightRadius: 18, borderWidth: 1, borderBottomWidth: 0, borderColor: "#2e2e38", paddingHorizontal: 16, paddingTop: 14, paddingBottom: insets.bottom + 12 }}>
          {savedId ? (
            <View style={{ gap: 12 }}>
              <Text style={{ color: colors.gold, fontFamily: fonts.semi, fontSize: 14 }}>Clip saved ✓</Text>
              <Text numberOfLines={1} style={{ color: "#c0c0c8", fontFamily: fonts.body, fontSize: 12 }}>{link}</Text>
              <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                <Pressable onPress={() => void Share.share({ message: title || "Clip", url: link }).catch(() => undefined)} style={{ paddingHorizontal: 16, paddingVertical: 9, borderRadius: 999, backgroundColor: colors.blue }}><Text style={{ color: "#fff", fontFamily: fonts.semi, fontSize: 12.5 }}>Share</Text></Pressable>
                <Pressable onPress={() => { const id = savedId; onClose(); setTimeout(() => router.push({ pathname: "/clips/[id]", params: { id } }), 300); }} style={{ paddingHorizontal: 16, paddingVertical: 9, borderRadius: 999, backgroundColor: colors.yellow }}><Text style={{ color: colors.ink, fontFamily: fonts.semi, fontSize: 12.5 }}>View clip →</Text></Pressable>
                <Pressable onPress={onClose} style={{ paddingHorizontal: 12, paddingVertical: 9 }}><Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 12.5 }}>Close</Text></Pressable>
              </View>
            </View>
          ) : (
            <View style={{ gap: 12 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Ionicons name="cut-outline" size={16} color={colors.gold} />
                <Text style={{ color: colors.text, fontFamily: fonts.title, fontSize: 15 }}>Clip this moment</Text>
                <View style={{ flex: 1 }} />
                <Text style={{ color: len >= MAX_LEN - 0.5 ? colors.gold : "#a8a8b2", fontFamily: fonts.body, fontSize: 12 }}>{fmt(start)} → {fmt(end)} · {len.toFixed(0)}s{len >= MAX_LEN - 0.5 ? " (max)" : ""}</Text>
              </View>
              <View style={{ height: 8, borderRadius: 4, backgroundColor: "#1f1f26", overflow: "hidden" }}>
                {duration > 0 && <View style={{ position: "absolute", left: `${(start / duration) * 100}%`, width: `${Math.max(1, (len / duration) * 100)}%`, top: 0, bottom: 0, backgroundColor: colors.gold }} />}
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 12, width: 34 }}>In</Text>
                {nudge("−5s", () => setIn(start - 5))}{nudge("+5s", () => setIn(start + 5))}{nudge("Here", () => setIn(player.currentTime))}
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 12, width: 34 }}>Out</Text>
                {nudge("−5s", () => setOut(end - 5))}{nudge("+5s", () => setOut(end + 5))}{nudge("Here", () => setOut(player.currentTime))}
              </View>
              <TextInput value={title} onChangeText={(t) => setTitle(t.slice(0, 120))} placeholder="Title your clip…" placeholderTextColor={colors.faint} style={{ height: 40, borderRadius: 10, borderWidth: 1, borderColor: "#2e2e38", backgroundColor: "#111114", color: colors.text, fontFamily: fonts.body, fontSize: 13.5, paddingHorizontal: 12 }} />
              {err && <Text style={{ color: "#fca5a5", fontFamily: fonts.body, fontSize: 11.5 }}>{err}</Text>}
              <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
                <Pressable onPress={onClose} style={{ paddingHorizontal: 12, paddingVertical: 9 }}><Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 12.5 }}>Cancel</Text></Pressable>
                <Pressable onPress={() => void save()} disabled={busy} style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16, paddingVertical: 9, borderRadius: 999, backgroundColor: "#d9a238", opacity: busy ? 0.6 : 1 }}>
                  <Ionicons name="cut-outline" size={13} color="#2b1a02" /><Text style={{ color: "#2b1a02", fontFamily: fonts.semi, fontSize: 12.5 }}>{busy ? "Saving…" : "Save clip"}</Text>
                </Pressable>
              </View>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
