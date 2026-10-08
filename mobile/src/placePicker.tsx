/* Choosing a country or a state: the list a phone browser's own picker
   gives the site, as a sheet. A search at the top (a country is one of
   250), the places most people here will choose first, then everything
   A to Z, the one already chosen ticked. One height whatever the search
   turns up, so a row doesn't move as it is reached for; shorter only to
   stay above the keyboard. The list runs to the screen's edge, its last
   row clear of the home bar. */
import { useEffect, useMemo, useState } from "react";
import { FlatList, KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View, useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SheetModal } from "./sheetModal";
import { colors, fonts } from "./theme";
import { searchPlaces, type Place } from "../../src/components/agora/places";

const ROW = 46;
type Row = { key: string; code: string; name: string; lastFirst: boolean };

export function PlacePicker({ open, title, places, first, value, onPick, onClose }: {
  open: boolean;
  title: string;
  places: readonly Place[];
  /** Codes shown above the A-to-Z list while nothing is typed. */
  first?: readonly string[];
  value: string;
  onPick: (code: string) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [q, setQ] = useState("");
  useEffect(() => {
    if (open) setQ("");
  }, [open]);

  const rows = useMemo<Row[]>(() => {
    const found = searchPlaces(places, q).map(([code, name]) => ({ key: code, code, name, lastFirst: false }));
    if (q.trim() || !first?.length) return found;
    const top = first
      .map((code) => places.find(([c]) => c === code))
      .filter((p): p is Place => !!p)
      .map(([code, name], i, all) => ({ key: `first:${code}`, code, name, lastFirst: i === all.length - 1 }));
    return [...top, ...found];
  }, [places, q, first]);

  /* Opened on a place already chosen: the list starts near it. */
  const at = q.trim() ? -1 : rows.findIndex((r) => r.code === value && !r.key.startsWith("first:"));
  const panelH = Math.min(Math.round(height * 0.72), 580);

  return (
    <SheetModal open={open} onClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} pointerEvents="box-none" style={{ flex: 1, justifyContent: "flex-end", paddingTop: insets.top + 8 }}>
        <View style={{ height: panelH, maxHeight: "100%", backgroundColor: "#000", borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, borderBottomWidth: 0, borderColor: colors.border, paddingTop: 8 }}>
          <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: "#3a3a42", alignSelf: "center", marginTop: 2, marginBottom: 12 }} />
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, marginBottom: 12 }}>
            <Text accessibilityRole="header" style={{ color: colors.text, fontFamily: fonts.title, fontSize: 18 }}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close" style={{ width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
              <Ionicons name="close" size={14} color="#a3a3ae" />
            </Pressable>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, height: 40, marginHorizontal: 16, marginBottom: 8, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}>
            <Ionicons name="search" size={15} color={colors.faint} />
            <TextInput
              value={q}
              onChangeText={setQ}
              placeholder="Search"
              placeholderTextColor={colors.faint}
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
              clearButtonMode="while-editing"
              accessibilityLabel={`Search: ${title}`}
              style={{ flex: 1, height: 40, color: colors.text, fontFamily: fonts.body, fontSize: 15, paddingVertical: 0 }}
            />
          </View>
          <FlatList
            data={rows}
            keyExtractor={(r) => r.key}
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingHorizontal: 8, paddingBottom: insets.bottom + 8 }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            initialNumToRender={14}
            getItemLayout={(_data, index) => ({ length: ROW, offset: ROW * index, index })}
            initialScrollIndex={at > 3 ? at - 3 : undefined}
            ListEmptyComponent={<Text style={{ paddingHorizontal: 8, paddingVertical: 14, color: colors.muted, fontFamily: fonts.body, fontSize: 13 }}>Nothing by that name.</Text>}
            renderItem={({ item }) => {
              const on = item.code === value;
              return (
                <Pressable
                  onPress={() => {
                    onPick(item.code);
                    onClose();
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  style={({ pressed }) => ({ height: ROW, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 10, borderRadius: 10, backgroundColor: pressed ? "#17171c" : "transparent", borderBottomWidth: item.lastFirst ? 1 : 0, borderBottomColor: colors.hairline })}
                >
                  <Text numberOfLines={1} style={{ flex: 1, color: on ? colors.yellow : "#eeeef5", fontFamily: on ? fonts.semi : fonts.body, fontSize: 15 }}>{item.name}</Text>
                  {on && <Ionicons name="checkmark" size={17} color={colors.yellow} />}
                </Pressable>
              );
            }}
          />
        </View>
      </KeyboardAvoidingView>
    </SheetModal>
  );
}
