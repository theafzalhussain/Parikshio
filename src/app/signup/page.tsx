import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SignupClient, SignupFromQuery } from './SignupClient';

export const metadata: Metadata = {
  title: 'Create an account',
  description:
    'Create a Parikshio student account to join live exams, or request a faculty account for your institute.',
  alternates: { canonical: '/signup' }
};

/**
 * A static page, served from the CDN closest to the visitor. `?role=faculty`
 * and `?next=` are read in the browser; until then the student form is shown.
 */
export default function SignupPage() {
  return (
    <Suspense fallback={<SignupClient initialRole="student" next={null} />}>
      <SignupFromQuery />
    </Suspense>
  );
}
