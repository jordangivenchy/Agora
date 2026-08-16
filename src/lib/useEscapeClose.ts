"use client";

import { useEffect, useRef } from "react";

/* Overlays register on a shared stack so that when several are open at once
   (profile modal → edit profile → avatar crop), one Escape press closes only
   the topmost layer instead of unwinding everything. */
const stack: symbol[] = [];

export default function useEscapeClose(active: boolean, onClose: () => void) {
  // Ref keeps the effect keyed on `active` alone — an inline onClose arrow
  // would otherwise re-run the effect every render and scramble stack order.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    if (!active) return;
    const id = Symbol("escape-layer");
    stack.push(id);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (stack[stack.length - 1] !== id) return;
      closeRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      const i = stack.indexOf(id);
      if (i >= 0) stack.splice(i, 1);
      document.removeEventListener("keydown", onKey);
    };
  }, [active]);
}
