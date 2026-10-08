/* /privacy — what AgoraSphere holds about people and what it does with
   it. Public, like /terms. */

import type { Metadata } from "next";
import LegalDoc from "@/components/LegalDoc";
import { privacySections } from "@/components/agora/legal";

export const metadata: Metadata = {
  title: "Privacy policy — AgoraSphere",
  description: "What AgoraSphere holds about you, what it does with it, and your choices.",
};

export default function PrivacyPage() {
  return (
    <LegalDoc
      title="Privacy policy"
      lead="What AgoraSphere holds about you, what we do with it, who sees it, and the choices you have."
      sections={privacySections()}
      other={{ href: "/terms", label: "Terms" }}
    />
  );
}
