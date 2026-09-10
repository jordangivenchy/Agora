/* "/". Decided here on the server, before anything renders — and
   before any Suspense boundary, so they are real HTTP redirects: the
   legacy query links (?nav=, ?post=, ?profile=, ?dm=) go to the routes
   they mean, and a signed-in visitor on a bare "/" who hasn't picked
   Home this session (lib/homeChoice.ts) gets their feed. Everyone else
   gets the home page, its first view — the hero's rooms and the
   navbar's user — fetched as the viewer (lib/homeData.ts) under the
   loading screen while the shell streams. */

import { Suspense } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import { fetchHomeInitial } from "@/lib/homeData";
import { HOME_COOKIE } from "@/lib/homeChoice";
import { isHomeSection, pathFor } from "@/lib/routes";
import { userPath } from "@/lib/urls";
import HomePage from "@/components/HomePage";
import LoadingScreen from "@/components/LoadingScreen";

type Params = Record<string, string | string[] | undefined>;
const first = (sp: Params, key: string): string | null => {
  const v = sp[key];
  return (Array.isArray(v) ? v[0] : v) ?? null;
};

export default async function Home({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const supabase = await createClient();

  const nav = first(sp, "nav");
  if (nav && isHomeSection(nav)) redirect(pathFor.section(nav));
  const post = first(sp, "post");
  if (post) redirect(pathFor.post(post, first(sp, "comment")));
  const profile = first(sp, "profile");
  if (profile) {
    const { data } = await supabase.from("users").select("username").eq("id", profile).maybeSingle();
    if (data?.username) redirect(userPath(data.username));
  }
  const dm = first(sp, "dm");
  if (dm) {
    const { data } = await supabase.from("users").select("username").eq("id", dm).maybeSingle();
    redirect(data?.username ? pathFor.messages(data.username) : "/");
  }

  if (Object.keys(sp).length === 0) {
    const chosen = (await cookies()).get(HOME_COOKIE)?.value === "1";
    if (!chosen) {
      // The session's claims, verified locally — no auth round trip.
      const { data } = await supabase.auth.getClaims();
      if (data?.claims?.sub) redirect(pathFor.section("feed"));
    }
  }

  return (
    <Suspense fallback={<LoadingScreen />}>
      <HomeData />
    </Suspense>
  );
}

async function HomeData() {
  const supabase = await createClient();
  const initial = await fetchHomeInitial(supabase);
  return <HomePage initial={initial} />;
}
