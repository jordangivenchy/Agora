"use client";

import { useCallback, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";

interface Props {
  open: boolean;
  /** Object URL (or data URL) of the image to crop. */
  src: string | null;
  onCancel: () => void;
  /** Receives the cropped image as a square WebP blob (512×512). */
  onApply: (blob: Blob) => void | Promise<void>;
}

/** Draw the selected crop area onto a square canvas and export as WebP. */
async function getCroppedBlob(imageSrc: string, cropPx: Area, size = 512): Promise<Blob> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("Could not load image"));
    i.src = imageSrc;
  });
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");
  ctx.drawImage(
    img,
    cropPx.x, cropPx.y, cropPx.width, cropPx.height,
    0, 0, size, size
  );
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Crop failed"))),
      "image/webp",
      0.9
    )
  );
}

export default function AvatarCropModal({ open, src, onCancel, onApply }: Props) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onCropComplete = useCallback((_area: Area, areaPixels: Area) => {
    setCroppedAreaPixels(areaPixels);
  }, []);

  if (!open || !src) return null;

  async function handleApply() {
    if (!croppedAreaPixels || !src) return;
    setError(null);
    setApplying(true);
    try {
      const blob = await getCroppedBlob(src, croppedAreaPixels);
      await onApply(blob);
      // Reset for next use
      setCrop({ x: 0, y: 0 });
      setZoom(1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Crop failed");
    } finally {
      setApplying(false);
    }
  }

  function handleCancel() {
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setError(null);
    onCancel();
  }

  return (
    <div
      className="fixed inset-0 z-[990] flex items-center justify-center p-5"
      style={{
        background: "rgba(0,0,0,0.82)",
        backdropFilter: "blur(4px)",
        animation: "modalIn 0.2s ease",
      }}
      onClick={handleCancel}
    >
      <div
        className="w-full"
        style={{
          maxWidth: 420,
          background: "rgba(18,18,21,0.97)",
          border: "1px solid var(--border)",
          borderRadius: 20,
          boxShadow: "0 24px 80px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.04)",
          padding: "20px 20px 18px",
          animation: "modalPanelIn 0.25s cubic-bezier(0.25, 0.46, 0.45, 0.94)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2
            style={{
              fontFamily: "'DM Sans', sans-serif",
              fontSize: 16,
              fontWeight: 700,
              letterSpacing: "-0.02em",
              color: "var(--text-primary)",
            }}
          >
            Adjust your photo
          </h2>
          <button
            onClick={handleCancel}
            className="flex items-center justify-center cursor-pointer transition-all"
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              color: "var(--text-muted)",
              background: "rgba(255,255,255,0.04)",
              border: "1px solid var(--border)",
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {error && (
          <div
            className="rounded-lg px-3 py-2 mb-3"
            style={{
              background: "rgba(239,68,68,0.08)",
              border: "1px solid rgba(239,68,68,0.3)",
              color: "#fca5a5",
              fontSize: 12.5,
            }}
          >
            {error}
          </div>
        )}

        {/* Crop area */}
        <div
          className="relative w-full overflow-hidden"
          style={{
            height: 300,
            borderRadius: 14,
            background: "#000",
            border: "1px solid var(--border)",
          }}
        >
          <Cropper
            image={src}
            crop={crop}
            zoom={zoom}
            aspect={1}
            cropShape="round"
            showGrid={false}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={onCropComplete}
          />
        </div>

        {/* Zoom slider */}
        <div className="flex items-center gap-3" style={{ margin: "16px 2px 18px" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35M8 11h6" />
          </svg>
          <input
            type="range"
            min={1}
            max={3}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="flex-1 cursor-pointer"
            style={{ accentColor: "var(--accent-blue)", height: 4 }}
          />
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35M11 8v6M8 11h6" />
          </svg>
        </div>

        <p
          style={{
            fontSize: 11.5,
            color: "var(--text-dim)",
            textAlign: "center",
            marginBottom: 16,
          }}
        >
          Drag to reposition · scroll or slide to zoom
        </p>

        <div className="flex gap-2">
          <button
            onClick={handleCancel}
            disabled={applying}
            className="flex-1 cursor-pointer transition-all"
            style={{
              padding: "11px 16px",
              borderRadius: 100,
              background: "rgba(255,255,255,0.04)",
              border: "1px solid var(--border)",
              color: "var(--text-muted)",
              fontFamily: "'DM Sans', sans-serif",
              fontSize: 13.5,
              fontWeight: 600,
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleApply}
            disabled={applying}
            className="flex-1 cursor-pointer transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              padding: "11px 16px",
              borderRadius: 100,
              background: "var(--accent-blue)",
              border: "none",
              color: "#fff",
              fontFamily: "'DM Sans', sans-serif",
              fontSize: 13.5,
              fontWeight: 600,
            }}
            onMouseEnter={(e) => {
              if (!applying) e.currentTarget.style.background = "var(--accent-purple-light)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "var(--accent-blue)";
            }}
          >
            {applying ? "Saving…" : "Apply"}
          </button>
        </div>
      </div>
    </div>
  );
}
