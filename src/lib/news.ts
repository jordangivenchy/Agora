/** True when a real news provider is configured (NewsData, GNews, or Particle) —
    surfaced by /api/health. Without one, /api/news serves a sample feed
    that consumers refuse to render. */
export function newsConfigured(): boolean {
  return Boolean(process.env.NEWSDATA_API_KEY || process.env.GNEWS_API_KEY || process.env.PARTICLE_API_KEY);
}
