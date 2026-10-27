'use client';

import { Users, Zap } from 'lucide-react';
import { LinkButton } from '@/components/ui/Button';
import { useAuth } from '@/lib/auth';

/**
 * Hero call-to-action pair. Needs the client only to send an already-signed-in
 * visitor straight to their own console instead of back through the login page.
 */
export function HeroActions() {
  const { user } = useAuth();
  const primaryHref = user ? (user.role === 'admin' ? '/admin' : '/student') : '/login';

  return (
    <div className="mt-8 flex flex-wrap items-center gap-3">
      <LinkButton href={primaryHref} size="lg" variant="lime">
        <Zap className="h-4 w-4" />
        Open the live console
      </LinkButton>
      <LinkButton href="/student" size="lg" variant="secondary">
        <Users className="h-4 w-4" />
        Join as a student
      </LinkButton>
    </div>
  );
}
