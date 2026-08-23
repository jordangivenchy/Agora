"use client";

/* Controller for the navbar search box (#searchInput inside the MVP
   markup, see mvp-home-html.ts). The box is the ONLY search input: this
   hook mirrors its value into React state, opens the anchored search
   panel on focus/typing, forwards ↑/↓/Enter to the panel, and toggles
   `data-search-open` on the `.nav-search` wrapper (ring + × styling in
   globals.css). It also injects the small × button inside the box.

   The MVP markup is injected imperatively after mount, so the hook polls
   briefly for the element instead of assuming it exists on first run. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

interface Options {
  /** Keydown from the box while the panel is open (↑ ↓ Enter). Return
      true to preventDefault. Escape is handled by the panel's own hook. */
  onKey: (e: KeyboardEvent, value: string) => boolean | void;
  /** The × inside the box was clicked (text already cleared). */
  onCloseRequest: () => void;
}

export interface NavbarSearch {
  query: string;
  setQuery: (q: string) => void;
  open: boolean;
  openPanel: () => void;
  closePanel: () => void;
  /** Put the caret back in the navbar box. */
  focus: () => void;
}

export default function useNavbarSearch({ onKey, onCloseRequest }: Options): NavbarSearch {
  const [query, setQueryState] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const onKeyRef = useRef(onKey);
  const onCloseRef = useRef(onCloseRequest);
  useEffect(() => { onKeyRef.current = onKey; onCloseRef.current = onCloseRequest; });
  const openRef = useRef(open);
  const queryRef = useRef(query);
  useEffect(() => { openRef.current = open; queryRef.current = query; }, [open, query]);

  const setQuery = useCallback((q: string) => {
    setQueryState(q);
    const el = inputRef.current;
    if (el && el.value !== q) el.value = q;
    document.getElementById("navSearchWrap")?.classList.toggle("has-query", q.trim().length > 0);
  }, []);

  const focus = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    const n = el.value.length;
    try { el.setSelectionRange(n, n); } catch { /* not all inputs */ }
  }, []);

  const openPanel = useCallback(() => setOpen(true), []);
  const closePanel = useCallback(() => {
    setOpen(false);
    inputRef.current?.blur();
  }, []);

  /* Bind to the box once it exists. */
  useEffect(() => {
    let cancelled = false;
    let tries = 0;
    let cleanup: (() => void) | null = null;

    const bind = (el: HTMLInputElement) => {
      inputRef.current = el;
      const wrap = document.getElementById("navSearchWrap");
      /* A route (/search?q=…) may have set state before the box existed:
         push that into the box; otherwise adopt whatever the box holds. */
      if (!el.value && queryRef.current) el.value = queryRef.current;
      else setQueryState(el.value);
      wrap?.classList.toggle("has-query", el.value.trim().length > 0);
      if (openRef.current) {
        el.focus({ preventScroll: true });
        const n = el.value.length;
        try { el.setSelectionRange(n, n); } catch { /* ignore */ }
      }

      const onFocus = () => setOpen(true);
      const onInput = () => {
        setQueryState(el.value);
        wrap?.classList.toggle("has-query", el.value.trim().length > 0);
        setOpen(true);
      };
      const onKeyDown = (e: KeyboardEvent) => {
        if (!openRef.current) {
          if (e.key === "Enter" || e.key === "ArrowDown") setOpen(true);
          return;
        }
        if (onKeyRef.current(e, el.value)) e.preventDefault();
      };
      el.addEventListener("focus", onFocus);
      el.addEventListener("input", onInput);
      el.addEventListener("keydown", onKeyDown);

      /* × inside the box: clears the text and closes the panel. */
      let clearBtn: HTMLButtonElement | null = null;
      if (wrap && !wrap.querySelector(".nav-search-clear")) {
        clearBtn = document.createElement("button");
        clearBtn.type = "button";
        clearBtn.className = "nav-search-clear";
        clearBtn.setAttribute("aria-label", "Close search");
        clearBtn.innerHTML =
          '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
        clearBtn.addEventListener("mousedown", (e) => e.preventDefault()); // keep focus handling simple
        clearBtn.addEventListener("click", () => {
          el.value = "";
          setQueryState("");
          wrap.classList.remove("has-query");
          onCloseRef.current();
        });
        el.insertAdjacentElement("afterend", clearBtn);
      }

      cleanup = () => {
        el.removeEventListener("focus", onFocus);
        el.removeEventListener("input", onInput);
        el.removeEventListener("keydown", onKeyDown);
        clearBtn?.remove();
      };
    };

    const tick = () => {
      if (cancelled) return;
      const el = document.getElementById("searchInput") as HTMLInputElement | null;
      if (el) { bind(el); return; }
      if (++tries < 100) setTimeout(tick, 100);
    };
    tick();
    return () => { cancelled = true; cleanup?.(); };
  }, []);

  /* Ring + × while the panel is open. */
  useEffect(() => {
    const wrap = document.getElementById("navSearchWrap");
    if (!wrap) return;
    if (open) wrap.setAttribute("data-search-open", "");
    else wrap.removeAttribute("data-search-open");
  }, [open]);

  return useMemo(() => ({ query, setQuery, open, openPanel, closePanel, focus }), [query, setQuery, open, openPanel, closePanel, focus]);
}
