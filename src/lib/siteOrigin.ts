/* Where this deployment answers. Vercel gives the deployment's own host;
   production overrides it so a preview build can't hand a crawler
   preview URLs. */
export function siteOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_ORIGIN;
  if (configured) return configured.replace(/\/+$/, "");
  const vercel = process.env.VERCEL_ENV === "production" ? process.env.VERCEL_PROJECT_PRODUCTION_URL : process.env.VERCEL_URL;
  return vercel ? `https://${vercel}` : "https://agorasphere.net";
}
