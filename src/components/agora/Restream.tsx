"use client";

/* Sending the room out to TikTok, Twitch or YouTube: the host does it
   themselves. They copy a link to a clean view of the room (the speakers
   over the stage, nothing else) and give it to OBS or Streamlabs on their
   own computer, which films it and sends it out with their own stream
   key, at whatever size and quality they set there (lib/ownStream).

   We used to do the sending as well — LiveKit filming the room on its
   machines and pushing it to an address the host pasted in. It cost us
   by the minute, it was 720p at best, and the people who restream already
   have a streaming app; it went in October 2026. */
import { useState } from "react";

export default function Restream({ roomId }: { roomId: string }) {
  const [link, setLink] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "busy" | "copied" | "shown">("idle");
  const [error, setError] = useState<string | null>(null);

  const copyLink = async () => {
    setState("busy");
    setError(null);
    try {
      const res = await fetch("/api/egress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId, action: "own_link" }),
      });
      const d = await res.json();
      if (!res.ok || typeof d.url !== "string") {
        setError(d.error || "Couldn't make the link");
        setState("idle");
        return;
      }
      setLink(d.url);
      try {
        await navigator.clipboard.writeText(d.url);
        setState("copied");
      } catch {
        /* The browser kept its clipboard: the link goes in a box to copy by hand. */
        setState("shown");
      }
    } catch {
      setError("Couldn't make the link — try again.");
      setState("idle");
    }
  };

  return (
    <div className="ag-set-group">
      <div className="ag-set-text">
        Send this room to TikTok, Twitch or YouTube from OBS or Streamlabs on your computer.
      </div>
      <button className="ag-host-act wide" disabled={state === "busy"} onClick={copyLink}>
        {state === "busy" ? "…" : state === "copied" ? "Link copied" : "Copy stream link"}
      </button>
      {link && state === "shown" && (
        <input
          readOnly
          value={link}
          aria-label="Stream link"
          spellCheck={false}
          className="ag-host-input"
          onFocus={(e) => e.currentTarget.select()}
        />
      )}
      {error && <div className="ag-host-err">{error}</div>}
      <ol className="ag-set-steps">
        <li>Add a Browser source and paste the link as its URL.</li>
        <li>
          Set its size to your canvas: 1920 × 1080 for a wide stream, 1080 × 1920 for a tall one. The
          cameras arrange themselves to fit.
        </li>
        <li>Tick &ldquo;Control audio via OBS&rdquo; so the room&apos;s sound goes out.</li>
        <li>Go live with your own stream key.</li>
      </ol>
      <div className="ag-set-text">
        It runs on your computer and internet, at whatever quality you set. Keep the link to yourself:
        it opens this room for 12 hours.
      </div>
    </div>
  );
}
