import type { Metadata } from 'next';

/**
 * The owner console. Deliberately not linked from any page, the sitemap or
 * robots.txt; access is enforced by the server (see server/owner.ts), not by
 * the address being hard to guess.
 */
export const metadata: Metadata = {
  title: 'Owner console',
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
  referrer: 'no-referrer'
};

export default function OwnerLayout({ children }: { children: React.ReactNode }) {
  return children;
}
