import Link from 'next/link';
import { ArrowUp, Mail, MessageSquareText } from 'lucide-react';
import { BrandLink } from '@/components/Logo';
import { MailLink } from './MailLink';
import { SocialLinks } from './SocialIcons';
import { SITE_DOMAIN, SITE_NAME } from '@/lib/site';

const columns: { title: string; links: [label: string, href: string][] }[] = [
  {
    title: 'Product',
    links: [
      ['About Parikshio', '/about'],
      ['How it works', '/#how'],
      ['Exam modes', '/#modes'],
      ['Features', '/#features'],
      ['FAQ', '/#faq']
    ]
  },
  {
    title: 'Get started',
    links: [
      ['Student log in', '/login'],
      ['Create a student account', '/signup'],
      ['Faculty log in', '/login?role=faculty'],
      ['For institutes', '/contact?topic=onboarding']
    ]
  },
  {
    title: 'Support',
    links: [
      ['Contact us', '/contact'],
      ['Share feedback', '/contact?topic=feedback'],
      ['Report a problem', '/contact?topic=problem'],
      ['Reset your password', '/forgot-password']
    ]
  },
  {
    title: 'Legal',
    links: [
      ['Privacy policy', '/privacy'],
      ['Terms of use', '/terms']
    ]
  }
];

const linkClass = 'focus-ring rounded-md text-[14px] text-white/60 transition hover:text-gold-200';

/**
 * Same-page section links are plain anchors: the landing nav intercepts them to
 * scroll accurately past the deferred sections. Page links use client routing.
 */
function FooterLink({ label, href }: { label: string; href: string }) {
  return href.startsWith('/#') ? (
    <a href={href} className={linkClass}>
      {label}
    </a>
  ) : (
    <Link href={href} className={linkClass}>
      {label}
    </Link>
  );
}

export function SiteFooter({ contactBand = true }: { contactBand?: boolean }) {
  const year = new Date().getFullYear();
  return (
    <footer className="relative border-t border-white/[0.07] bg-ink-950/80">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold-200/30 to-transparent"
      />

      {/* contact band — left out on the contact page itself */}
      {contactBand && (
        <div className="mx-auto max-w-7xl px-5 pt-14 sm:px-8">
          <div className="flex flex-wrap items-center justify-between gap-6 rounded-3xl border border-white/[0.08] bg-gradient-to-r from-gold-400/[0.07] via-ink-900/70 to-royal-500/[0.08] px-6 py-6 sm:px-8">
            <div className="flex items-center gap-4">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gold-400/[0.1] text-gold-200 ring-1 ring-inset ring-gold-300/30">
                <MessageSquareText className="h-5 w-5" />
              </span>
              <div>
                <p className="font-display text-[20px] font-medium text-white">Questions or feedback?</p>
                <p className="mt-0.5 text-[14px] text-white/60">
                  Write to{' '}
                  <MailLink className="focus-ring rounded font-medium text-gold-200 hover:text-gold-100" />{' '}
                  or use the contact form.
                </p>
              </div>
            </div>
            <Link
              href="/contact"
              className="focus-ring inline-flex h-11 items-center gap-2 rounded-xl border border-white/[0.12] bg-white/[0.05] px-5 text-[14px] font-medium text-white/90 transition hover:border-gold-300/40 hover:bg-white/[0.08] hover:text-white"
            >
              <Mail className="h-4 w-4 text-gold-200" /> Contact us
            </Link>
          </div>
        </div>
      )}

      <div className="mx-auto grid max-w-7xl gap-12 px-5 py-14 sm:px-8 lg:grid-cols-[1.35fr_2fr]">
        <div>
          <BrandLink href="/" />
          <p className="mt-5 max-w-sm text-[14px] leading-relaxed text-white/60">
            The live exam platform for universities, schools and coaching institutes — fair timing, instant results.
          </p>
          <p className="mt-3 max-w-sm text-[13px] leading-relaxed text-white/45">
            The name comes from <span lang="hi" className="text-gold-200/80">परीक्षा</span> (pariksha), the Hindi word for
            an examination.
          </p>
          <SocialLinks className="mt-6" />
        </div>

        <nav aria-label="Footer" className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-4">
          {columns.map((col) => (
            <div key={col.title}>
              <p className="eyebrow">{col.title}</p>
              <ul className="mt-4 space-y-3">
                {col.links.map(([label, href]) => (
                  <li key={label}>
                    <FooterLink label={label} href={href} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </div>

      <div className="border-t border-white/[0.06] py-6">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 text-[13px] text-white/45 sm:px-8">
          <p>
            © {year} {SITE_NAME}. All rights reserved.
          </p>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <MailLink className="focus-ring rounded transition hover:text-white" />
            <span aria-hidden="true" className="hidden h-3 w-px bg-white/15 sm:block" />
            <span>{SITE_DOMAIN}</span>
            <a href="#main" className="focus-ring inline-flex items-center gap-1.5 rounded transition hover:text-white">
              <ArrowUp className="h-3.5 w-3.5" /> Back to top
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
