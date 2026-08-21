import { describe, it, expect } from "vitest";
import { normalizeSocialLink, socialLinkLabel, MAX_SOCIAL_LINKS } from "./socialLinks";

describe("normalizeSocialLink", () => {
  it("keeps a valid https URL as-is", () => {
    expect(normalizeSocialLink("https://instagram.com/foo")).toBe("https://instagram.com/foo");
  });

  it("adds https:// to a bare domain", () => {
    expect(normalizeSocialLink("instagram.com/foo")).toBe("https://instagram.com/foo");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeSocialLink("  x.com/jordan  ")).toBe("https://x.com/jordan");
  });

  it("allows plain http", () => {
    expect(normalizeSocialLink("http://example.com")).toBe("http://example.com");
  });

  it("rejects empty and whitespace-only input", () => {
    expect(normalizeSocialLink("")).toBeNull();
    expect(normalizeSocialLink("   ")).toBeNull();
  });

  it("rejects javascript: URLs", () => {
    expect(normalizeSocialLink("javascript:alert(1)")).toBeNull();
  });

  it("rejects other non-http schemes", () => {
    expect(normalizeSocialLink("ftp://example.com/file")).toBeNull();
  });

  it("rejects links over 200 characters", () => {
    const long = "https://example.com/" + "a".repeat(200);
    expect(normalizeSocialLink(long)).toBeNull();
  });

  it("accepts a link at exactly 200 characters", () => {
    const base = "https://example.com/";
    const exact = base + "a".repeat(200 - base.length);
    expect(exact.length).toBe(200);
    expect(normalizeSocialLink(exact)).toBe(exact);
  });

  it("rejects text that is not a domain", () => {
    expect(normalizeSocialLink("not a url")).toBeNull();
  });
});

describe("socialLinkLabel", () => {
  it("labels x.com and twitter.com as X", () => {
    expect(socialLinkLabel("https://x.com/jordan")).toBe("X");
    expect(socialLinkLabel("https://twitter.com/jordan")).toBe("X");
  });

  it("labels the known platforms", () => {
    expect(socialLinkLabel("https://instagram.com/foo")).toBe("Instagram");
    expect(socialLinkLabel("https://www.youtube.com/@foo")).toBe("YouTube");
    expect(socialLinkLabel("https://tiktok.com/@foo")).toBe("TikTok");
    expect(socialLinkLabel("https://twitch.tv/foo")).toBe("Twitch");
    expect(socialLinkLabel("https://github.com/foo")).toBe("GitHub");
    expect(socialLinkLabel("https://discord.gg/abc")).toBe("Discord");
    expect(socialLinkLabel("https://linkedin.com/in/foo")).toBe("LinkedIn");
  });

  it("strips www. from unknown hostnames", () => {
    expect(socialLinkLabel("https://www.example.com/page")).toBe("example.com");
  });

  it("falls back to the bare hostname", () => {
    expect(socialLinkLabel("https://blog.jordan.dev/post")).toBe("blog.jordan.dev");
  });
});

describe("MAX_SOCIAL_LINKS", () => {
  it("is 5", () => {
    expect(MAX_SOCIAL_LINKS).toBe(5);
  });
});
