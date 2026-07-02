"use client";

import { useState, useRef, useEffect } from "react";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  roomId?: string;
  userId?: string;
}

export default function NotesPopout({ isOpen, onClose, roomId, userId }: Props) {
  const [notes, setNotes] = useState("");
  const popoutRef = useRef<HTMLDivElement>(null);
  const titlebarRef = useRef<HTMLDivElement>(null);
  const positioned = useRef(false);

  // Build a stable localStorage key for this (room, user) pair
  const storageKey = roomId && userId ? `agora-notes-${roomId}-${userId}` : null;

  // Load saved notes when the key becomes available (on mount / user resolves)
  useEffect(() => {
    if (!storageKey) return;
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (saved !== null) setNotes(saved);
    } catch {
      /* localStorage may be disabled — silently skip */
    }
  }, [storageKey]);

  // Debounced write-back on change
  useEffect(() => {
    if (!storageKey) return;
    const t = setTimeout(() => {
      try { window.localStorage.setItem(storageKey, notes); } catch {}
    }, 250);
    return () => clearTimeout(t);
  }, [notes, storageKey]);

  // Position on first open
  useEffect(() => {
    if (isOpen && !positioned.current && popoutRef.current) {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const W = 340, H = 420;
      const left = Math.min(Math.round(vw * 0.58), vw - W - 20);
      const top = Math.round((vh - H) / 2);
      popoutRef.current.style.left = left + "px";
      popoutRef.current.style.top = top + "px";
      positioned.current = true;
    }
  }, [isOpen]);

  // Drag logic
  useEffect(() => {
    const titlebar = titlebarRef.current;
    const popout = popoutRef.current;
    if (!titlebar || !popout) return;

    let dragging = false;
    let startX = 0, startY = 0, origLeft = 0, origTop = 0;

    function onMouseDown(e: MouseEvent) {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest(".notes-close-btn")) return;
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      origLeft = popout!.offsetLeft;
      origTop = popout!.offsetTop;
      e.preventDefault();
    }

    function onMouseMove(e: MouseEvent) {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const pw = popout!.offsetWidth;
      const left = Math.max(40 - pw, Math.min(vw - 40, origLeft + dx));
      const top = Math.max(0, Math.min(vh - 40, origTop + dy));
      popout!.style.left = left + "px";
      popout!.style.top = top + "px";
    }

    function onMouseUp() { dragging = false; }

    titlebar.addEventListener("mousedown", onMouseDown);
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);

    return () => {
      titlebar.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  // ESC to close
  useEffect(() => {
    if (!isOpen) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);

  return (
    <div
      ref={popoutRef}
      className={`notes-popout ${isOpen ? "is-open" : ""}`}
    >
      <div ref={titlebarRef} className="notes-titlebar">
        <span className="notes-title-text">Notes</span>
        <button
          className="notes-close-btn"
          onClick={onClose}
          aria-label="Close notes"
          title="Close"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <textarea
        className="notes-editor"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Start typing your debate notes…"
        spellCheck={true}
      />

      <div className="notes-footer">
        <span className="notes-hint">
          Private · Auto-saved locally
        </span>
      </div>
    </div>
  );
}
