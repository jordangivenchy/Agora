/* Room thumbnail helpers, shared by CreateRoomModal and HostControls. */

export const MAX_THUMB_BYTES = 5 * 1024 * 1024;

/* Center-crop to a 512px square webp — cards render at 168px, so this keeps
   uploads small without needing a crop UI. */
export async function makeSquareThumb(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const size = 512;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas unavailable");
    const s = Math.min(img.width, img.height);
    ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.85));
    if (!blob) throw new Error("thumbnail encode failed");
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}
