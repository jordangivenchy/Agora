/* /settings. The account, profile, settings and block list are fetched
   here on the server (lib/settingsData.ts), as the viewer, so the page
   arrives complete behind its loading screen; a visitor who isn't
   signed in goes to /login. */

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import { fetchSettingsInitial } from "@/lib/settingsData";
import SettingsPage from "@/components/SettingsPage";

export default async function SettingsRoute() {
  const supabase = await createClient();
  const initial = await fetchSettingsInitial(supabase);
  if (initial.status === "login") redirect("/login");
  return <SettingsPage initial={initial} />;
}
