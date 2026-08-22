import { describe, expect, it } from "vitest";
import { formatBookmarks, parseBookmarks, safeBookmarks } from "./communityBookmarks";

describe("parseBookmarks", () => {
  it("parses plain links and dropdown groups", () => {
    const out = parseBookmarks(`Discord | https://discord.gg/agora
## Social Links
X | x.com/agora
Instagram | https://instagram.com/agora
## Music Links
Spotify | https://open.spotify.com/agora`);
    expect(out).toEqual([
      { label: "Discord", url: "https://discord.gg/agora" },
      { label: "Social Links", items: [
        { label: "X", url: "https://x.com/agora" },
        { label: "Instagram", url: "https://instagram.com/agora" },
      ] },
      { label: "Music Links", items: [{ label: "Spotify", url: "https://open.spotify.com/agora" }] },
    ]);
  });
  it("drops invalid lines, unsafe schemes, and empty groups", () => {
    const out = parseBookmarks(`just text
Bad | javascript:alert(1)
Good | https://example.com
## Empty Group`);
    expect(out).toEqual([{ label: "Good", url: "https://example.com" }]);
  });
  it("round-trips through formatBookmarks", () => {
    const text = `Discord | https://discord.gg/agora\n## Social Links\nX | https://x.com/agora`;
    expect(formatBookmarks(parseBookmarks(text))).toBe(text);
  });
});

describe("safeBookmarks", () => {
  it("filters hostile jsonb", () => {
    expect(safeBookmarks([{ label: "ok", url: "https://a.com" }, { label: "x", url: "javascript:1" }, 5, { label: "g", items: [{ label: "i", url: "http://b.com" }, {}] }]))
      .toEqual([{ label: "ok", url: "https://a.com" }, { label: "g", items: [{ label: "i", url: "http://b.com" }] }]);
  });
});
