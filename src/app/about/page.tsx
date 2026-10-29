import { ArrowRight, BarChart3, ClipboardCheck, Radio, ShieldCheck } from 'lucide-react';
import { BrandLink } from '@/components/Logo';
import { LinkButton } from '@/components/ui/Button';

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

export default function AboutPage() {
  return (
    <main id="main" className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 grid-veil opacity-60" />
        <div className="aura aura-violet -left-32 top-0 h-96 w-96" />
        <div className="aura aura-mint bottom-0 right-0 h-96 w-96" />
      </div>

      <header className="mx-auto flex h-[82px] max-w-7xl items-center justify-between px-5 sm:px-8">
        <BrandLink href="/" />
        <LinkButton href="/" size="sm" variant="ghost">
          Back to home
        </LinkButton>
      </header>

      <section className="mx-auto max-w-5xl px-5 pb-20 pt-16 sm:px-8 sm:pt-24">
        <p className="eyebrow">About Parikshio</p>
        <h1 className="mt-5 max-w-3xl text-[2.8rem] font-semibold leading-[1.02] tracking-[-0.04em] text-white sm:text-[4.5rem]">
          Better assessments.
          <br />
          <span className="font-display italic text-lime-300">Better outcomes.</span>
        </h1>
        <p className="mt-7 max-w-2xl text-base leading-relaxed text-white/55 sm:text-lg">
          Parikshio is a modern assessment platform for schools, coaching institutes and educators. It brings
          question creation, live delivery, grading and performance analytics into one dependable workflow.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <LinkButton href="/signup" size="lg" variant="lime">
            Get started
            <ArrowRight className="h-4 w-4" />
          </LinkButton>
          <a
            href="https://www.parikshio.tech/"
            className="focus-ring inline-flex h-12 items-center rounded-xl px-2 text-[13px] text-white/50 underline-offset-4 transition hover:text-white hover:underline"
          >
            www.parikshio.tech
          </a>
        </div>

        <div className="mt-20 grid gap-4 sm:grid-cols-2">
          {highlights.map(({ icon: Icon, title, body }) => (
            <article key={title} className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-lime-400/10 text-lime-300 ring-1 ring-inset ring-lime-400/20">
                <Icon className="h-5 w-5" />
              </span>
              <h2 className="mt-5 text-lg font-semibold text-white">{title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-white/45">{body}</p>
            </article>
          ))}
        </div>

        <div className="mt-20 rounded-3xl border border-white/10 bg-ink-950/60 p-7 sm:p-10">
          <p className="text-sm leading-relaxed text-white/55">
            From a quick classroom quiz to a full institute-wide assessment, Parikshio is built around one simple
            idea: make it easier to create meaningful tests, deliver them fairly and learn from every response.
          </p>
        </div>
      </section>
    </main>
  );
}
