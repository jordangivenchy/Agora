/**
 * News ranking: turn a flat list of single-outlet articles into stories
 * ranked by "majorness", so the hero carousel can take the biggest ones
 * and the ticker the rest. Pure — the /api/news route owns the I/O.
 *
 * Signals, strongest first:
 *   1. coverage — near-duplicate headlines from different outlets are
 *      clustered into one story; more outlets = bigger story
 *   2. hard-news vocabulary in the headline (conflict, disasters,
 *      elections, economy shocks…)
 *   3. recency
 */

export interface RankSource { name: string; domain: string }
export interface RankArticle {
  id: string;
  headline: string;
  url: string | null;
  publishedAt: string | null;
  sources: RankSource[];
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
      for (const w of tokens) hit.tokens.add(w);
    } else {
      clusters.push({ story: { ...art, sources: [...art.sources] }, tokens });
    }
  }
  return clusters.map((c) => c.story);
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
  opts: { majorCount?: number; now?: number } = {}
): RankedStory[] {
  const { majorCount = 3, now = Date.now() } = opts;
  const scored = clusterStories(articles).map((s) => {
    const ageH = s.publishedAt ? Math.max(0, (now - Date.parse(s.publishedAt)) / 3_600_000) : 24;
    const recency = Number.isFinite(ageH) ? Math.max(0, 1 - ageH / 48) : 0; // 1 → fresh, 0 → 2 days old
    const score = s.sources.length * 3 + Math.min(4, hardNewsScore(s.headline)) + recency;
    return { ...s, score, major: false };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.map((s, i) => ({ ...s, major: i < majorCount }));
}
