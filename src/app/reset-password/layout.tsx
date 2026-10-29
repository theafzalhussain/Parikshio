import type { Metadata } from 'next';

/** Reset links carry a one-time token, so the page is kept out of search results. */
export const metadata: Metadata = {
  title: 'Choose a new password',
  robots: { index: false, follow: false }
};

export default function ResetPasswordLayout({ children }: { children: React.ReactNode }) {
  return children;
}
