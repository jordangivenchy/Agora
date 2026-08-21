"use client";

/* The homepage's liquid-glass sidebar, reused on the standalone profile
   route. The markup is sliced live out of MVP_HOME_HTML so the two can
   never drift, and mvp-home.css is imported via profile-sidebar.css —
   demoted into a cascade layer so its universal reset can't zero the
   page's Tailwind spacing. This component is only ever loaded
   dynamically from the standalone route, so the in-room profile drawer
   never sees any of it.

   All adjustments happen to the HTML STRING before injection (never by
   mutating the mounted DOM — strict-mode/fast-refresh remounts recreate
   the injected tree and would silently revert mutations), and all
   listeners are document-delegated so they keep working across any
   remount:
   - "Home is active" state stripped (we're on a profile)
   - Subscriptions hidden, same as mvp-adapter.js does on the homepage
   - nav clicks navigate to /?nav=<section>; the homepage's deep-link
     effect opens the section itself once booted (no cross-page click
     replaying)
   - spotlight border cursor tracking, same mapping as mvp-home.js but
     rAF-throttled
   The friends section is the real FriendsSection, portaled into the
   injected host node. */

import { memo, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MVP_HOME_HTML } from "@/components/mvp-home-html";
import FriendsSection from "@/components/friends/FriendsSection";
import "./profile-sidebar.css";

function sidebarMarkup(): string {
  const start = MVP_HOME_HTML.indexOf('<aside class="sidebar"');
  const end = MVP_HOME_HTML.indexOf("</aside>");
  if (start === -1 || end === -1) return "";
  let html = MVP_HOME_HTML.slice(start, end + "</aside>".length);
  // Not on a home section: drop the baked-in active state.
  // (Subscriptions is hidden in the source markup itself.)
  html = html.replace(/class="sidebar-link active"/g, 'class="sidebar-link"');
  return html;
}

/* The injected markup lives in a memo child with a stable prop, so no
   parent re-render can ever reach its dangerouslySetInnerHTML — a reset
   recreates the aside and restarts its entrance animation (the "ghost
   sidebar" flicker this replaced). */
const StaticSidebarHtml = memo(function StaticSidebarHtml({ html }: { html: string }) {
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
});

export default function ProfileSidebar() {
  const router = useRouter();
  const [hosts, setHosts] = useState<{ friends: HTMLElement; aside: HTMLElement } | null>(null);
  const [html] = useState(sidebarMarkup);

  /* The memo child guarantees the injected DOM is created exactly once
     per mount, so a single post-commit bind is enough — no polling. A
     strict-mode remount recreates the tree and re-runs this effect. */
  useEffect(() => {
    const aside = document.querySelector("aside.sidebar");
    const friends = aside?.querySelector("#friendsSection");
    if (aside instanceof HTMLElement && friends instanceof HTMLElement) {
      setHosts({ friends, aside });
    }

    if (!(aside instanceof HTMLElement)) return;

    /* Nav clicks: hand the section over via /?nav=<id> — the homepage
       opens it itself once booted (same deep-link pattern as ?post), so
       there's no cross-page polling or replayed clicks. */
    const onClick = (e: MouseEvent) => {
      const link = (e.target as HTMLElement).closest?.(".sidebar-link");
      if (!link || !aside.contains(link)) return;
      e.preventDefault();
      const navId = link.getAttribute("data-nav-id");
      router.push(!navId || navId === "home" ? "/" : `/?nav=${navId}`);
    };

    /* Spotlight border, rAF-throttled: at most one batch of style
       writes per frame, against the cached aside node. */
    let frame = 0;
    let last: PointerEvent | null = null;
    const paint = () => {
      frame = 0;
      const e = last;
      if (!e) return;
      aside.style.setProperty("--x", e.clientX.toFixed(2));
      aside.style.setProperty("--y", e.clientY.toFixed(2));
      aside.style.setProperty("--xp", (e.clientX / window.innerWidth).toFixed(2));
      aside.style.setProperty("--yp", (e.clientY / window.innerHeight).toFixed(2));
      aside.style.setProperty(
        "--hue",
        String(Math.round(210 - (e.clientX / window.innerWidth) * 180))
      );
    };
    const onPointer = (e: PointerEvent) => {
      last = e;
      if (!frame) frame = requestAnimationFrame(paint);
    };

    document.addEventListener("click", onClick);
    document.addEventListener("pointermove", onPointer, { passive: true });
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("pointermove", onPointer);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [router]);

  return (
    <>
      <StaticSidebarHtml html={html} />
      {hosts && hosts.friends.isConnected && (
        <FriendsSection container={hosts.friends} sidebar={hosts.aside} />
      )}
    </>
  );
}
