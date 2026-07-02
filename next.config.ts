import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the Turbopack workspace root to this project. Without this, Next.js
  // walks up and finds /Users/aryamangandhi/Personal/AgoraSphere/package.json
  // (a stray scratch file with playwright) and picks the parent dir as root,
  // which breaks module resolution (tailwindcss cannot be found) and causes
  // the infinite PostCSS warning loop.
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
