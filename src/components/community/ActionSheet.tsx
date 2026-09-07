"use client";

/* Phone action sheet: what press-and-hold on a post or a comment opens.
   Solid, bottom-anchored, one row per action, Cancel underneath; the
   scrim or Escape closes it. */

import { createPortal } from "react-dom";
import { Icon, type IconName } from "@/components/icons";
import useEscapeClose from "@/lib/useEscapeClose";

export interface SheetItem {
  icon: IconName;
  label: string;
  run: () => void;
  danger?: boolean;
}

export default function ActionSheet({
  title,
  items,
  onClose,
}: {
  title?: string;
  items: SheetItem[];
  onClose: () => void;
}) {
  useEscapeClose(true, onClose);
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[1300]"
      style={{ background: "rgba(0,0,0,0.55)" }}
      onClick={onClose}
      onContextMenu={(e) => e.preventDefault()}
      role="presentation"
    >
      <div
        role="menu"
        aria-label={title ?? "Actions"}
        className="action-sheet"
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 0,
          background: "#0b0b0d",
          borderTop: "1px solid rgba(255,255,255,0.1)",
          borderRadius: "18px 18px 0 0",
          padding: "8px 12px calc(12px + env(safe-area-inset-bottom))",
          fontFamily: "'DM Sans', sans-serif",
        }}
      >
        <span
          aria-hidden="true"
          style={{ display: "block", width: 36, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.18)", margin: "2px auto 10px" }}
        />
        {title && (
          <p
            style={{
              margin: "0 0 6px",
              padding: "0 10px",
              fontSize: 12,
              color: "rgba(238,238,245,0.45)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {title}
          </p>
        )}
        {items.map((it) => (
          <button
            key={it.label}
            type="button"
            role="menuitem"
            onClick={() => {
              onClose();
              it.run();
            }}
            className="cursor-pointer"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              width: "100%",
              height: 48,
              padding: "0 10px",
              borderRadius: 12,
              background: "none",
              border: "none",
              color: it.danger ? "#ff8a80" : "#eeeef5",
              fontSize: 15,
              fontWeight: 600,
              fontFamily: "inherit",
              textAlign: "left",
            }}
          >
            <Icon name={it.icon} size={18} /> {it.label}
          </button>
        ))}
        <button
          type="button"
          onClick={onClose}
          className="cursor-pointer"
          style={{
            marginTop: 6,
            width: "100%",
            height: 44,
            borderRadius: 999,
            background: "#000",
            border: "1px solid rgba(255,255,255,0.14)",
            color: "#c9c9d2",
            fontSize: 14,
            fontWeight: 700,
            fontFamily: "inherit",
          }}
        >
          Cancel
        </button>
      </div>
    </div>,
    document.body
  );
}
