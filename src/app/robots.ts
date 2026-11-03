import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site';

/** Public pages are indexable; signed-in areas and one-time reset links are not. */
export default function robots(): MetadataRoute.Robots {
  const blocked = ['/admin', '/student', '/hq', '/reset-password', '/api/'];
  return {
    rules: [
      { userAgent: '*', allow: '/', disallow: blocked },
      { userAgent: 'GPTBot', allow: '/', disallow: blocked },
      { userAgent: 'Google-Extended', allow: '/', disallow: blocked },
      { userAgent: 'ClaudeBot', allow: '/', disallow: blocked },
      { userAgent: 'PerplexityBot', allow: '/', disallow: blocked }
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL
  };
}
