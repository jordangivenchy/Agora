/* Pictures for posts, comments and messages, the site's way
   (lib/postImages.ts): picked from the library, brought down to 1280
   on the long edge, uploaded to post-images/<uid>/<random>. A GIF goes
   up untouched so it keeps looping. */
import { supabase } from "./supabase";

export const MAX_POST_IMAGE_BYTES = 8 * 1024 * 1024;

export interface PickedImage { uri: string; width: number; height: number; gif: boolean }

/** The library, no cropping. Resolves null when nothing was picked; throws with a message otherwise. */
export async function pickImage(): Promise<PickedImage | null> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ImagePicker = require("expo-image-picker") as typeof import("expo-image-picker");
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) throw new Error("Allow photo access in Settings to attach a picture.");
  const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 1 });
  if (res.canceled || !res.assets?.[0]) return null;
  const a = res.assets[0];
  if (a.fileSize && a.fileSize > MAX_POST_IMAGE_BYTES) throw new Error("Image is too large — keep it under 8 MB.");
  const gif = /image\/gif/i.test(a.mimeType ?? "") || /\.gif$/i.test(a.fileName ?? a.uri);
  return { uri: a.uri, width: a.width, height: a.height, gif };
}

const rand = () => Math.random().toString(16).slice(2) + Date.now().toString(16);

async function uploadUri(uid: string, uri: string, ext: string, contentType: string): Promise<string> {
  const buf = await (await fetch(uri)).arrayBuffer();
  const path = `${uid}/${rand()}.${ext}`;
  const { error } = await supabase.storage.from("post-images").upload(path, buf, { contentType, cacheControl: "31536000" });
  if (error) throw new Error(error.message);
  return supabase.storage.from("post-images").getPublicUrl(path).data.publicUrl;
}

export async function uploadPostImage(uid: string, img: PickedImage): Promise<string> {
  if (img.gif) return uploadUri(uid, img.uri, "gif", "image/gif");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { manipulateAsync, SaveFormat } = require("expo-image-manipulator") as typeof import("expo-image-manipulator");
  const MAX_EDGE = 1280;
  const scale = Math.min(1, MAX_EDGE / Math.max(img.width || MAX_EDGE, img.height || MAX_EDGE));
  const actions = scale < 1 ? [{ resize: img.width >= img.height ? { width: Math.round(img.width * scale) } : { height: Math.round(img.height * scale) } }] : [];
  const out = await manipulateAsync(img.uri, actions, { compress: 0.85, format: SaveFormat.JPEG });
  return uploadUri(uid, out.uri, "jpg", "image/jpeg");
}

/** Square, centre-cropped to 512 (community avatars). */
export async function uploadSquareImage(uid: string, img: PickedImage): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { manipulateAsync, SaveFormat } = require("expo-image-manipulator") as typeof import("expo-image-manipulator");
  const side = Math.min(img.width, img.height);
  const crop = { originX: Math.round((img.width - side) / 2), originY: Math.round((img.height - side) / 2), width: side, height: side };
  const out = await manipulateAsync(img.uri, [{ crop }, { resize: { width: 512, height: 512 } }], { compress: 0.88, format: SaveFormat.JPEG });
  return uploadUri(uid, out.uri, "jpg", "image/jpeg");
}
