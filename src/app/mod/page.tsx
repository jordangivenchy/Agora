/* /mod — the moderation queue. The gate and the reports are fetched
   here on the server (lib/modData.ts): a visitor who isn't signed in
   goes to /login, a non-moderator goes home, and a moderator's page
   arrives complete behind its loading screen. */

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import { fetchModInitial } from "@/lib/modData";
import ModPage from "@/components/ModPage";

export default async function ModRoute() {
  const supabase = await createClient();
  const initial = await fetchModInitial(supabase);
  if (initial.status === "login") redirect("/login");
  if (initial.status === "denied") redirect("/");
  return <ModPage initial={initial} />;
}
