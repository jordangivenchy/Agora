/* The image in a paste or a drop, if there is one. Browsers hand a
   copied screenshot over as a file item on the clipboard (and a
   dragged picture as a file on the drop), so the composers can treat
   both exactly like the attach button's file picker. Returns the first
   image file, or null when the paste/drop was only text. */

export function imageFromDataTransfer(dt: DataTransfer | null | undefined): File | null {
  if (!dt) return null;
  const files = dt.files ? Array.from(dt.files) : [];
  const fromFiles = files.find((f) => f.type.startsWith("image/"));
  if (fromFiles) return fromFiles;
  const items = dt.items ? Array.from(dt.items) : [];
  for (const item of items) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const f = item.getAsFile();
      if (f) return f;
    }
  }
  return null;
}
