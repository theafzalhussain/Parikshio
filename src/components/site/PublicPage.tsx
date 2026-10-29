import { LandingNav } from '@/components/landing/LandingNav';
import { SiteFooter } from './SiteFooter';

/**
 * Frame for the public pages outside the home page (contact, privacy, terms):
 * the site header, the same ambient wash, and the footer.
 *
 * `overflow-x-clip` rather than `overflow-hidden`: hidden would turn this
 * wrapper into a scroll container and stop the sticky header from sticking.
 */
export function PublicPage({
  children,
  contactBand = true
}: {
  children: React.ReactNode;
  /** The footer's "Questions or feedback?" band; pointless on the contact page itself. */
  contactBand?: boolean;
}) {
  return (
    <div className="relative min-h-screen overflow-x-clip">
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute inset-0 grid-veil opacity-60" />
        <div className="aura aura-royal -left-48 -top-48 h-[36rem] w-[36rem]" />
        <div className="aura aura-gold -right-40 top-24 h-[30rem] w-[30rem]" />
      </div>

      <LandingNav />
      <main id="main">{children}</main>
      <SiteFooter contactBand={contactBand} />
    </div>
  );
}
