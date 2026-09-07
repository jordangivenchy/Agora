"use client";

/* One image viewer for the whole app. Any picture that wants to open
   big calls openImage(url) (lib/lightbox.ts); this overlay, mounted
   once in the root layout, shows it centred on a solid black ground at
   up to the viewport's size. Escape, the close button, or a click on
   the ground closes it; "Open original" is the file itself in a new
   tab for saving. Solid surfaces, no tint, per the house style. */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/icons";
import useEscapeClose from "@/lib/useEscapeClose";
import { LIGHTBOX_EVENT, type LightboxDetail } from "@/lib/lightbox";

export default function ImageLightbox() {
  const [img, setImg] = useState<LightboxDetail | null>(null);

  useEffect(() => {
    const onOpen = (e: Event) => setImg((e as CustomEvent<LightboxDetail>).detail);
    window.addEventListener(LIGHTBOX_EVENT, onOpen);
    return () => window.removeEventListener(LIGHTBOX_EVENT, onOpen);
  }, []);

  useEscapeClose(!!img, () => setImg(null));

  /* The page under the viewer holds still. */
  useEffect(() => {
    if (!img) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [img]);

  if (!img || typeof document === "undefined") return null;

  return createPortal(
    <div
      role="dialog"
      aria-label="Image"
      onClick={() => setImg(null)}
      style={{
        position: "fixed", inset: 0, zIndex: 1400, background: "#000",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "max(56px, env(safe-area-inset-top)) 16px max(16px, env(safe-area-inset-bottom))",
        boxSizing: "border-box", cursor: "zoom-out",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={img.url}
        alt={img.alt ?? ""}
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: 6, cursor: "default", display: "block" }}
      />
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ position: "absolute", top: "max(12px, env(safe-area-inset-top))", right: 12, display: "flex", alignItems: "center", gap: 8, cursor: "default" }}
      >
        <a
          href={img.url}
          target="_blank"
          rel="noopener noreferrer"
          className="no-underline"
          style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 36, padding: "0 14px", borderRadius: 999, background: "#0b0b0d", border: "1px solid rgba(255,255,255,0.16)", color: "#eeeef5", fontSize: 12.5, fontWeight: 600, fontFamily: "'DM Sans', sans-serif" }}
        >
          <Icon name="external-link" size={13} /> Open original
        </a>
        <button
          type="button"
          onClick={() => setImg(null)}
          aria-label="Close"
          className="cursor-pointer"
          style={{ width: 36, height: 36, borderRadius: 999, background: "#0b0b0d", border: "1px solid rgba(255,255,255,0.16)", color: "#eeeef5", display: "inline-flex", alignItems: "center", justifyContent: "center", padding: 0 }}
        >
          <Icon name="x" size={15} />
        </button>
      </div>
    </div>,
    document.body
  );
}
