import { describe, it, expect } from "vitest";
import { normalizeItem, normalizeBatch } from "./normalize";

const ctx = { source: "test-actor" };

describe("normalizeItem", () => {
  it("maps a typical news item", () => {
    const row = normalizeItem(
      {
        headline: "Carbon tax cuts emissions 12%",
        text: "A new study finds...",
        url: "https://example.com/a",
        publishedAt: "2026-08-01T10:00:00Z",
        tags: ["Economics", "climate"],
      },
      { ...ctx, kind: "news" }
    );
    expect(row).not.toBeNull();
    expect(row!.kind).toBe("news");
    expect(row!.title).toBe("Carbon tax cuts emissions 12%");
    expect(row!.body).toBe("A new study finds...");
    expect(row!.source_uid).toBe("https://example.com/a");
    expect(row!.published_at).toBe("2026-08-01T10:00:00.000Z");
    expect(row!.tags).toEqual(["economics", "climate"]);
  });

  it("rejects items without any title", () => {
    expect(normalizeItem({ text: "body only" }, ctx)).toBeNull();
    expect(normalizeItem(null, ctx)).toBeNull();
    expect(normalizeItem("string", ctx)).toBeNull();
  });

  it("infers profile kind from debater fields", () => {
    const row = normalizeItem({ name: "Jane Doe", debaterName: "Jane Doe" }, ctx);
    expect(row!.kind).toBe("profile");
  });

  it("defaults to web kind for generic content", () => {
    const row = normalizeItem({ title: "Some page", content: "..." }, ctx);
    expect(row!.kind).toBe("web");
  });

  it("only accepts known topic keys", () => {
    const good = normalizeItem({ title: "x", topic: "economics" }, ctx);
    const bad = normalizeItem({ title: "x", topic: "astrology" }, ctx);
    expect(good!.topic_key).toBe("economics");
    expect(bad!.topic_key).toBeNull();
  });

  it("context topicKey wins over item topic", () => {
    const row = normalizeItem({ title: "x", topic: "sports" }, { ...ctx, topicKey: "ethics" });
    expect(row!.topic_key).toBe("ethics");
  });

  it("derives a stable uid from the title when there is no url or id", () => {
    const a = normalizeItem({ title: "Same headline" }, ctx);
    const b = normalizeItem({ title: "Same headline" }, ctx);
    const c = normalizeItem({ title: "Different headline" }, ctx);
    expect(a!.source_uid).toBe(b!.source_uid);
    expect(a!.source_uid).not.toBe(c!.source_uid);
  });

  it("preserves the raw item in payload", () => {
    const item = { title: "x", customField: { nested: true } };
    const row = normalizeItem(item, ctx);
    expect(row!.payload).toEqual(item);
  });
});

describe("normalizeBatch", () => {
  it("dedupes rows sharing a source_uid so one upsert never conflicts with itself", () => {
    const rows = normalizeBatch(
      [
        { title: "old version", url: "https://example.com/a" },
        { title: "new version", url: "https://example.com/a" },
        { title: "other", url: "https://example.com/b" },
      ],
      ctx
    );
    expect(rows).toHaveLength(2);
    // Last write wins.
    expect(rows.find((r) => r.source_uid === "https://example.com/a")!.title).toBe("new version");
  });

  it("drops unusable items without failing the batch", () => {
    const rows = normalizeBatch([{ title: "good" }, { noTitle: true }, null], ctx);
    expect(rows).toHaveLength(1);
  });
});
