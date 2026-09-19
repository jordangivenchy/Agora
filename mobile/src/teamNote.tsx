/* A note from the team, under the hero — the site's TeamNote.tsx in
   the app's clothes.

   A post a moderator features on the home page used to take a hero
   slide: the title, a paragraph, then the site's own features as a
   list, in the product's yellow. A note from people built from the
   chrome's parts stops reading as a note. This is the quiet version:
   the team's mark, two sentences, a way to read the rest, and an ×
   that puts it away until the team writes a new one. */
import { useEffect, useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import type { FeaturedPost } from "./home";
import { inlineRich } from "./richText";
import { colors, fonts } from "./theme";

const KEY = "agora-team-note-read";

/* The first two sentences of the opening paragraph — enough to know
   what the note is about. Cut on the full stop, so a link in the text
   stays whole. */
export function noteLead(excerpt: string, max = 2): string {
  const parts = excerpt.split(/(?<=[.!?])\s+/).filter(Boolean);
  const lead = parts.slice(0, max).join(" ").trim();
  return lead.replace(/…$/, "") || excerpt;
}

export function TeamNote({ posts }: { posts: FeaturedPost[] }) {
  const note = posts[0] ?? null;
  /* Which note was put away — unknown until storage answers, and the
     strip waits for that rather than showing and then vanishing. */
  const [read, setRead] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(KEY).then(
      (v) => { if (alive) setRead(v ?? null); },
      () => { if (alive) setRead(null); },
    );
    return () => { alive = false; };
  }, []);
  if (!note || read === undefined || read === note.id) return null;

  const open = () => router.push({ pathname: "/posts/[id]", params: { id: note.id } });
  const dismiss = () => {
    setRead(note.id);
    void AsyncStorage.setItem(KEY, note.id).catch(() => undefined);
  };

  return (
    <View style={{ flexDirection: "row", gap: 12, marginHorizontal: 12, marginTop: 12, marginBottom: 6, padding: 14, borderRadius: 12, backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline }}>
      <Image source={require("../assets/as-face.png")} style={{ width: 36, height: 36, borderRadius: 18 }} accessibilityLabel="AgoraSphere" />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 12, marginBottom: 3 }}>A note from the team</Text>
        <Text numberOfLines={2} style={{ color: "#c9c9d2", fontFamily: fonts.body, fontSize: 13.5, lineHeight: 19 }}>{inlineRich(noteLead(note.excerpt), "note")}</Text>
        {/* Its own line, under the clamp, so it can never be clipped away. */}
        <Pressable onPress={open} hitSlop={6} style={{ alignSelf: "flex-start", marginTop: 7, borderBottomWidth: 1, borderBottomColor: "#3a3a45" }}>
          <Text style={{ color: colors.text, fontFamily: fonts.semi, fontSize: 13 }}>Read the whole note ↗</Text>
        </Pressable>
      </View>
      <Pressable onPress={dismiss} hitSlop={8} accessibilityLabel="Put this note away" style={{ width: 28, height: 28, marginTop: -4, marginRight: -6, borderRadius: 8, alignItems: "center", justifyContent: "center" }}>
        <Ionicons name="close" size={16} color={colors.muted} />
      </Pressable>
    </View>
  );
}
