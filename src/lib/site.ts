/**
 * Brand and contact details in one place. Every page, the footer, metadata and
 * the contact form read from here, so a new social account or email address is
 * a one-line change.
 */

export const SITE_NAME = 'Parikshio';
export const SITE_TAGLINE = 'Live assessment platform';
export const SITE_DESCRIPTION =
  'Parikshio is the live exam platform for universities, schools and coaching institutes. Push questions to every student with a server-synced timer — one at a time or a whole paper at once — and see answers graded the moment they arrive.';

/**
 * Canonical public origin. The live site answers on www (the bare domain
 * redirects there), so links, canonical URLs and the sitemap use it directly.
 * Override with NEXT_PUBLIC_SITE_URL on a different domain.
 */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.parikshio.tech').trim().replace(/\/+$/, '');
/** The domain as people type it, for display: "parikshio.tech". */
export const SITE_DOMAIN = SITE_URL.replace(/^https?:\/\//, '').replace(/^www\./, '');

/** The one address used everywhere: shown on the site, in every mailto link, and as the team inbox. */
export const CONTACT_EMAIL = 'support@parikshio.tech';

export type SocialNetwork = 'github' | 'linkedin' | 'instagram' | 'whatsapp';

/** Taken from the founder's portfolio (afzalhussain.tech). */
export const SOCIAL_LINKS: { network: SocialNetwork; label: string; href: string }[] = [
  { network: 'linkedin', label: 'LinkedIn', href: 'https://www.linkedin.com/in/theafzalhussain/' },
  { network: 'instagram', label: 'Instagram', href: 'https://www.instagram.com/theafzal_hussain_786' },
  { network: 'github', label: 'GitHub', href: 'https://github.com/theafzalhussain' },
  { network: 'whatsapp', label: 'WhatsApp', href: 'https://wa.me/918447859784' }
];

export { CONTACT_ROLES, CONTACT_TOPICS, type ContactRole, type ContactTopic } from '@shared/contact';
