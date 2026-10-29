import type { MetadataRoute } from 'next';
import { SITE_DESCRIPTION, SITE_NAME } from '@/lib/site';

/**
 * Name, colours and icons for "Add to home screen". `display: 'browser'`
 * keeps the normal browser window, so sign-in pop-ups and links behave
 * exactly as they do on the website.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${SITE_NAME} · Live assessment`,
    short_name: SITE_NAME,
    description: SITE_DESCRIPTION,
    lang: 'en-IN',
    start_url: '/',
    scope: '/',
    display: 'browser',
    background_color: '#060A14',
    theme_color: '#060A14',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
    ]
  };
}
