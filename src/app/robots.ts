import type { MetadataRoute } from "next";
import { siteOrigin } from "@/lib/siteOrigin";

/* What a crawler may read. Everything a person can open without a beta
   key is fair game — the discussions, the archive, threads, communities,
   profiles — and nothing else: the parts behind the key would only serve
   a crawler the gate page, and the private ones shouldn't be offered at
   all. Kept in step with PUBLIC_READ in src/proxy.ts. */
export default function robots(): MetadataRoute.Robots {
  const origin = siteOrigin();
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/agora/", "/replays", "/replays/", "/clips/", "/posts/", "/communities", "/communities/", "/users/", "/news"],
      disallow: ["/api/", "/beta", "/login", "/welcome", "/auth", "/settings", "/messages", "/notifications", "/feed", "/search", "/mod", "/discord"],
    },
    sitemap: `${origin}/sitemap.xml`,
    host: origin,
  };
}
