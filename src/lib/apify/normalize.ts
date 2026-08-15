/**
 * Apify actor payloads → scraped_data rows. Pure, so the shape of every actor
 * we support is testable without a network call or a database.
 *
 * Apify actors return wildly different item shapes, and the same actor changes
 * its output between versions. Rather than one strict schema, each item is
 * coerced to the shared searchable columns (title/body/url/topic) with
 * everything else preserved verbatim in `payload`, so nothing is lost and a new
 * actor never requires a migration.
 */

export type ScrapedKind = "news" | "web" | "profile";

export interface ScrapedRow {
  kind: ScrapedKind;
  source: string;
  source_uid: string;
  url: string | null;
  title: string;
  body: string | null;
  topic_key: string | null;
  tags: string[];
  payload: Record<string, unknown>;
  published_at: string | null;
}

/** Topic keys from src/types/database.ts. Kept as a plain list so this module
    stays dependency-free and trivially testable. */
const VALID_TOPICS = new Set([
  "politics-law",
  "ethics",
  "sports",
  "culture",
  "economics",
  "science-tech",
  "foreign-policy",
  "philosophy",
]);

const MAX_TITLE = 500;
const MAX_BODY = 20_000;

function firstString(item: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function toIsoOrNull(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Stable id for an item that carries no explicit one. Uses the URL when
    present (the natural key for scraped content), else a hash of the title so
    re-runs of the same actor don't duplicate rows. */
function deriveUid(item: Record<string, unknown>, title: string): string {
  const explicit = firstString(item, ["id", "guid", "uid", "objectId", "slug"]);
  if (explicit) return explicit;

  const url = firstString(item, ["url", "link", "webUrl", "sourceUrl"]);
  if (url) return url.slice(0, 400);

  // djb2 — good enough to dedupe titles, and deterministic across runs.
  let hash = 5381;
  for (let i = 0; i < title.length; i++) {
    hash = ((hash << 5) + hash + title.charCodeAt(i)) | 0;
  }
  return `title:${(hash >>> 0).toString(36)}`;
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 20);
}

/** Infers the kind when the webhook doesn't declare one, based on which fields
    the actor actually produced. */
function inferKind(item: Record<string, unknown>): ScrapedKind {
  if (firstString(item, ["debaterName", "speakerName", "tournament", "competitorId"])) {
    return "profile";
  }
  if (firstString(item, ["headline", "publishedAt", "publication", "byline"])) {
    return "news";
  }
  return "web";
}

/**
 * Normalizes one Apify dataset item. Returns null when the item has no usable
 * title — an untitled row would be invisible to search and pointless to store.
 */
export function normalizeItem(
  item: unknown,
  context: { source: string; kind?: ScrapedKind; topicKey?: string | null }
): ScrapedRow | null {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const record = item as Record<string, unknown>;

  const title = firstString(record, ["title", "headline", "name", "debaterName", "question"]);
  if (!title) return null;

  const body = firstString(record, [
    "text",
    "body",
    "content",
    "description",
    "summary",
    "excerpt",
    "markdown",
  ]);

  const topicCandidate =
    context.topicKey ?? firstString(record, ["topicKey", "topic_key", "topic", "category"]);

  return {
    kind: context.kind ?? inferKind(record),
    source: context.source,
    source_uid: deriveUid(record, title),
    url: firstString(record, ["url", "link", "webUrl", "sourceUrl"]),
    title: title.slice(0, MAX_TITLE),
    body: body ? body.slice(0, MAX_BODY) : null,
    topic_key:
      topicCandidate && VALID_TOPICS.has(topicCandidate) ? topicCandidate : null,
    tags: normalizeTags(record.tags ?? record.keywords ?? record.categories),
    payload: record,
    published_at: toIsoOrNull(
      record.publishedAt ?? record.published_at ?? record.date ?? record.pubDate
    ),
  };
}

/**
 * Normalizes a whole actor run and drops duplicates within the batch, so a
 * single upsert never contains two rows with the same conflict key — Postgres
 * rejects that outright ("cannot affect row a second time").
 */
export function normalizeBatch(
  items: unknown[],
  context: { source: string; kind?: ScrapedKind; topicKey?: string | null }
): ScrapedRow[] {
  const bySourceUid = new Map<string, ScrapedRow>();

  for (const item of items) {
    const row = normalizeItem(item, context);
    if (!row) continue;
    // Last write wins: later items in a run are the fresher scrape.
    bySourceUid.set(row.source_uid, row);
  }

  return [...bySourceUid.values()];
}
