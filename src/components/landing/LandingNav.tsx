'use client';

import { useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { BrandLink } from '@/components/Logo';
import { LinkButton } from '@/components/ui/Button';
import { useAuth } from '@/lib/auth';
import { cx } from '@/lib/api';

const links = [
  { href: '#how', label: 'How it works' },
  { href: '#features', label: 'Platform' },
  { href: '#analytics', label: 'Analytics' },
  { href: '#roles', label: 'Roles' }
];

/**
 * The only interactive part of the landing header: it reacts to scroll and to
 * whether somebody is already signed in. Keeping it in its own client island
 * lets the rest of the page render on the server with no hydration cost.
 */
export function LandingNav() {
  const { user, ready } = useAuth();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={cx(
        'sticky top-0 z-50 transition-all duration-300',
        scrolled ? 'border-b border-white/[0.07] bg-ink-950/80 backdrop-blur-xl' : 'border-b border-transparent'
      )}
    >
      <div className="mx-auto flex h-[68px] max-w-7xl items-center justify-between gap-4 px-5 sm:px-8">
        <div className="flex items-center gap-8">
          <BrandLink href="/" />
          <nav aria-label="Sections" className="hidden items-center gap-6 text-[13px] text-white/50 lg:flex">
            {links.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="focus-ring rounded-md px-1 py-0.5 transition hover:text-white"
              >
                {link.label}
              </a>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-2.5">
          <span className="hidden items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11.5px] text-white/45 sm:inline-flex">
            <span className="h-1.5 w-1.5 rounded-full bg-mint-400" />
            All systems nominal
          </span>
          {ready && user ? (
            <LinkButton href={user.role === 'admin' ? '/admin' : '/student'} size="sm" variant="lime">
              {user.role === 'admin' ? 'Console' : 'My exams'}
              <ArrowRight className="h-3.5 w-3.5" />
            </LinkButton>
          ) : (
            <>
              <LinkButton href="/login" size="sm" variant="ghost" className="hidden sm:inline-flex">
                Sign in
              </LinkButton>
              <LinkButton href="/signup" size="sm" variant="secondary" className="hidden sm:inline-flex">
                Create account
              </LinkButton>
              <LinkButton href="/login" size="sm" variant="lime">
                Launch live demo
                <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
              </LinkButton>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
