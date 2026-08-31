/* GET /api/news — headline feed for the homepage hero + ticker.
 *
 * Providers, first configured wins (all env-gated, same pattern as
 * Resend/HLS — see /api/health `news`):
 *
 *   NEWSDATA_API_KEY   — newsdata.io. Free tier: 200 credits/day, top-tier
 *                        outlets via prioritydomain=top, debate-relevant
 *                        categories, ~12h publication delay (free-plan
 *                        limitation; paid plans are real-time).
 *   GNEWS_API_KEY      — gnews.io (commercial plan; cheapest licensed
 *                        source with real outlet coverage). Top headlines,
 *                        one outlet per story.
 *   PARTICLE_API_KEY   — particle.news (partner-gated). Stories are
 *                        multi-publisher clusters, the ideal shape.
 *   PARTICLE_API_URL   — stories endpoint (defaults to their v1 feed)
 *
 * Evaluated and rejected: Google News RSS (license forbids non-personal
 * use) and GDELT (429s after a handful of requests — unusable from shared
 * cloud egress).
 *
 * With no provider configured (or on upstream failure) the route returns
 * the static SAMPLE feed flagged `sample: true`. CONSUMERS MUST NOT RENDER
 * SAMPLE STORIES — they're invented headlines wearing real outlets' names,
 * kept only so the payload shape stays exercised. The response shape is
 * ours — swap-proof against upstream field churn:
 *
 *   { sample: boolean, stories: [{ id, headline, url, publishedAt,
 *       sources: [{ name, domain }], imageUrl, summary, category, major }] }
 *
 * Stories come back RANKED (see lib/newsRank): near-duplicate headlines
 * from different outlets are clustered into one story carrying every
 * outlet, then scored by coverage + hard-news vocabulary + recency. The
 * top three are flagged `major` — the hero carousel shows those, the
 * ticker shows the rest, no overlap.
 */

/* 20 min: free tiers allow 100–200 requests/day and the upstream fetches
   below use Next's shared data cache (revalidate), so every serverless
   instance reuses one fetch — ~72 upstream calls/day max. */
import { rankStories } from "@/lib/newsRank";

const TTL_MS = 20 * 60_000;
const UPSTREAM_REVALIDATE_S = 20 * 60;
let cache: { at: number; body: NewsPayload } | null = null;

type Source = { name: string; domain: string };
type Story = { id: string; headline: string; url: string | null; publishedAt: string | null; sources: Source[]; imageUrl?: string | null; summary?: string | null; category?: string | null; major?: boolean };
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

/* NewsData title-cases source names ("The Bbc"); restore the real marks. */
const OUTLET_NAMES: Record<string, string> = {
  "the bbc": "BBC", "bbc": "BBC", "aljazeera": "Al Jazeera", "al jazeera": "Al Jazeera",
  "the guardian": "The Guardian", "reuters": "Reuters", "apnews": "AP", "ap news": "AP",
  "associated press": "AP",
};
function outletName(raw: string): string {
  return OUTLET_NAMES[raw.trim().toLowerCase()] ?? raw;
}

/* newsdata.io /api/1/latest → our Story shape. One outlet per story. */
function normalizeNewsData(json: unknown): Story[] {
  const rows = (json as { results?: unknown })?.results;
  if (!Array.isArray(rows)) return [];
  const seen = new Set<string>();
  return rows.slice(0, 20).flatMap((raw): Story[] => {
    const r = raw as Record<string, unknown>;
    const headline = r.title as string | undefined;
    const url = (r.link as string | undefined) ?? null;
    if (!headline || !url || seen.has(headline)) return [];
    seen.add(headline);
    const name = outletName((r.source_name as string | undefined) ?? (r.source_id as string | undefined) ?? "");
    let domain = "";
    try { domain = new URL(url).hostname.replace(/^www\./, ""); } catch { /* bad url */ }
    const img = r.image_url as string | undefined;
    return [{
      id: String(r.article_id ?? url),
      headline,
      url,
      publishedAt: (r.pubDate as string | undefined) ?? null,
      sources: name ? [{ name, domain }] : [],
      imageUrl: upgradeImage(img && /^https:\/\//.test(img) ? img : null),
      summary: clip(r.description as string | undefined),
      category: Array.isArray(r.category) ? (r.category[0] as string | undefined) ?? null : null,
    }];
  });
}

/** Outlet image CDNs encode the size in the URL; ask for a hero-grade
    variant where that's safe (BBC "standard/240" is a thumbnail and any
    width works; signed CDNs must be left untouched). */
function upgradeImage(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.hostname === "ichef.bbci.co.uk") {
      // 2048 keeps the ~900-CSS-px hero sharp on 2x displays (iChef
      // serves standard/{...2048,2560}; 2048 ≈ 170KB).
      u.pathname = u.pathname.replace(/\/standard\/\d+\//, "/standard/2048/");
      return u.toString();
    }
    // Guardian (i.guim.co.uk) URLs are signed (&s=…) — any parameter
    // change invalidates them, and they already arrive at width=1200.
    return url;
  } catch {
    return url;
  }
}

/** Teaser text: one clean sentence-ish, ≤220 chars. */
function clip(text: string | undefined): string | null {
  if (!text) return null;
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return null;
  return t.length > 220 ? t.slice(0, 217).replace(/\s+\S*$/, "") + "…" : t;
}

/* gnews.io v4 top-headlines → our Story shape. One outlet per story. */
function normalizeGNews(json: unknown): Story[] {
  const rows = (json as { articles?: unknown[] })?.articles ?? [];
  if (!Array.isArray(rows)) return [];
  return rows.slice(0, 20).flatMap((raw): Story[] => {
    const r = raw as Record<string, unknown>;
    const headline = r.title as string | undefined;
    const url = (r.url as string | undefined) ?? null;
    if (!headline || !url) return [];
    const src = r.source as { name?: string; url?: string } | undefined;
    let domain = "";
    try { domain = src?.url ? new URL(src.url).hostname.replace(/^www\./, "") : new URL(url).hostname.replace(/^www\./, ""); } catch { /* bad url */ }
    const img = r.image as string | undefined;
    return [{
      id: url,
      headline,
      url,
      publishedAt: (r.publishedAt as string | undefined) ?? null,
      sources: src?.name ? [{ name: src.name, domain }] : [],
      imageUrl: img && /^https:\/\//.test(img) ? img : null,
      summary: clip(r.description as string | undefined),
      category: null,
    }];
  });
}

/* Placeholder feed when no provider is configured. Never rendered by
 * consumers (they check `sample`); exists to keep the contract exercised. */
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

  const newsdataKey = process.env.NEWSDATA_API_KEY;
  if (newsdataKey) {
    try {
      /* Global affairs, not a regional firehose: the world desk of a
         curated set of international outlets (NewsData's free tier allows
         five domains per request). No country filter on purpose. */
      const params = new URLSearchParams({
        apikey: newsdataKey,
        language: "en",
        category: "world",
        domain: "bbc,aljazeera,theguardian,reuters,apnews",
        removeduplicate: "1",
      });
      // Two pages (20 articles, 2 credits) give the ranker enough overlap
      // across outlets to cluster the big stories; still ~144 credits/day
      // at the 20-minute cadence, under the free tier's 200.
      const res = await fetch(`https://newsdata.io/api/1/latest?${params}`, {
        signal: AbortSignal.timeout(8000),
        next: { revalidate: UPSTREAM_REVALIDATE_S },
      });
      if (res.ok) {
        const first = await res.json();
        let articles = normalizeNewsData(first);
        const nextPage = (first as { nextPage?: string })?.nextPage;
        if (nextPage) {
          try {
            const res2 = await fetch(`https://newsdata.io/api/1/latest?${params}&page=${encodeURIComponent(nextPage)}`, {
              signal: AbortSignal.timeout(8000),
              next: { revalidate: UPSTREAM_REVALIDATE_S },
            });
            if (res2.ok) articles = articles.concat(normalizeNewsData(await res2.json()));
          } catch { /* one page is fine */ }
        }
        if (articles.length > 0) body = { sample: false, stories: rankStories(articles) };
      }
    } catch {
      /* upstream down → fall through (GNews, Particle, then sample) */
    }
  }

  const gnewsKey = process.env.GNEWS_API_KEY;
  if (gnewsKey && body.sample) {
    try {
      const res = await fetch(
        `https://gnews.io/api/v4/top-headlines?category=general&lang=en&country=us&max=10&apikey=${encodeURIComponent(gnewsKey)}`,
        { signal: AbortSignal.timeout(8000), next: { revalidate: UPSTREAM_REVALIDATE_S } }
      );
      if (res.ok) {
        const stories = normalizeGNews(await res.json());
        if (stories.length > 0) body = { sample: false, stories: rankStories(stories) };
      }
    } catch {
      /* upstream down → fall through (Particle, then sample) */
    }
  }

  if (key && body.sample) {
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const stories = normalizeParticle(await res.json());
        if (stories.length > 0) body = { sample: false, stories: rankStories(stories) };
      }
    } catch {
      /* upstream down → sample feed keeps the ticker alive */
    }
  }

  cache = { at: Date.now(), body };
  return Response.json(body);
}
