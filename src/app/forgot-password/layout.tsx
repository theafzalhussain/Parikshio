import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Forgot password',
  description: 'Get a secure link to reset your Parikshio password.',
  alternates: { canonical: '/forgot-password' }
};

export default function ForgotPasswordLayout({ children }: { children: React.ReactNode }) {
  return children;
}
