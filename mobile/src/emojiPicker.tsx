/* The site's emoji picker (components/EmojiPicker.tsx) as a sheet: a
   search, the recent row, the categories. */
import { useEffect, useMemo, useState } from "react";
import { FlatList, Modal, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { EMOJI_CATEGORIES } from "./emojiData";
import { colors, fonts } from "./theme";

const RECENT_KEY = "agora:emoji-recent";
const RECENT_MAX = 24;
type Entry = { e: string; k: string };
const ALL: { name: string; entries: Entry[] }[] = EMOJI_CATEGORIES.map((c) => ({
  name: c.name,
  entries: c.items.split("|").map((s) => { const i = s.indexOf(" "); return { e: s.slice(0, i), k: s.slice(i + 1).toLowerCase() }; }),
}));

async function readRecent(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(RECENT_KEY);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
  } catch { return []; }
}

export function EmojiPicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (emoji: string) => void }) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [query, setQuery] = useState("");
  const [recent, setRecent] = useState<string[]>([]);
  const [cat, setCat] = useState(0);
  useEffect(() => { if (open) { setQuery(""); void readRecent().then(setRecent); } }, [open]);
  const q = query.trim().toLowerCase();
  const results = useMemo(() => {
    if (!q) return null;
    const out: Entry[] = [];
    for (const c of ALL) for (const en of c.entries) if (en.k.includes(q)) out.push(en);
    return out.slice(0, 120);
  }, [q]);
  const pick = (e: string) => {
    const next = [e, ...recent.filter((x) => x !== e)].slice(0, RECENT_MAX);
    setRecent(next);
    AsyncStorage.setItem(RECENT_KEY, JSON.stringify(next)).catch(() => undefined);
    onPick(e);
  };
  const cols = Math.max(6, Math.floor((width - 24) / 44));
  const grid = results ?? ALL[cat].entries;
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)" }} />
      <View style={{ backgroundColor: "#0e0e11", borderTopLeftRadius: 18, borderTopRightRadius: 18, borderWidth: 1, borderBottomWidth: 0, borderColor: "#2e2e38", paddingTop: 10, paddingBottom: insets.bottom + 8, height: Math.round(height * 0.5) }}>
        <View style={{ paddingHorizontal: 12 }}>
          <TextInput value={query} onChangeText={setQuery} placeholder="Search emoji" placeholderTextColor={colors.faint} autoCapitalize="none" autoCorrect={false} style={{ height: 36, borderRadius: 10, paddingHorizontal: 12, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, color: colors.text, fontFamily: fonts.body, fontSize: 13.5 }} />
        </View>
        {!results && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 12, gap: 6, paddingVertical: 8 }}>
            {ALL.map((c, i) => (
              <Pressable key={c.name} onPress={() => setCat(i)} style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: cat === i ? colors.surface2 : "transparent", borderWidth: 1, borderColor: cat === i ? colors.border : "transparent" }}>
                <Text style={{ color: cat === i ? colors.text : colors.muted, fontFamily: fonts.medium, fontSize: 12 }}>{c.name}</Text>
              </Pressable>
            ))}
          </ScrollView>
        )}
        {!results && recent.length > 0 && cat === 0 && (
          <View style={{ paddingHorizontal: 12, paddingBottom: 4 }}>
            <Text style={{ color: colors.faint, fontFamily: fonts.semi, fontSize: 10.5, letterSpacing: 0.6, marginBottom: 2 }}>RECENT</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
              {recent.map((e) => <Pressable key={`r-${e}`} onPress={() => pick(e)} style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center" }}><Text style={{ fontSize: 24 }}>{e}</Text></Pressable>)}
            </View>
          </View>
        )}
        <FlatList
          data={grid}
          key={cols}
          numColumns={cols}
          keyExtractor={(en, i) => `${en.e}-${i}`}
          contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 12 }}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => <Pressable onPress={() => pick(item.e)} style={{ width: (width - 24) / cols, height: 40, alignItems: "center", justifyContent: "center" }}><Text style={{ fontSize: 24 }}>{item.e}</Text></Pressable>}
          ListEmptyComponent={<Text style={{ color: colors.faint, fontFamily: fonts.body, fontSize: 12, textAlign: "center", paddingVertical: 20 }}>No emoji for that.</Text>}
        />
      </View>
    </Modal>
  );
}
