"use client";

import { useCallback, useState } from "react";
import { Icon } from "@/components/icons";
import Cropper, { type Area } from "react-easy-crop";
import useEscapeClose from "@/lib/useEscapeClose";

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
  useEscapeClose(open && !!src, onCancel);
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

  /* The same solid pop-up as Edit profile, which it opens over (the
     `.epm-*` rules in globals.css). */
  return (
    <div className="epm-veil is-over" onClick={handleCancel}>
      <div
        className="epm is-crop"
        role="dialog"
        aria-modal="true"
        aria-label="Adjust your photo"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="epm-head">
          <h2 className="epm-title">Adjust your photo</h2>
          <button type="button" className="epm-x" onClick={handleCancel} aria-label="Close">
            <Icon name="x" size={13} />
          </button>
        </div>

        <div className="epm-body">
          {error && <p className="stg-banner is-page" role="alert">{error}</p>}

          {/* Crop area */}
          <div className="epm-crop">
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
          <div className="epm-zoom">
            <Icon name="zoom-out" size={14} />
            <input
              type="range"
              min={1}
              max={3}
              step={0.01}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              aria-label="Zoom"
            />
            <Icon name="zoom-in" size={16} />
          </div>

          <p className="epm-hint is-center">Drag to reposition · scroll or slide to zoom</p>
        </div>

        <div className="epm-foot">
          <button type="button" onClick={handleCancel} disabled={applying} className="stg-btn stg-btn--quiet">
            Cancel
          </button>
          <button type="button" onClick={handleApply} disabled={applying} className="stg-btn stg-btn--primary">
            {applying ? "Saving…" : "Apply"}
          </button>
        </div>
      </div>
    </div>
  );
}
