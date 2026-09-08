"use client";

/* The Create menu: what the navbar's Create pill and the phone tab
   bar's + open. Three things you can make — a discussion, a post, a
   community — instead of the pill going straight to a room. Mounted
   once in the root layout; opened by an agora:create-menu event whose
   detail carries the anchor (top/right in viewport px) on desktop, or
   nothing on phones, where it is a bottom sheet. */

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "@/components/icons";
import useEscapeClose from "@/lib/useEscapeClose";
import ActionSheet from "@/components/community/ActionSheet";
import { openPostComposer } from "@/components/community/GlobalPostComposer";

type Anchor = { top: number; right: number };

const onHomeShell = () => typeof document !== "undefined" && !!document.getElementById("createModal");

const ITEMS: { icon: IconName; label: string; hint: string; run: () => void }[] = [
  {
    icon: "sparkles",
    label: "Create a Discussion",
    hint: "Open a live room now or schedule one",
    run: () => {
      if (onHomeShell()) window.dispatchEvent(new CustomEvent("agora:create"));
      else window.location.href = "/?create=1";
    },
  },
  {
    icon: "pencil",
    label: "Write a post",
    hint: "On your profile or in a community",
    run: () => openPostComposer(),
  },
  {
    icon: "users-round",
    label: "New community",
    hint: "A board for a school, team or topic",
    run: () => {
      if (onHomeShell()) window.dispatchEvent(new CustomEvent("agora:create-community"));
      else window.location.href = "/?create=community";
    },
  },
];

export default function CreateMenu() {
  const [open, setOpen] = useState<null | { anchor: Anchor | null; phone: boolean }>(null);
  const close = useCallback(() => setOpen(null), []);
  useEscapeClose(!!open, close);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const d = (e as CustomEvent<Partial<Anchor> | undefined>).detail;
      const phone = window.matchMedia("(max-width: 639px)").matches;
      const anchor = d && typeof d.top === "number" && typeof d.right === "number" ? { top: d.top, right: d.right } : null;
      setOpen((cur) => (cur ? null : { anchor, phone }));
    };
    window.addEventListener("agora:create-menu", onOpen);
    return () => window.removeEventListener("agora:create-menu", onOpen);
  }, []);

  useEffect(() => {
    if (!open || open.phone) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.(".create-menu") || t?.closest?.("#searchBtn")) return;
      setOpen(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  if (open.phone) {
    return (
      <ActionSheet
        title="Create"
        items={ITEMS.map((it) => ({ icon: it.icon, label: it.label, run: () => { close(); it.run(); } }))}
        onClose={close}
      />
    );
  }

  const top = (open.anchor?.top ?? 60) + 8;
  const right = Math.max(12, open.anchor?.right ?? 12);
  return createPortal(
    <div
      role="menu"
      aria-label="Create"
      className="create-menu"
      style={{
        position: "fixed", top, right, zIndex: 1300, minWidth: 260, padding: 6, borderRadius: 14,
        background: "#000", border: "1px solid rgba(255,255,255,0.14)", boxShadow: "0 18px 48px rgba(0,0,0,0.6)",
        display: "flex", flexDirection: "column", gap: 2, fontFamily: "'DM Sans', sans-serif",
      }}
    >
      {ITEMS.map((it) => (
        <button
          key={it.label}
          type="button"
          role="menuitem"
          onClick={() => { close(); it.run(); }}
          className="cursor-pointer"
          style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "left", padding: "9px 12px", borderRadius: 10, border: "none", background: "transparent", color: "#eeeef5", fontFamily: "inherit" }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "#1a1a1f"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
        >
          <span style={{ width: 34, height: 34, borderRadius: 10, background: "#ffb700", color: "#1a0e00", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Icon name={it.icon} size={16} />
          </span>
          <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
            <span style={{ fontSize: 13.5, fontWeight: 600 }}>{it.label}</span>
            <span style={{ fontSize: 11.5, color: "rgba(238,238,245,0.5)" }}>{it.hint}</span>
          </span>
        </button>
      ))}
    </div>,
    document.body
  );
}
