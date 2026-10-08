/* /totals: the desk the anonymous totals are downloaded from (Terms,
   section 6). Only for the few people on its list (totals_staff): a
   visitor who isn't signed in goes to /login, and to anyone else the
   page does not exist. The first view is fetched here on the server. */

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import { legalBlanks } from "@/components/agora/legal";
import { deskGate, loadDesk, thisMonth } from "@/lib/totals/desk";
import TotalsDesk from "@/components/TotalsDesk";

export const metadata: Metadata = { title: "Totals · AgoraSphere", robots: { index: false, follow: false } };

export default async function TotalsRoute() {
  const gate = await deskGate(await createClient());
  if (gate.status === "login") redirect("/login");
  if (gate.status === "denied") notFound();
  return <TotalsDesk initial={await loadDesk(thisMonth(new Date()))} blanks={legalBlanks()} />;
}
