import type { NextRequest } from "next/server";
import { getAppConfig } from "@/lib/appConfig";

const ORIGIN_FALLBACK = "https://agorasphere.net";

/* The origin Discord sends the visitor back to. It must match a redirect
   registered in the Developer Portal to the letter, so in production it
   is the site's own origin, not whatever host the request arrived on;
   on a developer's machine it is localhost. */
export async function doorOrigin(req: NextRequest): Promise<string> {
  const { hostname, origin } = req.nextUrl;
  if (hostname === "localhost" || hostname === "127.0.0.1") return origin;
  const cfg = await getAppConfig().catch(() => ({}) as Record<string, string>);
  return cfg.app_origin ?? ORIGIN_FALLBACK;
}

export function callbackUrl(origin: string): string {
  return `${origin}/api/discord/callback`;
}
