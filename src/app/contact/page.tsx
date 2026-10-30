import type { Metadata } from 'next';
import { Building2, Mail, Timer } from 'lucide-react';
import { Suspense } from 'react';
import { ContactForm, ContactFormFromQuery } from '@/components/site/ContactForm';
import { MailLink } from '@/components/site/MailLink';
import { PublicPage } from '@/components/site/PublicPage';
import { SocialLinks } from '@/components/site/SocialIcons';

export const metadata: Metadata = {
  title: 'Contact & feedback',
  description:
    'Questions, feedback or a problem during an exam? Students, faculty and institutes can write to the Parikshio team.',
  alternates: { canonical: '/contact' }
};

function InfoCard({
  icon: Icon,
  title,
  children
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="panel p-6">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gold-400/[0.09] text-gold-200 ring-1 ring-inset ring-gold-300/25">
          <Icon className="h-[18px] w-[18px]" />
        </span>
        <h2 className="font-display text-[19px] font-medium text-white">{title}</h2>
      </div>
      <div className="mt-3.5 text-[14px] leading-relaxed text-white/60">{children}</div>
    </div>
  );
}

/** Static page; `?topic=feedback` (and the other topic keys) is read in the browser to preselect the topic. */
export default function ContactPage() {

  return (
    <PublicPage contactBand={false}>
      <section className="mx-auto max-w-7xl px-5 pb-24 pt-10 sm:px-8 sm:pt-16 lg:pb-28">
        <div className="max-w-3xl animate-fadeUp">
          <p className="eyebrow eyebrow-rule">Contact &amp; feedback</p>
          <h1 className="mt-5 font-display text-[2.5rem] font-normal leading-[1.06] text-white sm:text-[3.3rem]">
            Talk to the <span className="gold-text italic">Parikshio</span> team.
          </h1>
          <p className="mt-5 max-w-2xl text-[16px] leading-relaxed text-white/60">
            A question, an idea, or something that went wrong during an exam: students, faculty and institutes can all
            write to us here.
          </p>
        </div>

        <div className="mt-12 grid items-start gap-8 lg:grid-cols-[1.3fr_0.7fr] [&>*]:min-w-0">
          <Suspense fallback={<ContactForm initialTopic="general" />}>
            <ContactFormFromQuery />
          </Suspense>

          <aside className="space-y-5" aria-label="Other ways to reach us">
            <InfoCard icon={Mail} title="Email us">
              <p>
                Prefer email? Write to{' '}
                <MailLink className="focus-ring rounded font-medium text-gold-200 transition hover:text-gold-100" />
                . Screenshots are welcome there.
              </p>
            </InfoCard>

            <InfoCard icon={Timer} title="During a live exam">
              <p>
                If something goes wrong while an exam is running, tell your teacher or invigilator first: faculty can
                re-push a question from the control room. Then write to us with the exam code so we can look into it.
              </p>
            </InfoCard>

            <InfoCard icon={Building2} title="Faculty and institutes">
              <p>
                Faculty accounts are created on request. Choose <span className="text-white/80">Faculty access</span>{' '}
                above, or <span className="text-white/80">Bring Parikshio to my institute</span> to set up a whole school
                or college.
              </p>
            </InfoCard>

            <div className="panel p-6">
              <h2 className="eyebrow">Connect</h2>
              <SocialLinks className="mt-4" />
            </div>
          </aside>
        </div>
      </section>
    </PublicPage>
  );
}
