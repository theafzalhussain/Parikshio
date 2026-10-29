import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site';

/** Public pages are indexable; signed-in areas and one-time reset links are not. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/admin', '/student', '/reset-password', '/api/'] }],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL
  };
}
