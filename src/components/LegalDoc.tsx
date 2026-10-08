/* A legal document as a page: the terms, the privacy policy. The words
   are data (components/agora/legal) so the app shows the same ones.
   Plain markup on the site's black, set for reading; the styles are the
   legal-* rules in globals.css. */

import Link from "next/link";
import Wordmark from "@/components/Wordmark";
import { LEGAL, legalBlanks, type LegalSection } from "@/components/agora/legal";

export default function LegalDoc({ title, lead, sections, other }: {
  title: string;
  lead: string;
  sections: LegalSection[];
  /** The companion document, linked at the top and the bottom. */
  other: { href: string; label: string };
}) {
  const blanks = legalBlanks();
  return (
    <div className="legal">
      <header className="legal-top">
        <Link href="/" className="legal-brand" aria-label="AgoraSphere"><Wordmark size={22} /></Link>
        <a href={other.href} className="legal-other">{other.label}</a>
      </header>
      <main className="legal-page">
        <h1 className="legal-title">{title}</h1>
        <p className="legal-meta">Version of {LEGAL.effective}</p>
        {blanks.length > 0 && (
          <p className="legal-draft" role="note">
            A draft, not yet in force. Still to be filled in: {blanks.join("; ")}.
          </p>
        )}
        <p className="legal-lead">{lead}</p>
        {sections.map((s) => (
          <section key={s.id} id={s.id} className="legal-section">
            <h2>{s.title}</h2>
            {s.body.map((block, i) =>
              typeof block === "string" ? (
                <p key={i}>{block}</p>
              ) : (
                <ul key={i}>
                  {block.list.map((item, j) => <li key={j}>{item}</li>)}
                </ul>
              )
            )}
          </section>
        ))}
        <footer className="legal-foot">
          <a href={other.href}>{other.label}</a>
          <Link href="/">Back to AgoraSphere</Link>
        </footer>
      </main>
    </div>
  );
}
