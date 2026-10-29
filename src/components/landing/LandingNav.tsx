'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, Menu, X } from 'lucide-react';
import { BrandLink } from '@/components/Logo';
import { LinkButton } from '@/components/ui/Button';
import { useAuth } from '@/lib/auth';
import { useDialog } from '@/lib/useDialog';
import { cx } from '@/lib/api';

/** Section links work from any page: on the home page they scroll, elsewhere they navigate home first. */
const links = [
  { href: '/#how', label: 'How it works' },
  { href: '/#modes', label: 'Exam modes' },
  { href: '/#features', label: 'Features' },
  { href: '/#faq', label: 'FAQ' },
  { href: '/contact', label: 'Contact' }
];

/** Sections below the fold skip rendering until they are near the viewport (`.defer-paint`). */
function scrollToSection(target: HTMLElement, hash: string) {
  const root = document.documentElement;
  // Render everything once so the scroll is measured against real heights,
  // not the estimated ones skipped sections stand in with.
  root.classList.add('render-all');
  window.requestAnimationFrame(() => {
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    window.history.replaceState(null, '', hash);
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    // The next Tab continues from where the reader landed.
    target.focus({ preventScroll: true });
    window.setTimeout(() => root.classList.remove('render-all'), 1500);
  });
}

/**
 * The site header: reacts to scroll and to whether somebody is logged in, and
 * owns the phone menu. Kept to two actions — Log in and Get started — so a
 * first-time visitor is never asked to choose between five buttons.
 */
export function LandingNav() {
  const { user, ready } = useAuth();
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  // Escape, focus trap, scroll lock and focus restore for the phone menu.
  const sheetRef = useDialog<HTMLDivElement>(open, close);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Every same-page link (nav, phone menu, hero chip, footer) goes through here.
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      const link = (event.target as Element | null)?.closest?.('a[href^="#"], a[href^="/#"]');
      const href = link?.getAttribute('href') ?? '';
      const hash = href.startsWith('/') ? href.slice(1) : href;
      if (hash.length < 2) return;
      // A "/#section" link from another page is an ordinary navigation home.
      if (href.startsWith('/') && window.location.pathname !== '/') return;
      const target = document.getElementById(hash.slice(1));
      if (!target) return;

      event.preventDefault();
      setOpen(false);
      // Give the phone menu a beat to release its scroll lock first.
      window.setTimeout(() => scrollToSection(target, hash), 60);
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  // Arriving from another page at "/#faq": land on the section, not short of it.
  useEffect(() => {
    if (window.location.pathname !== '/' || window.location.hash.length < 2) return;
    const target = document.getElementById(window.location.hash.slice(1));
    if (!target) return;
    const timer = window.setTimeout(() => scrollToSection(target, window.location.hash), 120);
    return () => window.clearTimeout(timer);
  }, []);

  const signedIn = ready && user;
  const consoleHref = user?.role === 'admin' ? '/admin' : '/student';
  const consoleLabel = user?.role === 'admin' ? 'Open console' : 'My exams';

  const navLink = (link: (typeof links)[number], className: string, children: React.ReactNode) =>
    link.href.startsWith('/#') ? (
      <a key={link.href} href={link.href} className={className}>
        {children}
      </a>
    ) : (
      <Link
        key={link.href}
        href={link.href}
        className={cx(className, pathname === link.href && 'text-white')}
        aria-current={pathname === link.href ? 'page' : undefined}
        onClick={close}
      >
        {children}
      </Link>
    );

  return (
    <>
      <header
        className={cx(
          'sticky top-0 z-50 transition-all duration-300',
          scrolled
            ? 'border-b border-white/[0.07] bg-ink-950/80 shadow-[0_10px_30px_-20px_rgba(0,0,0,0.9)] backdrop-blur-xl'
            : 'border-b border-transparent'
        )}
      >
        <div className="mx-auto flex h-[76px] max-w-7xl items-center justify-between gap-4 px-5 sm:px-8">
          <div className="flex items-center gap-10">
            <BrandLink href="/" />
            <nav aria-label="Main" className="hidden items-center gap-0.5 lg:flex">
              {links.map((link) =>
                navLink(
                  link,
                  'focus-ring whitespace-nowrap rounded-lg px-3 py-2 text-[14px] text-white/65 transition hover:bg-white/[0.04] hover:text-white',
                  link.label
                )
              )}
            </nav>
          </div>
          <div className="flex items-center gap-2">
            {signedIn ? (
              <LinkButton href={consoleHref} size="sm" variant="gold">
                {consoleLabel}
                <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
              </LinkButton>
            ) : (
              <>
                <LinkButton href="/login" size="sm" variant="ghost" className="hidden sm:inline-flex">
                  Log in
                </LinkButton>
                <LinkButton href="/signup" size="sm" variant="gold" className="hidden sm:inline-flex">
                  Get started
                  <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
                </LinkButton>
                {/* Phones: one clear action; everything else lives in the menu. */}
                <LinkButton href="/login" size="sm" variant="gold" className="sm:hidden">
                  Log in
                </LinkButton>
              </>
            )}
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="focus-ring grid h-9 w-9 place-items-center rounded-xl border border-white/10 bg-white/[0.03] text-white/75 transition hover:border-white/25 hover:text-white lg:hidden"
              aria-label="Open menu"
              aria-expanded={open}
            >
              <Menu className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      {/*
        Rendered outside <header>: the header's backdrop-filter would otherwise
        become the containing block and clip this fixed overlay to its height.
      */}
      {open && (
        <div className="fixed inset-0 z-[80] lg:hidden">
          <div className="absolute inset-0 animate-fadeIn bg-ink-950/80 backdrop-blur-sm" onClick={close} aria-hidden="true" />
          <div
            ref={sheetRef}
            role="dialog"
            aria-modal="true"
            aria-label="Site menu"
            className="gold-edge absolute inset-x-3 top-3 animate-popIn rounded-3xl border border-white/10 bg-ink-900 p-5 shadow-lift"
          >
            <div className="flex items-center justify-between">
              <BrandLink href="/" />
              <button
                type="button"
                onClick={close}
                className="focus-ring grid h-9 w-9 place-items-center rounded-xl text-white/65 transition hover:bg-white/[0.06] hover:text-white"
                aria-label="Close menu"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <nav aria-label="Main" className="mt-6 grid gap-1">
              {links.map((link) =>
                navLink(
                  link,
                  'focus-ring flex items-center justify-between rounded-xl px-3.5 py-3 text-[16px] text-white/85 transition hover:bg-white/[0.05]',
                  <>
                    {link.label}
                    <ArrowRight className="h-4 w-4 text-gold-200/60" />
                  </>
                )
              )}
            </nav>
            <div className="mt-5 grid gap-2 border-t border-white/[0.07] pt-5">
              {signedIn ? (
                <LinkButton href={consoleHref} variant="gold" size="lg" className="w-full">
                  {consoleLabel} <ArrowRight className="h-4 w-4" />
                </LinkButton>
              ) : (
                <>
                  <LinkButton href="/login" variant="gold" size="lg" className="w-full">
                    Log in <ArrowRight className="h-4 w-4" />
                  </LinkButton>
                  <LinkButton href="/signup" variant="secondary" size="lg" className="w-full">
                    Create a student account
                  </LinkButton>
                  <Link
                    href="/login?role=faculty"
                    onClick={close}
                    className="focus-ring mt-1 rounded-lg py-1.5 text-center text-[13.5px] text-white/60 transition hover:text-gold-200"
                  >
                    Faculty or admin? Log in here
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
