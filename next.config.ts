import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Hide the floating Next.js dev-tools button (the "N" circle,
  // dev-only — production never had it) so dev matches what ships.
  devIndicators: false,
  // Pin the Turbopack workspace root to this project. Without this, Next.js
  // walks up and finds /Users/aryamangandhi/Personal/AgoraSphere/package.json
  // (a stray scratch file with playwright) and picks the parent dir as root,
  // which breaks module resolution (tailwindcss cannot be found) and causes
  // the infinite PostCSS warning loop.
  turbopack: {
    root: path.join(__dirname),
  },
  /* Shareable URLs for the homepage shell's sections. The browser keeps
     the pretty path; page.tsx reads window.location to open the section.
     Keep in step with REWRITTEN_SOURCES in src/lib/routes.ts. */
  async rewrites() {
    return [
      "/feed", "/people", "/trending", "/news", "/explore", "/communities", "/communities/:slug",
      "/posts/:id", "/messages", "/messages/:username", "/search",
    ].map((source) => ({ source, destination: "/" }));
  },
};

export default nextConfig;
