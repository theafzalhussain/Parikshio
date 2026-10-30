import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoginClient, LoginFromQuery } from './LoginClient';

export const metadata: Metadata = {
  title: 'Log in',
  description: 'Log in to Parikshio. Students join live exams with a code; faculty author, push and grade them.',
  alternates: { canonical: '/login' }
};

/**
 * A static page, served from the CDN closest to the visitor. The tab
 * (`?role=faculty`) and the post-sign-in destination (`?next=`) are read in the
 * browser; until then the student tab (the common case) is shown.
 */
export default function LoginPage() {
  return (
    <Suspense fallback={<LoginClient initialRole="student" next={null} />}>
      <LoginFromQuery />
    </Suspense>
  );
}
