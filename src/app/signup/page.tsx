import type { Metadata } from 'next';
import { parseAuthRole, safeNext } from '@/lib/nextPath';
import { SignupClient } from './SignupClient';

export const metadata: Metadata = {
  title: 'Create an account',
  description:
    'Create a Parikshio student account to join live exams, or request a faculty account for your institute.',
  alternates: { canonical: '/signup' }
};

/** `?role=faculty` opens the faculty tab; `?next=` survives into sign-in. Read on the server for a flash-free first paint. */
export default function SignupPage({
  searchParams
}: {
  searchParams: { [key: string]: string | string[] | undefined };
}) {
  return <SignupClient initialRole={parseAuthRole(searchParams.role)} next={safeNext(searchParams.next)} />;
}
