/* A room's card thumbnail: the picked picture cropped square to a 512
   JPEG in the host's folder of the thumbnails bucket, its public URL on
   the room (debate_rooms.thumbnail_url). Cards fall back to the host's
   profile picture when there is none. */
import { supabase } from "./supabase";
import type { PickedImage } from "./postImages";

export async function uploadRoomThumbnail(hostId: string, roomId: string, img: PickedImage): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { manipulateAsync, SaveFormat } = require("expo-image-manipulator") as typeof import("expo-image-manipulator");
  const side = Math.min(img.width, img.height);
  const crop = { originX: Math.round((img.width - side) / 2), originY: Math.round((img.height - side) / 2), width: side, height: side };
  const out = await manipulateAsync(img.uri, [{ crop }, { resize: { width: 512, height: 512 } }], { compress: 0.85, format: SaveFormat.JPEG });
  const buf = await (await fetch(out.uri)).arrayBuffer();
  const path = `${hostId}/${roomId}.jpg`;
  const { error: upErr } = await supabase.storage.from("thumbnails").upload(path, buf, { upsert: true, cacheControl: "3600", contentType: "image/jpeg" });
  if (upErr) throw new Error(upErr.message);
  const url = supabase.storage.from("thumbnails").getPublicUrl(path).data.publicUrl;
  const { error: dbErr } = await supabase.from("debate_rooms").update({ thumbnail_url: url }).eq("id", roomId);
  if (dbErr) throw new Error(dbErr.message);
  return url;
}
