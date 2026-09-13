/* The phone composer from the site: a sheet over the keyboard with
   Cancel and the yellow pill up top, a line naming what it answers,
   then the text. Posts get a title line too. */
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, fonts } from "./theme";

export function ComposerSheet({ open, kind, context, contextName, onClose, onSubmit }: {
  open: boolean;
  kind: "post" | "comment";
  /** For replies: the line under the buttons, e.g. the comment answered. */
  context?: string | null;
  contextName?: string | null;
  onClose: () => void;
  /** Resolves to an error to show, or null when it went through. */
  onSubmit: (input: { title: string; body: string }) => Promise<string | null>;
}) {
  const insets = useSafeAreaInsets();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) { setTitle(""); setBody(""); setError(null); setBusy(false); }
  }, [open]);
  const canSend = !busy && (kind === "post" ? !!title.trim() : !!body.trim());
  const send = async () => {
    if (!canSend) return;
    setBusy(true);
    const err = await onSubmit({ title: title.trim(), body: body.trim() });
    setBusy(false);
    if (err) setError(err);
    else onClose();
  };
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)" }} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={{ backgroundColor: colors.surface2, borderTopLeftRadius: 18, borderTopRightRadius: 18, borderWidth: 1, borderBottomWidth: 0, borderColor: "#23232b", paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 + insets.bottom }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 36 }}>
            <Pressable onPress={onClose} hitSlop={8}><Text style={{ color: "#c3c3ce", fontFamily: fonts.body, fontSize: 15 }}>Cancel</Text></Pressable>
            <Pressable onPress={() => void send()} disabled={!canSend} style={{ height: 34, paddingHorizontal: 16, borderRadius: 999, backgroundColor: colors.yellow, alignItems: "center", justifyContent: "center", opacity: canSend ? 1 : 0.45 }}>
              <Text style={{ color: colors.ink, fontFamily: fonts.bold, fontSize: 13 }}>{busy ? "Sending…" : kind === "post" ? "Post" : "Comment"}</Text>
            </Pressable>
          </View>
          {context ? (
            <Text numberOfLines={1} style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 13, marginTop: 6 }}>
              {contextName ? <Text style={{ color: "#f2f2f6", fontFamily: fonts.bold }}>{contextName}  </Text> : null}{context}
            </Text>
          ) : null}
          {kind === "post" && (
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="Title"
              placeholderTextColor={colors.faint}
              autoFocus
              maxLength={300}
              style={{ color: colors.text, fontFamily: fonts.semi, fontSize: 16, paddingVertical: 10, marginTop: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline }}
            />
          )}
          <TextInput
            value={body}
            onChangeText={setBody}
            placeholder={kind === "post" ? "Say more (optional)" : "Take the floor"}
            placeholderTextColor={colors.faint}
            autoFocus={kind === "comment"}
            multiline
            maxLength={kind === "post" ? 10000 : 4000}
            style={{ color: colors.text, fontFamily: fonts.body, fontSize: 16, lineHeight: 22, minHeight: 96, maxHeight: 260, paddingVertical: 10, textAlignVertical: "top" }}
          />
          {error && <Text style={{ color: "#ff9d92", fontFamily: fonts.body, fontSize: 12.5, marginTop: 4 }}>{error}</Text>}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
