/* Community post images: client-side downscale + upload to the
   public post-images bucket (per-user folders, same posture as
   thumbnails). Keeps aspect ratio, capping the long edge — posts
   render inline, so 1280px is plenty. */

import type { SupabaseClient } from "@supabase/supabase-js";

export const MAX_POST_IMAGE_BYTES = 8 * 1024 * 1024;

export async function makePostImage(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const MAX_EDGE = 1280;
    const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas unavailable");
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.85));
    if (!blob) throw new Error("image encode failed");
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* Uploads to post-images/<uid>/<random>.webp and returns the public URL.
   Animated GIFs are uploaded untouched (the canvas re-encode would
   freeze them) so they keep looping in the feed. */
export async function uploadPostImage(
  supabase: SupabaseClient,
  userId: string,
  file: File
): Promise<string> {
  if (file.size > MAX_POST_IMAGE_BYTES) {
    throw new Error("Image is too large — keep it under 8 MB.");
  }
  if (file.type === "image/gif") {
    return uploadBlob(supabase, userId, file, "gif", "image/gif");
  }
  const blob = await makePostImage(file);
  return uploadBlob(supabase, userId, blob);
}

/* Square variant (community avatars): center-crop to 512px. */
export async function uploadSquareImage(
  supabase: SupabaseClient,
  userId: string,
  file: File
): Promise<string> {
  if (file.size > MAX_POST_IMAGE_BYTES) {
    throw new Error("Image is too large — keep it under 8 MB.");
  }
  const { makeSquareThumb } = await import("./thumbs");
  const blob = await makeSquareThumb(file);
  return uploadBlob(supabase, userId, blob);
}

async function uploadBlob(
  supabase: SupabaseClient,
  userId: string,
  blob: Blob,
  ext: string = "webp",
  contentType: string = "image/webp"
): Promise<string> {
  const path = `${userId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage
    .from("post-images")
    .upload(path, blob, { contentType, cacheControl: "31536000" });
  if (error) throw new Error(error.message);
  const { data } = supabase.storage.from("post-images").getPublicUrl(path);
  return data.publicUrl;
}
