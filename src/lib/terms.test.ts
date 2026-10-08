// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { LEGAL } from "@/components/agora/legal";
import { acceptTerms, agreement, details, knownAgreed, needsNoAgreement, rememberAgreed, safeNext, saveMyPlace } from "./terms";

/* Whether a person has agreed to the terms in force. The database is a
   stand-in that answers what each test tells it to. */
const ANA = "11111111-1111-4111-8111-111111111111";
const BEN = "22222222-2222-4222-8222-222222222222";

function db(answer: { data?: unknown; error?: unknown; throws?: boolean }) {
  const asked: Record<string, unknown> = {};
  const chain = {
    select: () => chain,
    eq: (k: string, v: unknown) => { asked[k] = v; return chain; },
    maybeSingle: async () => {
      if (answer.throws) throw new Error("offline");
      return { data: answer.data ?? null, error: answer.error ?? null };
    },
  };
  return {
    asked,
    client: {
      from: () => chain,
      rpc: async (_fn: string, args: Record<string, unknown>) => {
        Object.assign(asked, args);
        if (answer.throws) throw new Error("offline");
        return { data: answer.data ?? null, error: answer.error ?? null };
      },
    } as never,
  };
}

beforeEach(() => localStorage.clear());

describe("what this browser remembers", () => {
  it("knows an account agreed once it has seen it, and only that account", () => {
    expect(knownAgreed(ANA)).toBe(false);
    rememberAgreed(ANA);
    expect(knownAgreed(ANA)).toBe(true);
    expect(knownAgreed(BEN)).toBe(false);
  });

  it("forgets when the terms change", () => {
    localStorage.setItem("agora:terms", JSON.stringify({ [ANA]: "2025-01-01" }));
    expect(knownAgreed(ANA)).toBe(false);
  });

  it("shrugs off a stored value that makes no sense", () => {
    localStorage.setItem("agora:terms", "not json");
    expect(knownAgreed(ANA)).toBe(false);
    rememberAgreed(ANA);
    expect(knownAgreed(ANA)).toBe(true);
  });
});

describe("what the server says", () => {
  it("is 'agreed', with when, for the version in force", async () => {
    const { client, asked } = db({ data: { accepted_at: "2026-10-07T22:10:00Z" } });
    expect(await agreement(client, ANA)).toEqual({ state: "agreed", at: "2026-10-07T22:10:00Z" });
    expect(asked).toEqual({ user_id: ANA, version: LEGAL.version });
  });

  it("is 'not' when there is no record", async () => {
    expect(await agreement(db({ data: null }).client, ANA)).toEqual({ state: "not" });
  });

  it("is 'unknown', never 'not', when the lookup fails", async () => {
    expect(await agreement(db({ error: { message: "relation does not exist" } }).client, ANA)).toEqual({ state: "unknown" });
    expect(await agreement(db({ throws: true }).client, ANA)).toEqual({ state: "unknown" });
  });
});

describe("what a person has told us about themselves", () => {
  it("is nothing yet for someone who has never been asked", async () => {
    const { client, asked } = db({ data: null });
    expect(await details(client, ANA)).toEqual({ state: "known", birthYear: null, country: null, region: null, checked: false, held: false });
    expect(asked).toEqual({ user_id: ANA });
  });

  it("is the year, the country and the state once their age has been checked", async () => {
    const row = { birth_year: 1998, country: "US", region: "US-CA", age_checked_at: "2026-10-07T22:10:00Z", under_age_at: null };
    expect(await details(db({ data: row }).client, ANA)).toEqual({ state: "known", birthYear: 1998, country: "US", region: "US-CA", checked: true, held: false });
  });

  it("is a hold when the date of birth they gave was under age", async () => {
    const row = { birth_year: null, country: null, region: null, age_checked_at: null, under_age_at: "2026-10-07T22:10:00Z" };
    expect(await details(db({ data: row }).client, ANA)).toMatchObject({ state: "known", checked: false, held: true });
  });

  it("is 'unknown' when the lookup fails", async () => {
    expect(await details(db({ error: { message: "relation does not exist" } }).client, ANA)).toEqual({ state: "unknown" });
    expect(await details(db({ throws: true }).client, ANA)).toEqual({ state: "unknown" });
  });
});

describe("agreeing", () => {
  const ok = { result: "ok", accepted_at: "2026-10-07T22:10:00Z" };

  it("sends the date of birth and the place with it the first time", async () => {
    const { client, asked } = db({ data: ok });
    expect(await acceptTerms(client, "ios", { birth: "1998-03-04", country: "US", region: "US-CA" })).toEqual({ state: "ok", at: "2026-10-07T22:10:00Z" });
    expect(asked).toEqual({ p_version: LEGAL.version, p_platform: "ios", p_birth: "1998-03-04", p_country: "US", p_region: "US-CA" });
  });

  it("sends only the version and where for someone we already know", async () => {
    const { client, asked } = db({ data: ok });
    expect(await acceptTerms(client)).toEqual({ state: "ok", at: "2026-10-07T22:10:00Z" });
    expect(asked).toEqual({ p_version: LEGAL.version, p_platform: "web" });
  });

  it("passes on a refusal for being under age", async () => {
    const about = { birth: "2012-03-04", country: "CA", region: null };
    expect(await acceptTerms(db({ data: { result: "under_age" } }).client, "web", about)).toEqual({ state: "under_age" });
  });

  it("says so when it couldn't be saved, or the answer makes no sense", async () => {
    expect(await acceptTerms(db({ error: { message: "nope" } }).client)).toEqual({ state: "failed" });
    expect(await acceptTerms(db({ throws: true }).client)).toEqual({ state: "failed" });
    expect(await acceptTerms(db({ data: "2026-10-07T22:10:00Z" }).client)).toEqual({ state: "failed" });
    expect(await acceptTerms(db({ data: { result: "ok" } }).client)).toEqual({ state: "failed" });
  });
});

describe("moving", () => {
  it("saves the new country and state", async () => {
    const { client, asked } = db({ data: null });
    expect(await saveMyPlace(client, "US", "US-NY")).toBe(true);
    expect(asked).toEqual({ p_country: "US", p_region: "US-NY" });
  });

  it("says so when it couldn't", async () => {
    expect(await saveMyPlace(db({ error: { message: "details_not_ready" } }).client, "CA", null)).toBe(false);
    expect(await saveMyPlace(db({ throws: true }).client, "CA", null)).toBe(false);
  });
});

describe("pages that never ask", () => {
  it("lets anyone read the documents, sign in, and sign out without agreeing", () => {
    for (const path of ["/agree", "/terms", "/privacy", "/login", "/auth/callback", "/beta", "/forgot-password", "/reset-password", "/app/open"]) {
      expect(needsNoAgreement(path)).toBe(true);
    }
  });

  it("asks everywhere else", () => {
    for (const path of ["/", "/settings", "/agora/90dabdf2-c208-46c9-8417-b5070fba44a0", "/replays/x", "/welcome", "/termsofuse", "/@jordan"]) {
      expect(needsNoAgreement(path)).toBe(false);
    }
  });
});

describe("where to go after agreeing", () => {
  it("goes back to where the person was", () => {
    expect(safeNext("/replays/abc?t=30")).toBe("/replays/abc?t=30");
    expect(safeNext("/settings")).toBe("/settings");
  });

  it("goes home rather than off the site, or back to a page that never asks", () => {
    expect(safeNext(null)).toBe("/");
    expect(safeNext("https://example.com")).toBe("/");
    expect(safeNext("//example.com")).toBe("/");
    expect(safeNext("/agree?next=/agree")).toBe("/");
    expect(safeNext("/login")).toBe("/");
  });
});
