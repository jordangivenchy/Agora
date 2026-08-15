import { NextResponse } from "next/server";
import { createAdminClient, hasAdminCredentials } from "@/lib/supabase-admin";
import { normalizeBatch, type ScrapedKind } from "@/lib/apify/normalize";

/* Apify → Supabase ingestion. Called by an Apify actor's webhook on
   ACTOR.RUN.SUCCEEDED (Apify Console → actor → Integrations → Webhook), so
   scraping is fully asynchronous — no user request ever waits on a scrape.

   Configure the webhook payload template to include the dataset id:
     {
       "resource": {"defaultDatasetId": "..."},
       "eventData": {"actorId": "..."},
       "source": "news-scraper",      ← free-form label, used for dedupe
       "kind": "news",                ← optional: news | web | profile
       "topicKey": "politics-law"     ← optional: pins topic for the whole run
     }
   and point it at:  https://<app>/api/webhook/apify?token=APIFY_WEBHOOK_SECRET

   Alternatively POST {"items": [...], "source": "..."} directly for testing
   or for push-style actors.

   Auth is a shared secret in the query string — Apify webhooks can't send
   custom headers on all plans. The service-role client bypasses RLS; that is
   the point (scraped_data has no client write policy at all). */

const APIFY_API = "https://api.apify.com/v2";
const UPSERT_CHUNK = 500;

export async function POST(req: Request) {
  const secret = process.env.APIFY_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "webhook_not_configured" }, { status: 503 });
  }
  const token = new URL(req.url).searchParams.get("token");
  if (token !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!hasAdminCredentials()) {
    return NextResponse.json({ error: "storage_not_configured" }, { status: 503 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const source = typeof body.source === "string" && body.source.trim()
    ? body.source.trim()
    : String((body.eventData as Record<string, unknown> | undefined)?.actorId ?? "apify");
  const kind = (["news", "web", "profile"] as const).includes(body.kind as ScrapedKind)
    ? (body.kind as ScrapedKind)
    : undefined;
  const topicKey = typeof body.topicKey === "string" ? body.topicKey : null;

  // Items either arrive inline or are fetched from the run's dataset.
  let items: unknown[] = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) {
    const datasetId = (body.resource as Record<string, unknown> | undefined)?.defaultDatasetId;
    if (typeof datasetId === "string" && datasetId) {
      const apifyToken = process.env.APIFY_TOKEN;
      if (!apifyToken) {
        return NextResponse.json({ error: "apify_token_missing" }, { status: 503 });
      }
      try {
        const res = await fetch(
          `${APIFY_API}/datasets/${datasetId}/items?clean=true&limit=5000`,
          { headers: { Authorization: `Bearer ${apifyToken}` } }
        );
        if (!res.ok) {
          console.error("[apify] dataset fetch failed:", res.status, await res.text().catch(() => ""));
          return NextResponse.json({ error: "dataset_fetch_failed" }, { status: 502 });
        }
        items = await res.json();
      } catch (err) {
        console.error("[apify] dataset fetch threw:", err);
        return NextResponse.json({ error: "dataset_fetch_failed" }, { status: 502 });
      }
    }
  }

  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ ok: true, upserted: 0, skipped: 0 });
  }

  const rows = normalizeBatch(items, { source, kind, topicKey });
  const skipped = items.length - rows.length;

  const admin = createAdminClient();
  let upserted = 0;
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK);
    const { error } = await admin
      .from("scraped_data")
      .upsert(chunk, { onConflict: "source,source_uid" });
    if (error) {
      console.error("[apify] upsert failed at chunk", i / UPSERT_CHUNK, error);
      return NextResponse.json(
        { error: "upsert_failed", upserted, skipped },
        { status: 500 }
      );
    }
    upserted += chunk.length;
  }

  return NextResponse.json({ ok: true, upserted, skipped });
}
