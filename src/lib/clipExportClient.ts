/* Asking for the upright cut, from wherever the offer is made — the clip
   page, or the moment a clip is saved. The render happens on the server
   (api/clips/<id>/export) and is kept, so the second time is instant. */

export async function exportClipVertical(clipId: string, title: string | null): Promise<void> {
  const res = await fetch(`/api/clips/${clipId}/export`, { method: "POST" });
  const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!res.ok || !body.url) throw new Error(body.error || "Couldn't make the file.");
  const a = document.createElement("a");
  a.href = body.url;
  a.download = `${(title || "clip").replace(/[^\w\s-]/g, "").trim() || "clip"}-vertical.mp4`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
