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
  /* The phone app's web preview (mobile/, Metro on :8081) calls this
     server's API from another origin. Development only; phones have no
     origin and production answers agorasphere.net itself. */
  async headers() {
    if (process.env.NODE_ENV !== "development") return [];
    return [
      {
        source: "/api/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "http://localhost:8081" },
          { key: "Access-Control-Allow-Methods", value: "GET, POST, OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "content-type, authorization, x-agora-beta" },
        ],
      },
    ];
  },
};

export default nextConfig;
