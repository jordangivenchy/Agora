/* GET /api/news — headline feed for the homepage news ticker.
 *
 * Backed by Particle (particle.news), whose model fits us exactly: stories
 * are clusters of articles from many publishers, so each headline carries
 * the list of outlets covering it. Their API is partner-gated, so the
 * integration is env-driven:
 *
 *   PARTICLE_API_KEY   — bearer token (from your Particle partnership)
 *   PARTICLE_API_URL   — stories endpoint (defaults to their v1 feed)
 *
 * Until credentials exist (or when the upstream call fails) we serve a
 * static sample feed, flagged `sample: true`, so the ticker renders and
 * the UI contract is exercised end to end. The response shape is ours —
 * swap-proof against upstream field churn:
 *
 *   { sample: boolean, stories: [{ id, headline, url, publishedAt,
 *       sources: [{ name, domain }] }] }
 */

const TTL_MS = 5 * 60_000;
let cache: { at: number; body: NewsPayload } | null = null;

type Source = { name: string; domain: string };
type Story = { id: string; headline: string; url: string | null; publishedAt: string | null; sources: Source[] };
type NewsPayload = { sample: boolean; stories: Story[] };

/* Defensive mapper over Particle's story-cluster shape. Field names are
 * guessed from their public product (title + per-publisher articles); the
 * fallbacks make this tolerant of naming drift until we have real docs. */
function normalizeParticle(json: unknown): Story[] {
  const list = (json as { stories?: unknown[]; data?: unknown[]; results?: unknown[] });
  const rows = list?.stories ?? list?.data ?? list?.results ?? [];
  if (!Array.isArray(rows)) return [];
  return rows.slice(0, 20).flatMap((raw): Story[] => {
    const r = raw as Record<string, unknown>;
    const headline = (r.title ?? r.headline ?? r.name) as string | undefined;
    if (!headline) return [];
    const arts = (r.articles ?? r.items ?? []) as Array<Record<string, unknown>>;
    const sources: Source[] = [];
    const seen = new Set<string>();
    for (const a of Array.isArray(arts) ? arts : []) {
      const pub = (a.publisher ?? a.source ?? a.outlet) as Record<string, unknown> | string | undefined;
      const name = typeof pub === "string" ? pub : ((pub?.name ?? pub?.title) as string | undefined);
      const url = (a.url ?? a.link) as string | undefined;
      let domain = "";
      try { domain = url ? new URL(url).hostname.replace(/^www\./, "") : ""; } catch { /* bad url */ }
      if (name && !seen.has(name)) { seen.add(name); sources.push({ name, domain }); }
    }
    return [{
      id: String(r.id ?? headline),
      headline,
      url: (r.url ?? r.link ?? (arts?.[0]?.url as string | undefined) ?? null) as string | null,
      publishedAt: (r.published_at ?? r.publishedAt ?? r.updated_at ?? null) as string | null,
      sources,
    }];
  });
}

/* Placeholder feed served until PARTICLE_API_KEY is configured. Clearly
 * generic wording — the ticker labels the feed as sample data. */
const SAMPLE: Story[] = [
  { id: "s1", headline: "Global leaders meet for climate summit as emissions targets slip", url: null, publishedAt: null,
    sources: [{ name: "Reuters", domain: "reuters.com" }, { name: "BBC", domain: "bbc.com" }, { name: "AP", domain: "apnews.com" }] },
  { id: "s2", headline: "Markets rally after central bank signals rate pause", url: null, publishedAt: null,
    sources: [{ name: "Bloomberg", domain: "bloomberg.com" }, { name: "Financial Times", domain: "ft.com" }, { name: "CNBC", domain: "cnbc.com" }] },
  { id: "s3", headline: "Breakthrough trial reports progress on universal flu vaccine", url: null, publishedAt: null,
    sources: [{ name: "NYT", domain: "nytimes.com" }, { name: "The Guardian", domain: "theguardian.com" }, { name: "STAT", domain: "statnews.com" }] },
  { id: "s4", headline: "New AI regulation framework clears key legislative hurdle", url: null, publishedAt: null,
    sources: [{ name: "The Verge", domain: "theverge.com" }, { name: "Wired", domain: "wired.com" }, { name: "Reuters", domain: "reuters.com" }] },
  { id: "s5", headline: "Historic turnout reported in regional elections across three continents", url: null, publishedAt: null,
    sources: [{ name: "AP", domain: "apnews.com" }, { name: "Al Jazeera", domain: "aljazeera.com" }, { name: "BBC", domain: "bbc.com" }] },
  { id: "s6", headline: "Space agency confirms crewed lunar mission window for next year", url: null, publishedAt: null,
    sources: [{ name: "NASA", domain: "nasa.gov" }, { name: "Space.com", domain: "space.com" }, { name: "NYT", domain: "nytimes.com" }] },
];

export async function GET() {
  if (cache && Date.now() - cache.at < TTL_MS) {
    return Response.json(cache.body);
  }

  const key = process.env.PARTICLE_API_KEY;
  const url = process.env.PARTICLE_API_URL ?? "https://api.particle.news/v1/stories/top";
  let body: NewsPayload = { sample: true, stories: SAMPLE };

  if (key) {
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const stories = normalizeParticle(await res.json());
        if (stories.length > 0) body = { sample: false, stories };
      }
    } catch {
      /* upstream down → sample feed keeps the ticker alive */
    }
  }

  cache = { at: Date.now(), body };
  return Response.json(body);
}
