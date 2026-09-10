"use client";

/* The frame the sign-in flows share — login, welcome, the beta door,
   forgot and reset password: the site's ground with its starfield, the
   wordmark, one solid near-black card, and whatever links sit beneath
   it. The pieces inside (titles, labels, fields, the yellow pill) are
   the classes in app/auth.css: the app's own controls, the app's own
   colours. */

import type { ReactNode } from "react";
import Starfield from "@/components/Starfield";
import Wordmark from "@/components/Wordmark";
import "@/app/auth.css";

export default function AuthShell({
  children,
  footer,
  width = 400,
  brandHref = "/",
}: {
  children: ReactNode;
  /** Links under the card. */
  footer?: ReactNode;
  width?: number;
  /** Where the wordmark leads; null for a plain mark (mid-flow screens). */
  brandHref?: string | null;
}) {
  return (
    <div className="auth-shell">
      <Starfield />
      <main className="auth-main" style={{ maxWidth: width }}>
        {brandHref ? (
          <a href={brandHref} className="auth-brand" aria-label="AgoraSphere"><Wordmark size={24} /></a>
        ) : (
          <div className="auth-brand"><Wordmark size={24} /></div>
        )}
        <div className="auth-card">{children}</div>
        {footer && <div className="auth-footer">{footer}</div>}
      </main>
    </div>
  );
}
