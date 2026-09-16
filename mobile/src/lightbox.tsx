/* The image viewer (components/ImageLightbox.tsx): one host at the
   root; openImage(url) from any picture worth seeing big. Pinch to
   zoom, tap the corner to close. */
import { useEffect, useState } from "react";
import { Image, Modal, Pressable, ScrollView, View, useWindowDimensions } from "react-native";
import { Img } from "./img";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

let show: ((url: string) => void) | null = null;
export function openImage(url: string) { show?.(url); }

export function LightboxHost() {
  const [url, setUrl] = useState<string | null>(null);
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  useEffect(() => { show = setUrl; return () => { show = null; }; }, []);
  return (
    <Modal visible={!!url} transparent={false} animationType="fade" onRequestClose={() => setUrl(null)}>
      <View style={{ flex: 1, backgroundColor: "#000" }}>
        <ScrollView maximumZoomScale={4} minimumZoomScale={1} centerContent contentContainerStyle={{ width, height, alignItems: "center", justifyContent: "center" }} bouncesZoom>
          {url && <Img uri={url} style={{ width, height: height - 80 }} contentFit="contain" priority="high" />}
        </ScrollView>
        <Pressable onPress={() => setUrl(null)} accessibilityLabel="Close" hitSlop={8} style={{ position: "absolute", top: insets.top + 8, right: 14, width: 36, height: 36, borderRadius: 18, backgroundColor: "#16161c", alignItems: "center", justifyContent: "center" }}>
          <Ionicons name="close" size={20} color="#fff" />
        </Pressable>
      </View>
    </Modal>
  );
}
