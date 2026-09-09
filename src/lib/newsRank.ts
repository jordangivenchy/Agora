/**
 * News ranking: turn a flat list of single-outlet articles into stories
 * ranked by "majorness", so the hero carousel can take the biggest ones
 * and the ticker the rest. Pure — the /api/news route owns the I/O.
 *
 * Signals, strongest first:
 *   1. coverage — near-duplicate headlines from different outlets are
 *      clustered into one story; more outlets = bigger story
 *   2. headline vocabulary: hard news (conflict, disasters, elections,
 *      economy shocks…) and, because the feed seeds debates, contested
 *      ground (policy, rights, tech, culture, question-shaped headlines)
 *   3. recency
 * Minus: rolling live blogs, accidents / crime / verdicts (news, not an
 * argument) and commerce (deals, product roundups). After ranking, one
 * outlet can hold at most a few slots, so a single paper's regional desk
 * can't fill the ticker.
 */

export interface RankSource { name: string; domain: string }
export interface RankArticle {
  id: string;
  headline: string;
  url: string | null;
  publishedAt: string | null;
  sources: RankSource[];
  imageUrl?: string | null;
  summary?: string | null;
  category?: string | null;
}
export interface RankedStory extends RankArticle {
  score: number;
  major: boolean;
}

const STOP = new Set([
  "the", "a", "an", "of", "to", "in", "on", "at", "for", "and", "or", "as", "by", "is",
  "are", "was", "were", "be", "it", "its", "with", "from", "that", "this", "after",
  "over", "into", "amid", "says", "say", "said", "will", "has", "have", "had", "new",
  "live", "updates", "update", "news", "how", "why", "what", "who", "about",
]);

/* Tiered: geopolitics / disasters / macro shocks count double; crime and
   court vocabulary single — a local arrest is news, not a hero story. */
const HARD_NEWS_2 = [
  "war", "missile", "ceasefire", "invasion", "troops", "nuclear", "coup", "sanctions",
  "election", "president", "prime minister", "parliament", "summit", "treaty", "nato",
  "earthquake", "flood", "wildfire", "hurricane", "typhoon", "outbreak", "pandemic",
  "evacuat", "recession", "inflation", "central bank", "tariff", "hostage", "strikes",
];
const HARD_NEWS_1 = [
  "killed", "dead", "death", "attack", "strike", "protest", "crash", "explosion",
  "court", "verdict", "arrested", "indicted", "emergency", "rates", "un ",
];

export function titleTokens(headline: string): Set<string> {
  return new Set(
    headline
      .toLowerCase()
      .replace(/[’'"“”]/g, "")
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2 && !STOP.has(w))
  );
}

export function similarity(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / Math.min(a.size, b.size); // overlap coefficient: robust to length differences
}

/** Merge near-duplicate articles into one story, unioning their outlets. */
export function clusterStories(articles: RankArticle[], threshold = 0.5): RankArticle[] {
  const clusters: { story: RankArticle; tokens: Set<string> }[] = [];
  for (const art of articles) {
    const tokens = titleTokens(art.headline);
    const hit = clusters.find((c) => similarity(c.tokens, tokens) >= threshold);
    if (hit) {
      const seen = new Set(hit.story.sources.map((s) => s.name.toLowerCase()));
      for (const s of art.sources) {
        if (!seen.has(s.name.toLowerCase())) { hit.story.sources.push(s); seen.add(s.name.toLowerCase()); }
      }
      // keep the earliest-published headline as the canonical one
      if (art.publishedAt && hit.story.publishedAt && art.publishedAt < hit.story.publishedAt) {
        hit.story.publishedAt = art.publishedAt;
      }
      if (!hit.story.imageUrl && art.imageUrl) hit.story.imageUrl = art.imageUrl;
      if (!hit.story.summary && art.summary) hit.story.summary = art.summary;
      if (!hit.story.category && art.category) hit.story.category = art.category;
      for (const w of tokens) hit.tokens.add(w);
    } else {
      clusters.push({ story: { ...art, sources: [...art.sources] }, tokens });
    }
  }
  return clusters.map((c) => c.story);
}

/* Contested ground — what people can actually take sides on. Weighted
   like the tier-2 hard news; the two are capped together. */
const DEBATE = [
  "should", " ban", "rights", "abortion", "immigra", "migrant", "gun ", "guns", "climate",
  " ai ", "artificial intelligence", "free speech", "censor", "privacy", "tax", "healthcare",
  "health care", "wage", "housing", "rent ", "education", "school", "universit", "religio",
  "gender", "trans ", "racis", "regulat", "supreme court", "ruling", " law", "policy",
  "trade war", "trump", "democrat", "republican", "labour", "tory", "tories", "far-right",
  "far right", "populis", "union", "boycott", "ethic", "moral", "surveillance",
  "misinformation", "social media", "tiktok", "big tech", "monopol", "antitrust", "settlement",
];
/* Accidents, crime and court outcomes: news, but nothing to argue. */
const NOISE = [
  "crash", "recovered", "killed", " dead", "dies", "died", "verdict", "arrested", "sentenced",
  "found guilty", "plea deal", "murder", "stabbing", "shooting", "earthquake", "flood",
  "wildfire", "hurricane", "typhoon", "collision", "derail", "missing",
];
/* Commerce and listicles: keep them out of the hero entirely. */
const COMMERCE = [
  "best ", "deals", "products", "first look", "review:", "we tested", "our editors", "gift guide",
  "% off", " sale", "buy ", "cyber monday", "black friday", "prime day", "coupon", "headphones",
];

export function debateScore(headline: string): number {
  const h = ` ${headline.toLowerCase()} `;
  const kw = DEBATE.reduce((n, w) => (h.includes(w) ? n + 2 : n), 0);
  return kw + (/\?\s*$/.test(headline) ? 2 : 0);
}

export function noiseScore(headline: string): number {
  const h = ` ${headline.toLowerCase()} `;
  return (NOISE.some((w) => h.includes(w)) ? 1.5 : 0) + (COMMERCE.some((w) => h.includes(w)) ? 3 : 0);
}

/** newsdata.io hands back "YYYY-MM-DD HH:MM:SS" in UTC with no zone; make
    it unambiguous ISO so it parses the same on every machine. Other
    shapes pass through. */
export function toUtcIso(s: string | null | undefined): string | null {
  if (!s) return null;
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/.exec(s.trim());
  return m ? `${m[1]}T${m[2]}Z` : s;
}

export function hardNewsScore(headline: string): number {
  const h = ` ${headline.toLowerCase()} `;
  return (
    HARD_NEWS_2.reduce((n, kw) => (h.includes(kw) ? n + 2 : n), 0) +
    HARD_NEWS_1.reduce((n, kw) => (h.includes(kw) ? n + 1 : n), 0)
  );
}

/** Rank clustered stories; the top `majorCount` are flagged `major`. */
export function rankStories(
  articles: RankArticle[],
  opts: { majorCount?: number; now?: number; perOutletCap?: number } = {}
): RankedStory[] {
  const { majorCount = 3, now = Date.now(), perOutletCap = 4 } = opts;
  const scored = clusterStories(articles).map((s) => {
    const ageH = s.publishedAt ? Math.max(0, (now - Date.parse(s.publishedAt)) / 3_600_000) : 24;
    const recency = Number.isFinite(ageH) ? Math.max(0, 1 - ageH / 48) : 0; // 1 → fresh, 0 → 2 days old
    // Rolling live blogs ("… – US politics live", "live updates") are feeds,
    // not stories — keep them out of the hero.
    const liveBlog = /(\blive\s*(updates?|blog)?\s*$)|(\blive updates\b)/i.test(s.headline) ? 2.5 : 0;
    // Coverage stays the strongest signal: a second outlet is worth more
    // than any amount of vocabulary (which is capped at 5 in total).
    const coverage = 3 + 6 * (s.sources.length - 1);
    const words = Math.min(5, hardNewsScore(s.headline) + debateScore(s.headline));
    const score = coverage + words + recency - liveBlog - noiseScore(s.headline);
    return { ...s, score, major: false };
  });
  scored.sort((a, b) => b.score - a.score);
  // One outlet can hold only so many slots: a paper's regional desk
  // shouldn't be the whole ticker. Multi-outlet stories count for their
  // first (earliest) outlet.
  const perOutlet = new Map<string, number>();
  const kept = scored.filter((s) => {
    const key = (s.sources[0]?.name ?? "").toLowerCase();
    const n = perOutlet.get(key) ?? 0;
    if (n >= perOutletCap) return false;
    perOutlet.set(key, n + 1);
    return true;
  });
  return kept.map((s, i) => ({ ...s, major: i < majorCount }));
}
