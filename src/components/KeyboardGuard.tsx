"use client";

/* Phones: with the keyboard up, iOS scrolls the whole layout to reveal
   the focused field, so the fixed tab bar rode up onto the keyboard
   with everything else. Keep the window pinned instead: the scroll
   boxes end at the keyboard (html.kb-open + --kb; mvp-home.css and
   globals.css) and the field is scrolled clear of it inside its own
   box, while the tab bar stays put behind the keyboard like a native
   app's. Inactive where the keyboard shrinks the layout itself
   (Android) or on desktop. Mounted by the home page (app/page.tsx),
   where the shell's own scroll boxes live; renders nothing. */

import { useEffect } from "react";

export default function KeyboardGuard() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const phone = window.matchMedia("(max-width: 639px)");
    const root = document.documentElement;
    let open = false, raf = 0;
    const editable = (el: Element | null): el is HTMLElement =>
      !!el && el !== document.body &&
      (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || (el as HTMLElement).isContentEditable);
    const scroller = (el: Element) => {
      for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
        const o = getComputedStyle(n).overflowY;
        if ((o === "auto" || o === "scroll") && n.scrollHeight > n.clientHeight) return n;
      }
      return null;
    };
    const reveal = () => {
      const el = document.activeElement;
      if (!editable(el)) return;
      const box = scroller(el);
      if (!box) return;
      const r = el.getBoundingClientRect(), b = box.getBoundingClientRect();
      const lo = Math.max(b.top, 0) + 12, hi = Math.min(b.bottom, vv.height) - 12;
      if (r.bottom > hi) box.scrollTop += r.bottom - hi;
      else if (r.top < lo) box.scrollTop -= lo - r.top;
    };
    // A drag that no box can absorb — on the top bar, or on a box already
    // at its end — would otherwise scroll the layout itself under the
    // keyboard, tab bar and all. Let boxes scroll; swallow the rest.
    const absorbs = (el: Element | null, dy: number) => {
      for (let n: Element | null = el; n && n !== document.body; n = n.parentElement) {
        const o = getComputedStyle(n).overflowY;
        if ((o === "auto" || o === "scroll") && n.scrollHeight > n.clientHeight) {
          return dy > 0 ? n.scrollTop > 0 : n.scrollTop + n.clientHeight < n.scrollHeight - 1;
        }
      }
      return false;
    };
    let ty = 0;
    const onTouchStart = (e: TouchEvent) => { ty = e.touches[0].clientY; };
    const lock = (e: TouchEvent) => {
      if (!open || e.touches.length !== 1) return;
      if (!absorbs(e.target as Element | null, e.touches[0].clientY - ty)) e.preventDefault();
    };
    const sync = () => {
      raf = 0;
      const kb = phone.matches && vv.scale < 1.05 ? Math.round(window.innerHeight - vv.height) : 0;
      const now = kb > 80 && editable(document.activeElement);
      if (now !== open) {
        open = now;
        root.classList.toggle("kb-open", open);
        // The touch lock is only on the document while the keyboard is up.
        if (open) document.addEventListener("touchmove", lock, { passive: false, capture: true });
        else document.removeEventListener("touchmove", lock, { capture: true });
      }
      root.style.setProperty("--kb", open ? `${kb}px` : "0px");
      if (open || (phone.matches && window.scrollY)) window.scrollTo(0, 0);
      if (open) reveal();
    };
    const queue = () => { if (!raf) raf = requestAnimationFrame(sync); };
    const onScroll = () => { if (open && window.scrollY) window.scrollTo(0, 0); };
    const onFocusOut = () => { setTimeout(queue, 60); };
    vv.addEventListener("resize", queue);
    vv.addEventListener("scroll", queue);
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("focusin", queue);
    document.addEventListener("focusout", onFocusOut);
    document.addEventListener("touchstart", onTouchStart, { passive: true, capture: true });
    return () => {
      cancelAnimationFrame(raf);
      vv.removeEventListener("resize", queue);
      vv.removeEventListener("scroll", queue);
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("focusin", queue);
      document.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("touchstart", onTouchStart, { capture: true });
      document.removeEventListener("touchmove", lock, { capture: true });
      root.classList.remove("kb-open");
      root.style.removeProperty("--kb");
    };
  }, []);
  return null;
}
