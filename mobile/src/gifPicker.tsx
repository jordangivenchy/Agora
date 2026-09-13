/* GIPHY search (components/community/GifPicker.tsx): dormant until
   EXPO_PUBLIC_GIPHY_KEY is set, as on the site. */
import { useEffect, useState } from "react";
import { FlatList, Image, Modal, Pressable, Text, TextInput, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, fonts } from "./theme";

const GIPHY_KEY = process.env.EXPO_PUBLIC_GIPHY_KEY;
export const giphyEnabled = !!GIPHY_KEY;
type Gif = { id: string; url: string; preview: string };

export function GifPicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (url: string) => void }) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [query, setQuery] = useState("");
  const [gifs, setGifs] = useState<Gif[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open || !GIPHY_KEY) return;
    let dead = false;
    const t = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const q = query.trim();
        const endpoint = q
          ? `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_KEY}&q=${encodeURIComponent(q)}&limit=18&rating=pg-13`
          : `https://api.giphy.com/v1/gifs/trending?api_key=${GIPHY_KEY}&limit=18&rating=pg-13`;
        const res = await fetch(endpoint);
        if (!res.ok) throw new Error(`GIPHY ${res.status}`);
        const json = (await res.json()) as { data?: { id: string; images?: { fixed_width?: { url?: string }; fixed_width_small?: { url?: string } } }[] };
        if (dead) return;
        setGifs((json.data ?? []).map((g) => ({ id: g.id, url: g.images?.fixed_width?.url ?? "", preview: g.images?.fixed_width_small?.url ?? g.images?.fixed_width?.url ?? "" })).filter((g) => g.url));
      } catch (e) {
        if (!dead) setError(e instanceof Error ? e.message : "GIF search failed");
      } finally {
        if (!dead) setLoading(false);
      }
    }, query ? 300 : 0);
    return () => { dead = true; clearTimeout(t); };
  }, [query, open]);
  if (!GIPHY_KEY) return null;
  const cell = (width - 24 - 12) / 3;
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)" }} />
      <View style={{ backgroundColor: "#0e0e11", borderTopLeftRadius: 18, borderTopRightRadius: 18, borderWidth: 1, borderBottomWidth: 0, borderColor: "#2e2e38", paddingTop: 10, paddingBottom: insets.bottom + 8, height: Math.round(height * 0.55) }}>
        <View style={{ paddingHorizontal: 12, paddingBottom: 8 }}>
          <TextInput value={query} onChangeText={setQuery} placeholder="Search GIPHY…" placeholderTextColor={colors.faint} autoFocus style={{ height: 36, borderRadius: 10, paddingHorizontal: 12, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, color: colors.text, fontFamily: fonts.body, fontSize: 13.5 }} />
        </View>
        {error ? <Text style={{ color: "#e88", fontFamily: fonts.body, fontSize: 12, textAlign: "center", paddingVertical: 16 }}>{error}</Text> : (
          <FlatList
            data={gifs}
            numColumns={3}
            keyExtractor={(g) => g.id}
            columnWrapperStyle={{ gap: 6 }}
            contentContainerStyle={{ paddingHorizontal: 12, gap: 6, paddingBottom: 12 }}
            renderItem={({ item }) => <Pressable onPress={() => { onPick(item.url); onClose(); }}><Image source={{ uri: item.preview }} style={{ width: cell, height: 90, borderRadius: 6, backgroundColor: colors.surface2 }} /></Pressable>}
            ListEmptyComponent={<Text style={{ color: colors.faint, fontFamily: fonts.body, fontSize: 12, textAlign: "center", paddingVertical: 16 }}>{loading ? "Loading…" : "No GIFs found."}</Text>}
          />
        )}
        <Text style={{ color: "rgba(238,238,245,0.25)", fontFamily: fonts.body, fontSize: 9, textAlign: "right", paddingHorizontal: 12 }}>Powered by GIPHY</Text>
      </View>
    </Modal>
  );
}
