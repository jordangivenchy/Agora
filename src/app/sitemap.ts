import type { MetadataRoute } from "next";
import { createClient } from "@supabase/supabase-js";
import { siteOrigin } from "@/lib/siteOrigin";
import { REPLAY_FIELDS } from "@/lib/replaysData";
import { replayPath } from "@/lib/urls";

/* The map a crawler follows: the front page, the archive and each field
   of it, and every recorded discussion. Read with the anonymous key —
   the same view a crawler gets when it follows one of these links, so
   the map can never promise a page that asks for a password. */

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = siteOrigin();
  const now = new Date();
  const base: MetadataRoute.Sitemap = [
    { url: origin, lastModified: now, changeFrequency: "hourly", priority: 1 },
    { url: `${origin}/replays`, lastModified: now, changeFrequency: "daily", priority: 0.9 },
    { url: `${origin}/communities`, lastModified: now, changeFrequency: "daily", priority: 0.6 },
    { url: `${origin}/news`, lastModified: now, changeFrequency: "hourly", priority: 0.5 },
    ...REPLAY_FIELDS.map((f) => ({
      url: `${origin}/replays?field=${f.key}`,
      lastModified: now,
      changeFrequency: "daily" as const,
      priority: 0.6,
    })),
  ];
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return base;

  const { data } = await createClient(url, anon, { auth: { persistSession: false } })
    .from("debate_rooms")
    .select("id, motion, ended_at")
    .eq("status", "ended")
    .eq("is_private", false)
    .not("recording_url", "is", null)
    .order("ended_at", { ascending: false })
    .limit(5000);

  const replays = ((data ?? []) as { id: string; motion: string | null; ended_at: string | null }[]).map((r) => ({
    url: `${origin}${replayPath(r)}`,
    lastModified: r.ended_at ? new Date(r.ended_at) : now,
    changeFrequency: "monthly" as const,
    priority: 0.7,
  }));
  return [...base, ...replays];
}
