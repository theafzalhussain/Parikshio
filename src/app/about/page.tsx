import type { Metadata } from 'next';
import { ArrowRight, BarChart3, ClipboardCheck, MessageSquareText, Radio, ShieldCheck } from 'lucide-react';
import { PublicPage } from '@/components/site/PublicPage';
import { LinkButton } from '@/components/ui/Button';

export const metadata: Metadata = {
  title: 'About',
  description:
    'Parikshio is a live assessment platform for schools, coaching institutes and educators: question creation, live delivery, grading and analytics in one workflow.',
  alternates: { canonical: '/about' }
};

const highlights = [
  {
    icon: ClipboardCheck,
    title: 'Create with clarity',
    body: 'Build reusable question banks or upload a paper and turn it into a structured assessment.'
  },
  {
    icon: Radio,
    title: 'Deliver in real time',
    body: 'Run focused live exams with synchronized timers, instant updates and a smooth student experience.'
  },
  {
    icon: BarChart3,
    title: 'Improve with insight',
    body: 'Use grading, rankings and analytics to understand performance and make every assessment more useful.'
  },
  {
    icon: ShieldCheck,
    title: 'Keep assessments trusted',
    body: 'Role-based access, server-side timing and protected answer keys keep the assessment workflow reliable.'
  }
];

const workflow = ['Create', 'Deliver', 'Grade', 'Improve'];

export default function AboutPage() {
  return (
    <PublicPage>
      <section className="mx-auto max-w-7xl px-5 pb-24 pt-10 sm:px-8 sm:pt-16 lg:pb-28">
        <div className="max-w-3xl animate-fadeUp">
          <p className="eyebrow eyebrow-rule">About Parikshio</p>
          <h1 className="mt-5 font-display text-[2.5rem] font-normal leading-[1.06] text-white sm:text-[3.3rem]">
            Better assessments.
            <br />
            <span className="gold-text italic">Better outcomes.</span>
          </h1>
          <p className="mt-5 max-w-2xl text-[16px] leading-relaxed text-white/60">
            Parikshio is a modern assessment platform for schools, coaching institutes and educators. It brings question
            creation, live delivery, grading and performance analytics into one dependable workflow.
          </p>
          <p className="mt-3 max-w-2xl text-[14px] leading-relaxed text-white/45">
            The name comes from <span lang="hi" className="text-gold-200/80">परीक्षा</span> (pariksha), the Hindi word
            for an examination.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <LinkButton href="/signup" variant="gold" size="lg">
              Get started
              <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
            </LinkButton>
            <LinkButton href="/contact" variant="secondary" size="lg">
              <MessageSquareText className="h-4 w-4" />
              Contact us
            </LinkButton>
          </div>
        </div>

        <div className="mt-16 grid gap-4 sm:grid-cols-2 sm:gap-5">
          {highlights.map(({ icon: Icon, title, body }) => (
            <article key={title} className="panel p-6 sm:p-7">
              <span className="grid h-11 w-11 place-items-center rounded-2xl bg-gold-400/[0.09] text-gold-200 ring-1 ring-inset ring-gold-300/25">
                <Icon className="h-5 w-5" />
              </span>
              <h2 className="mt-5 font-display text-[21px] font-medium text-white">{title}</h2>
              <p className="mt-2 text-[14.5px] leading-relaxed text-white/60">{body}</p>
            </article>
          ))}
        </div>

        <div className="gold-edge panel relative mt-16 overflow-hidden p-7 sm:p-10">
          <p className="eyebrow">One workflow</p>
          <ol className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2" aria-label="The Parikshio workflow">
            {workflow.map((step, i) => (
              <li key={step} className="flex items-center gap-3">
                <span className="rounded-full bg-gold-400/[0.1] px-3.5 py-1.5 text-[13px] font-semibold text-gold-100 ring-1 ring-inset ring-gold-300/30">
                  {step}
                </span>
                {i < workflow.length - 1 && <ArrowRight aria-hidden="true" className="h-4 w-4 text-gold-300/60" />}
              </li>
            ))}
          </ol>
          <p className="mt-6 max-w-3xl text-[15px] leading-relaxed text-white/60">
            From a quick classroom quiz to a full institute-wide assessment, Parikshio is built around one simple idea:
            make it easier to create meaningful tests, deliver them fairly and learn from every response.
          </p>
        </div>
      </section>
    </PublicPage>
  );
}
