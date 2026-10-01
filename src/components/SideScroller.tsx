"use client";

/* A tailored side scroller: the browser's own scrollbar hidden, and in
   its place a slim rail at the right in the site's colours — a solid
   thumb that comes up while the list moves or a pointer is over it,
   that can be dragged, and a click on the rail above or below it pages
   that way. The list itself still scrolls natively (wheel, keys, touch
   momentum), so nothing about scrolling changes but the look. The
   thumb's size and place are written straight onto it, never through
   React state, so scrolling renders nothing. */

import { useEffect, useRef, type ReactNode } from "react";

/* Rail inset at the top and bottom, and the shortest thumb (px). */
const INSET = 6;
const MIN_THUMB = 28;

export default function SideScroller({ className, children }: { className?: string; children: ReactNode }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current, area = areaRef.current, thumb = thumbRef.current;
    const rail = thumb?.parentElement;
    if (!wrap || !area || !thumb || !rail) return;
    let raf = 0;
    let idle = 0;
    let travel = 0;

    const place = () => {
      raf = 0;
      const { scrollTop, scrollHeight, clientHeight } = area;
      const fits = scrollHeight <= clientHeight + 1;
      wrap.classList.toggle("is-fits", fits);
      if (fits) return;
      const railH = clientHeight - INSET * 2;
      const thumbH = Math.max(MIN_THUMB, Math.round((railH * clientHeight) / scrollHeight));
      travel = railH - thumbH;
      const y = INSET + (travel * scrollTop) / (scrollHeight - clientHeight);
      thumb.style.height = `${thumbH}px`;
      thumb.style.transform = `translateY(${y}px)`;
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(place);
    };
    const onScroll = () => {
      schedule();
      wrap.classList.add("is-scrolling");
      window.clearTimeout(idle);
      idle = window.setTimeout(() => wrap.classList.remove("is-scrolling"), 900);
    };
    area.addEventListener("scroll", onScroll, { passive: true });
    /* The list's box changing size, or rows coming and going inside it. */
    const resized = new ResizeObserver(schedule);
    resized.observe(area);
    const changed = new MutationObserver(schedule);
    changed.observe(area, { childList: true, subtree: true });
    place();

    /* Dragging the thumb: the list follows the pointer, a thumb's
       travel to the list's whole length. */
    let startY = 0;
    let startTop = 0;
    const onMove = (e: PointerEvent) => {
      if (travel <= 0) return;
      area.scrollTop = startTop + ((e.clientY - startY) * (area.scrollHeight - area.clientHeight)) / travel;
    };
    const onUp = (e: PointerEvent) => {
      if (thumb.hasPointerCapture(e.pointerId)) thumb.releasePointerCapture(e.pointerId);
      wrap.classList.remove("is-dragging");
      thumb.removeEventListener("pointermove", onMove);
      thumb.removeEventListener("pointerup", onUp);
      thumb.removeEventListener("pointercancel", onUp);
    };
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      startY = e.clientY;
      startTop = area.scrollTop;
      thumb.setPointerCapture(e.pointerId);
      wrap.classList.add("is-dragging");
      thumb.addEventListener("pointermove", onMove);
      thumb.addEventListener("pointerup", onUp);
      thumb.addEventListener("pointercancel", onUp);
    };
    thumb.addEventListener("pointerdown", onDown);
    /* A click on the rail itself: a page up or down. */
    const onRail = (e: PointerEvent) => {
      if (e.target !== rail || e.button !== 0) return;
      const above = e.clientY < thumb.getBoundingClientRect().top;
      area.scrollBy({ top: (above ? -1 : 1) * area.clientHeight * 0.9, behavior: "smooth" });
    };
    rail.addEventListener("pointerdown", onRail);

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(idle);
      area.removeEventListener("scroll", onScroll);
      resized.disconnect();
      changed.disconnect();
      thumb.removeEventListener("pointerdown", onDown);
      thumb.removeEventListener("pointermove", onMove);
      thumb.removeEventListener("pointerup", onUp);
      thumb.removeEventListener("pointercancel", onUp);
      rail.removeEventListener("pointerdown", onRail);
    };
  }, []);

  return (
    <div ref={wrapRef} className="side-scroller is-fits">
      <div ref={areaRef} className={`side-scroller-area${className ? ` ${className}` : ""}`}>
        {children}
      </div>
      <div className="side-scroller-rail" aria-hidden="true">
        <div ref={thumbRef} className="side-scroller-thumb" />
      </div>
    </div>
  );
}
