import type { Metadata, Viewport } from 'next';
import { Fraunces, Inter } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/lib/auth';
import { ToastProvider } from '@/components/ui/Toast';
import { BrandDefs } from '@/components/Logo';
import { JsonLd } from '@/components/seo/JsonLd';
import { SEO_KEYWORDS, SEO_TITLE, softwareJsonLd } from '@/lib/seo';
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from '@/lib/site';
import { API_ORIGIN_FOR_HINTS } from '@/lib/api';

/**
 * Both faces are self-hosted by next/font at build time: no runtime request to
 * Google, no render-blocking stylesheet, and the metrics below are used to
 * generate a matched fallback so swapping in the real face shifts nothing.
 */
const sans = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sans',
  adjustFontFallback: true
});

/**
 * Display serif for headings, question prompts and the wordmark. The variable
 * build carries optical sizing, so the same file stays crisp at 18px and
 * elegant at 64px; the SOFT/WONK axes are pinned in globals.css.
 */
const display = Fraunces({
  subsets: ['latin'],
  style: ['normal', 'italic'],
  axes: ['opsz', 'SOFT', 'WONK'],
  display: 'swap',
  variable: '--font-display'
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: SEO_TITLE,
    template: `%s · ${SITE_NAME}`
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  category: 'education',
  keywords: SEO_KEYWORDS,
  authors: [{ name: SITE_NAME, url: SITE_URL }],
  creator: SITE_NAME,
  publisher: SITE_NAME,
  alternates: { canonical: '/' },
  openGraph: {
    title: SEO_TITLE,
    description: SITE_DESCRIPTION,
    siteName: SITE_NAME,
    type: 'website',
    locale: 'en_IN',
    url: '/'
  },
  twitter: {
    card: 'summary_large_image',
    title: SEO_TITLE,
    description: SITE_DESCRIPTION
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large', 'max-snippet': -1 }
  }
};

export const viewport: Viewport = {
  themeColor: '#060A14',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN" className={`${sans.variable} ${display.variable}`} suppressHydrationWarning>
      <head>
        {/* The API lives on its own host: open the connection (DNS + TLS) while the page loads. */}
        {API_ORIGIN_FOR_HINTS && <link rel="preconnect" href={API_ORIGIN_FOR_HINTS} crossOrigin="anonymous" />}
        {API_ORIGIN_FOR_HINTS && <link rel="dns-prefetch" href={API_ORIGIN_FOR_HINTS} />}
        <JsonLd data={softwareJsonLd()} />
      </head>
      <body className="min-h-screen bg-ink-950 font-sans antialiased">
        {/* Shared SVG gradients for the logo and seal, defined once per page. */}
        <BrandDefs />
        {/* First tab stop on every page — keyboard users skip the nav. */}
        <a href="#main" className="skip-link">
          Skip to main content
        </a>
        <ToastProvider>
          <AuthProvider>{children}</AuthProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
