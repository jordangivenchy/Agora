/* /terms — AgoraSphere's terms (the EULA). Public: readable signed out
   and without a beta pass (proxy.ts), so anyone asked to agree can read
   what they are agreeing to. */

import type { Metadata } from "next";
import LegalDoc from "@/components/LegalDoc";
import { termsSections } from "@/components/agora/legal";

export const metadata: Metadata = {
  title: "Terms — AgoraSphere",
  description: "The agreement between you and AgoraSphere.",
};

export default function TermsPage() {
  return (
    <LegalDoc
      title="Terms"
      lead="The agreement between you and AgoraSphere: what you can expect from us, and what we ask of you."
      sections={termsSections()}
      other={{ href: "/privacy", label: "Privacy policy" }}
    />
  );
}
