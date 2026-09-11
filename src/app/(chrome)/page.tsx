/* "/". Decided here on the server, before anything renders — and
   before any Suspense boundary, so they are real HTTP redirects: the
   legacy query links (?nav=, ?post=, ?profile=, ?dm=) go to the routes
   they mean. Everyone else gets the home page, its first view — the
   hero's rooms, the notices and the navbar's user — fetched as the
   viewer (lib/homeData.ts) while the shell streams. */

import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import { fetchHomeInitial } from "@/lib/homeData";
import { isHomeSection, pathFor } from "@/lib/routes";
import { userPath } from "@/lib/urls";
import HomePage from "@/components/HomePage";
import RouteLoading from "@/components/RouteLoading";

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

  /* While the first view streams: the bar at the top, not a curtain —
     the chrome is up around it, and a tab tap back to Home should feel
     like a tab tap. (The session's first load has the boot splash over
     all of this anyway.) */
  return (
    <Suspense fallback={<RouteLoading />}>
      <HomeData />
    </Suspense>
  );
}

async function HomeData() {
  const supabase = await createClient();
  const initial = await fetchHomeInitial(supabase);
  return <HomePage initial={initial} />;
}
