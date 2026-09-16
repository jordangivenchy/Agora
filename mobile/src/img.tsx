/* Every picture that comes over the network: one component, so they all
   cache the same way. React Native's own Image asks for the file again
   on every list that draws it and decodes it on the way in; expo-image
   keeps it in memory and on disk, decodes off the JavaScript thread, and
   fades it in, so a thumbnail seen once is instant the next time — down
   a list, back to a tab, or after the app restarts.

   `recyclingKey` matters in lists: it blanks the view when the row is
   reused, so a tile never shows the last row's picture for a frame. */
import { Image, type ImageContentFit, type ImageSource } from "expo-image";
import type { StyleProp, ImageStyle } from "react-native";

/** The fade is short: long enough to not snap, short enough to not wait. */
const TRANSITION_MS = 140;

export function Img({ uri, style, contentFit = "cover", priority = "normal", recyclingKey, accessibilityLabel, onError }: {
  uri: string | null | undefined;
  style?: StyleProp<ImageStyle>;
  contentFit?: ImageContentFit;
  /** "high" for what someone is looking at now (a hero, a picture they opened). */
  priority?: "low" | "normal" | "high";
  /** In a list: the row's id, so a recycled tile clears first. */
  recyclingKey?: string | null;
  accessibilityLabel?: string;
  onError?: () => void;
}) {
  if (!uri) return null;
  const source: ImageSource = { uri };
  return (
    <Image
      source={source}
      style={style}
      contentFit={contentFit}
      transition={TRANSITION_MS}
      cachePolicy="memory-disk"
      priority={priority}
      recyclingKey={recyclingKey ?? uri}
      accessibilityLabel={accessibilityLabel}
      onError={onError}
    />
  );
}

/** Warm the cache for what's about to scroll into view. Failures are the
    picture's problem, not the caller's. */
export function prefetch(urls: (string | null | undefined)[]): void {
  const list = urls.filter((u): u is string => !!u);
  if (list.length) void Image.prefetch(list, { cachePolicy: "memory-disk" }).catch(() => undefined);
}
