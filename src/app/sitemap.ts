import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site';

const PAGES: { path: string; priority: number; changeFrequency: 'weekly' | 'monthly' | 'yearly' }[] = [
  { path: '', priority: 1, changeFrequency: 'weekly' },
  { path: '/signup', priority: 0.8, changeFrequency: 'monthly' },
  { path: '/login', priority: 0.7, changeFrequency: 'monthly' },
  { path: '/contact', priority: 0.6, changeFrequency: 'monthly' },
  { path: '/privacy', priority: 0.3, changeFrequency: 'yearly' },
  { path: '/terms', priority: 0.3, changeFrequency: 'yearly' }
];

export default function sitemap(): MetadataRoute.Sitemap {
  return PAGES.map((page) => ({
    url: `${SITE_URL}${page.path || '/'}`,
    changeFrequency: page.changeFrequency,
    priority: page.priority
  }));
}
