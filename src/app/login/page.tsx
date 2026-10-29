import type { Metadata } from 'next';
import { parseAuthRole, safeNext } from '@/lib/nextPath';
import { LoginClient } from './LoginClient';

export const metadata: Metadata = {
  title: 'Log in',
  description: 'Log in to Parikshio. Students join live exams with a code; faculty author, push and grade them.',
  alternates: { canonical: '/login' }
};

/**
 * The tab (`?role=faculty`) and the post-sign-in destination (`?next=`) are
 * read on the server so the right tab is in the first paint, with no flash.
 */
export default function LoginPage({
  searchParams
}: {
  searchParams: { [key: string]: string | string[] | undefined };
}) {
  return <LoginClient initialRole={parseAuthRole(searchParams.role)} next={safeNext(searchParams.next)} />;
}
