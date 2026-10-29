import type { Metadata, Viewport } from 'next';
import { Inter, Instrument_Serif } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/lib/auth';
import { ToastProvider } from '@/components/ui/Toast';

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

/** Used only for the italic accent words in headings. */
const display = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  style: ['italic', 'normal'],
  display: 'swap',
  variable: '--font-display'
});

export const metadata: Metadata = {
  metadataBase: new URL('https://www.parikshio.tech'),
  title: {
    default: 'Parikshio — Real-time assessment platform for institutes',
    template: '%s · Parikshio'
  },
  description:
    'Parikshio is a real-time educational assessment platform for institutes: create exams, engage students, grade answers and understand performance with live analytics.',
  applicationName: 'Parikshio',
  alternates: { canonical: '/' },
  openGraph: {
    title: 'Parikshio — Real-time assessment platform for institutes',
    description:
      'Create and deliver live assessments with synchronized timers, instant grading and actionable institute analytics.',
    siteName: 'Parikshio',
    url: 'https://www.parikshio.tech/',
    type: 'website'
  },
  twitter: { card: 'summary_large_image' }
};

export const viewport: Viewport = {
  themeColor: '#05060A',
  width: 'device-width',
  initialScale: 1,
  // Lets the dark UI paint behind the notch/status bar on mobile.
  viewportFit: 'cover'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${display.variable}`} suppressHydrationWarning>
      <body className="min-h-screen bg-ink-950 font-sans antialiased">
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
