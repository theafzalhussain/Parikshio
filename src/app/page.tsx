import Link from 'next/link';
import {
  ArrowRight,
  BarChart3,
  Blocks,
  BrainCircuit,
  Check,
  ChevronRight,
  ClipboardList,
  Gauge,
  Layers,
  ListChecks,
  Lock,
  PenLine,
  Radio,
  ShieldCheck,
  Sparkles,
  Timer,
  Type,
  Users
} from 'lucide-react';
import { BrandLink, LivePill, LogoMark } from '@/components/Logo';
import { HeroConsole } from '@/components/landing/HeroConsole';
import { LandingNav } from '@/components/landing/LandingNav';
import { HeroActions } from '@/components/landing/HeroActions';
import { BarChart, Donut, Sparkline } from '@/components/charts/Charts';
import { Badge, Divider, Panel, SectionHead } from '@/components/ui/Panel';
import { LinkButton } from '@/components/ui/Button';
import { Avatar } from '@/components/ui/Pills';
import { cx } from '@/lib/api';

/**
 * Marketing page. This is a server component on purpose: the only parts that
 * need the browser are the scroll-aware nav and the hero CTA (which depends on
 * who is signed in), so those live in their own small client islands. Everything
 * else — roughly 500 lines of static markup and twenty icons — is rendered on
 * the server and never ships as JavaScript.
 */

const steps = [
  {
    n: '01',
    title: 'Compose the paper',
    body: 'Build question banks across five formats — MCQ, true/false, fill-in-the-blank, short and long answer — with points, topics and an individual timer for each item.',
    icon: ClipboardList
  },
  {
    n: '02',
    title: 'Push it live',
    body: 'Hit push. Socket.io fans the question out to every enrolled device in milliseconds with a server-authoritative deadline. No refresh, no drift.',
    icon: Radio
  },
  {
    n: '03',
    title: 'Read the room',
    body: 'Answers stream back timestamped and auto-graded. Leaderboards rank accuracy first, speed second — analytics roll up per question, per type, per cohort.',
    icon: BarChart3
  }
];

const features = [
  {
    icon: Layers,
    title: 'A question bank that behaves like a library',
    body: 'Filter by type, topic and difficulty. Every question carries its own timer, points and accepted-answer keys, so it is exam-ready the moment it is created.',
    span: 'lg:col-span-2'
  },
  {
    icon: Timer,
    title: 'Per-question timers',
    body: 'Set 20 seconds for recall, 4 minutes for derivations. Override at push time and the lock is enforced server-side.',
    span: ''
  },
  {
    icon: ShieldCheck,
    title: 'Strict role-based access',
    body: 'Admin tokens can author and push. Student tokens can only read their own paper and submit. Enforced on every REST route and every socket room.',
    span: ''
  },
  {
    icon: BrainCircuit,
    title: 'Automatic grading',
    body: 'Objective answers grade instantly; text answers accept normalised keys with typo tolerance. Long-form responses queue for a one-tap manual score.',
    span: ''
  },
  {
    icon: Gauge,
    title: 'Institute-grade analytics',
    body: 'Accuracy per question, cognitive-load signals from latency, option distributions that expose the distractor doing the damage.',
    span: 'lg:col-span-2'
  }
];

const stack = ['Next.js', 'TypeScript', 'Tailwind CSS', 'Node.js', 'Express', 'MongoDB', 'Redis', 'Socket.io'];

const adminRights = [
  'Author and version every question type',
  'Assign a timer + points per question',
  'Push / lock / end a live session',
  'Watch responses stream in real time',
  'Manually score long-form answers',
  'Export institute-level analytics'
];

const studentRights = [
  'Join with an exam code — no setup',
  'One question on screen at a time',
  'Server-synced countdown with alerts',
  'Type-specific, mobile-first answer inputs',
  'Instant grading on objective answers',
  'Live rank among the cohort'
];

const partners = [
  'Axiom Institute of Technology',
  'Nalanda Faculty of Science',
  'Meridian School of Engineering',
  'Vidya Analytics Lab',
  'Ashoka Skills Academy',
  'Bharat STEM Collective'
];

const footerColumns = [
  {
    title: 'Product',
    links: [
      ['Admin console', '/admin'],
      ['Student mode', '/student'],
      ['Live demo', '/login']
    ]
  },
  {
    title: 'Platform',
    links: [
      ['Question bank', '/admin/questions'],
      ['Sessions', '/admin/exams'],
      ['Analytics', '/admin']
    ]
  },
  {
    title: 'System',
    links: [
      ['API health', '/api/health'],
      ['Roles & access', '/#roles'],
      ['How it works', '/#how']
    ]
  }
];

export default function LandingPage() {
  return (
    <div className="relative min-h-screen overflow-hidden">
      {/*
        Ambient wash. These used to be `filter: blur(120px)` boxes with a drift
        animation, which forced the GPU to re-rasterise a 34rem blur on every
        frame. Painted radial gradients give the same look for a fraction of it.
      */}
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute inset-0 grid-veil opacity-70" />
        <div className="aura aura-violet -left-40 -top-40 h-[34rem] w-[34rem] animate-drift" />
        <div className="aura aura-mint -right-32 top-24 h-[30rem] w-[30rem] animate-drift [animation-delay:2s]" />
        <div className="aura aura-violet bottom-0 left-1/3 h-[26rem] w-[26rem] opacity-60" />
      </div>

      <LandingNav />

      <main id="main">
        {/* hero */}
        <section className="mx-auto max-w-7xl px-5 pb-8 pt-14 sm:px-8 sm:pt-20">
          <div className="grid items-center gap-12 lg:grid-cols-[1.02fr_0.98fr] lg:gap-10">
            <div className="animate-popIn">
              <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] py-1 pl-1 pr-3.5">
                <span className="rounded-full bg-lime-400/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-lime-300">
                  new
                </span>
                <span className="text-[12px] text-white/55">Per-question timers + live ranking, in one console</span>
              </div>

              <h1 className="text-[2.6rem] font-semibold leading-[1.03] tracking-[-0.03em] text-white sm:text-[3.4rem] lg:text-[3.65rem]">
                Run the exam
                <br className="hidden sm:block" /> at the speed of{' '}
                <span className="relative inline-block">
                  <span className="gradient-text font-display italic">thought.</span>
                  <svg
                    viewBox="0 0 220 12"
                    className="absolute -bottom-2 left-0 h-2.5 w-full text-lime-400/70"
                    preserveAspectRatio="none"
                    aria-hidden="true"
                  >
                    <path
                      d="M2 8c40-6 92-7 140-4 26 1.6 52 3.5 76 2"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                    />
                  </svg>
                </span>
              </h1>

              <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-white/55 sm:text-base">
                Axiom Live is the real-time assessment OS for institutes. Author any question type, push it to every
                student device with a server-authoritative timer, capture timestamped answers as they land — and watch
                auto-graded results rank themselves.
              </p>

              <HeroActions />

              <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-3">
                <div className="flex items-center gap-2.5">
                  <div className="flex -space-x-2">
                    {['Ananya Rao', 'Aarav Mehta', 'Zoya Khan', 'Kabir Singh'].map((n) => (
                      <span key={n} className="rounded-full ring-2 ring-ink-950">
                        <Avatar name={n} size={26} />
                      </span>
                    ))}
                  </div>
                  <p className="text-[12px] leading-tight text-white/40">
                    <span className="font-medium text-white/70">8 pilot institutes</span>
                    <br />
                    running Axiom this semester
                  </p>
                </div>
                <Divider className="hidden h-8 w-px bg-white/10 sm:block" />
                <div className="flex gap-6">
                  {[
                    { k: '38 ms', v: 'push latency' },
                    { k: '5', v: 'question types' },
                    { k: '0', v: 'clock drift' }
                  ].map((s) => (
                    <div key={s.v}>
                      <p className="num text-[15px] font-semibold text-white">{s.k}</p>
                      <p className="text-[10.5px] uppercase tracking-[0.12em] text-white/30">{s.v}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="relative lg:pl-4">
              <HeroConsole />
            </div>
          </div>
        </section>

        {/* marquee */}
        <div className="edge-fade-x relative mt-6 overflow-hidden border-y border-white/[0.06] bg-white/[0.012] py-3.5">
          <div className="flex w-max animate-marquee items-center gap-10 whitespace-nowrap px-6">
            {[0, 1].map((dup) => (
              <div key={dup} className="flex items-center gap-10" aria-hidden={dup === 1}>
                {partners.map((name) => (
                  <span
                    key={`${dup}-${name}`}
                    className="flex items-center gap-2.5 text-[12px] uppercase tracking-[0.18em] text-white/25"
                  >
                    <LogoMark className="h-4 w-4 opacity-60" accent="#7C5CFF" />
                    {name}
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* how it works */}
        <section id="how" className="defer-paint mx-auto max-w-7xl px-5 py-20 sm:px-8">
          <SectionHead
            eyebrow="The loop"
            title={<>Three moves. One live exam.</>}
            sub="Axiom is built around the shortest path between a question and a defensible score."
            action={<Badge tone="violet">Real-time · Socket.io</Badge>}
          />
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {steps.map((step, i) => (
              <Panel key={step.n} hover className="relative overflow-hidden p-6">
                <div className="num absolute right-5 top-4 text-[42px] font-semibold leading-none text-white/[0.06]">
                  {step.n}
                </div>
                <span className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-aurora-500/30 to-mint-500/15 text-aurora-100 ring-1 ring-inset ring-white/10">
                  <step.icon className="h-5 w-5" />
                </span>
                <h3 className="mt-4 text-[15px] font-semibold text-white">{step.title}</h3>
                <p className="mt-2 text-[12.5px] leading-relaxed text-white/45">{step.body}</p>
                {i < steps.length - 1 && (
                  <ChevronRight className="absolute -right-2.5 top-1/2 hidden h-5 w-5 -translate-y-1/2 text-white/15 md:block" />
                )}
              </Panel>
            ))}
          </div>
        </section>

        {/* features bento */}
        <section id="features" className="defer-paint mx-auto max-w-7xl px-5 pb-20 sm:px-8">
          <SectionHead
            eyebrow="Platform"
            title="Everything an invigilator needs, nothing a student can break"
            sub="Authoring, delivery, grading and analytics share one data model — so a question written at 9:00 can be analysed at 9:20."
          />
          <div className="mt-10 grid gap-4 lg:grid-cols-3">
            {features.map((f) => (
              <Panel key={f.title} hover className={cx('group p-6', f.span)}>
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-white/[0.05] text-white/70 ring-1 ring-inset ring-white/10 transition group-hover:text-lime-300">
                  <f.icon className="h-[18px] w-[18px]" />
                </span>
                <h3 className="mt-4 text-[14.5px] font-semibold text-white">{f.title}</h3>
                <p className="mt-2 text-[12.5px] leading-relaxed text-white/45">{f.body}</p>

                {f.title.startsWith('A question bank') && (
                  <div className="mt-5 space-y-2">
                    {[
                      { icon: ListChecks, label: 'MCQ · 4 options · 45s', tone: 'text-aurora-200' },
                      { icon: Type, label: 'Fill in the blank · 30s · typo-tolerant', tone: 'text-lime-300' },
                      { icon: PenLine, label: 'Long answer · 240s · manual review', tone: 'text-ember-400' }
                    ].map((row) => (
                      <div
                        key={row.label}
                        className="flex items-center gap-2.5 rounded-xl border border-white/[0.07] bg-ink-900/60 px-3 py-2"
                      >
                        <row.icon className={cx('h-3.5 w-3.5', row.tone)} />
                        <span className="text-[11.5px] text-white/55">{row.label}</span>
                        <Check className="ml-auto h-3 w-3 text-mint-400" />
                      </div>
                    ))}
                  </div>
                )}

                {f.title.startsWith('Institute-grade') && (
                  <div className="mt-5 rounded-xl border border-white/[0.07] bg-ink-900/60 p-3">
                    <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-[0.14em] text-white/30">
                      <span>accuracy by question</span>
                      <span className="text-mint-300">+12.4%</span>
                    </div>
                    <Sparkline points={[38, 44, 41, 55, 62, 58, 71, 78, 74, 86]} />
                  </div>
                )}
              </Panel>
            ))}
          </div>
        </section>

        {/* analytics spotlight */}
        <section id="analytics" className="defer-paint relative mx-auto max-w-7xl px-5 pb-20 sm:px-8">
          <Panel className="overflow-hidden">
            <div className="grid gap-8 p-6 sm:p-9 lg:grid-cols-[0.85fr_1.15fr] lg:items-center">
              <div>
                <p className="eyebrow mb-3">Analytics</p>
                <h2 className="text-[1.7rem] font-semibold leading-tight tracking-[-0.02em] text-white sm:text-[2rem]">
                  Know which question broke the room —{' '}
                  <span className="font-display italic text-lime-300">while it is still live.</span>
                </h2>
                <p className="mt-4 text-[13.5px] leading-relaxed text-white/50">
                  Every submission carries its latency. Axiom turns that into signal: accuracy per question, per type,
                  per cohort, plus the option distribution that shows exactly which distractor is catching students.
                </p>
                <ul className="mt-5 space-y-2.5">
                  {[
                    'Accuracy, completion and average score per session',
                    'Latency buckets that separate recall from reasoning',
                    'Top performers ranked by accuracy, then speed'
                  ].map((line) => (
                    <li key={line} className="flex items-start gap-2.5 text-[12.5px] text-white/60">
                      <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-lime-400/15 text-lime-300">
                        <Check className="h-2.5 w-2.5" />
                      </span>
                      {line}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded-2xl border border-white/[0.08] bg-ink-900/70 p-4 sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-[12.5px] font-medium text-white">Quantum Foundations — Live Sprint</p>
                    <p className="text-[11px] text-white/35">Physics · Unit 4 · 6 questions</p>
                  </div>
                  <LivePill label="ended" tone="glass" />
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2.5">
                  {[
                    { k: '82%', v: 'accuracy' },
                    { k: '9', v: 'participants' },
                    { k: '18.4s', v: 'avg latency' }
                  ].map((s) => (
                    <div key={s.v} className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-2.5">
                      <p className="num text-[16px] font-semibold text-white">{s.k}</p>
                      <p className="text-[9.5px] uppercase tracking-[0.12em] text-white/30">{s.v}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-4 grid gap-4 sm:grid-cols-[1.3fr_auto] sm:items-center">
                  <div>
                    <p className="mb-2 text-[10px] uppercase tracking-[0.14em] text-white/30">attempts per question</p>
                    <BarChart
                      height={92}
                      data={[
                        { label: 'Q1', value: 9 },
                        { label: 'Q2', value: 8 },
                        { label: 'Q3', value: 9 },
                        { label: 'Q4', value: 7 },
                        { label: 'Q5', value: 8 },
                        { label: 'Q6', value: 6 }
                      ]}
                    />
                  </div>
                  <div className="flex items-center justify-center">
                    <Donut value={82} sub="graded" />
                  </div>
                </div>
              </div>
            </div>
          </Panel>
        </section>

        {/* roles */}
        <section id="roles" className="defer-paint mx-auto max-w-7xl px-5 pb-20 sm:px-8">
          <SectionHead
            eyebrow="Role-based access"
            title="Two roles. Zero overlap."
            sub="Tokens carry the role; every endpoint and socket room checks it. Students never see a correct key, admins never see a locked door."
          />
          <div className="mt-10 grid gap-4 lg:grid-cols-2">
            <Panel className="relative overflow-hidden p-6 sm:p-7">
              <div className="aura aura-violet -right-16 -top-16 h-40 w-40" />
              <div className="relative flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="grid h-11 w-11 place-items-center rounded-2xl bg-aurora-500/15 text-aurora-100 ring-1 ring-inset ring-aurora-400/30">
                    <Lock className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="text-[14.5px] font-semibold text-white">Admin · Faculty</p>
                    <p className="text-[11.5px] text-white/35">Control room access</p>
                  </div>
                </div>
                <Badge tone="violet">full access</Badge>
              </div>
              <ul className="relative mt-5 grid gap-2.5 sm:grid-cols-2">
                {adminRights.map((r) => (
                  <li key={r} className="flex items-start gap-2 text-[12.5px] text-white/55">
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-aurora-300" />
                    {r}
                  </li>
                ))}
              </ul>
            </Panel>

            <Panel className="relative overflow-hidden p-6 sm:p-7">
              <div className="aura aura-mint -right-16 -top-16 h-40 w-40" />
              <div className="relative flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="grid h-11 w-11 place-items-center rounded-2xl bg-mint-500/15 text-mint-300 ring-1 ring-inset ring-mint-400/30">
                    <Users className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="text-[14.5px] font-semibold text-white">Student</p>
                    <p className="text-[11.5px] text-white/35">Single-paper focus mode</p>
                  </div>
                </div>
                <Badge tone="mint">scoped access</Badge>
              </div>
              <ul className="relative mt-5 grid gap-2.5 sm:grid-cols-2">
                {studentRights.map((r) => (
                  <li key={r} className="flex items-start gap-2 text-[12.5px] text-white/55">
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-mint-400" />
                    {r}
                  </li>
                ))}
              </ul>
            </Panel>
          </div>
        </section>

        {/* stack */}
        <section className="defer-paint mx-auto max-w-7xl px-5 pb-20 sm:px-8">
          <Panel className="p-6 sm:p-8">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="eyebrow mb-2">Under the hood</p>
                <h2 className="text-lg font-semibold text-white">A stack that survives a 10,000-seat exam</h2>
              </div>
              <Badge tone="lime">
                <Blocks className="h-3 w-3" /> typed end-to-end
              </Badge>
            </div>
            <div className="mt-6 flex flex-wrap gap-2.5">
              {stack.map((tech) => (
                <span
                  key={tech}
                  className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-3.5 py-2 text-[12px] text-white/60 transition hover:border-white/20 hover:text-white"
                >
                  {tech}
                </span>
              ))}
            </div>
            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              {[
                { icon: Radio, t: 'Socket.io rooms', d: 'One room per exam code for instant fan-out.' },
                { icon: Blocks, t: 'Redis cache', d: 'Leaderboards and analytics served warm, not recomputed.' },
                { icon: Sparkles, t: 'MongoDB mirror', d: 'Every mutation written through for durable records.' }
              ].map((c) => (
                <div key={c.t} className="rounded-xl border border-white/[0.07] bg-ink-900/50 p-3.5">
                  <c.icon className="h-4 w-4 text-lime-300" />
                  <p className="mt-2 text-[12.5px] font-medium text-white/85">{c.t}</p>
                  <p className="mt-1 text-[11.5px] leading-relaxed text-white/35">{c.d}</p>
                </div>
              ))}
            </div>
          </Panel>
        </section>

        {/* CTA */}
        <section className="defer-paint mx-auto max-w-7xl px-5 pb-20 sm:px-8">
          <div className="relative overflow-hidden rounded-4xl border border-white/[0.09] bg-gradient-to-br from-aurora-600/25 via-ink-880 to-mint-600/10 p-8 sm:p-12">
            <div className="absolute inset-0 dot-veil opacity-40" />
            <div className="relative grid items-center gap-8 lg:grid-cols-[1.2fr_0.8fr]">
              <div>
                <LivePill label="demo ready" />
                <h2 className="mt-4 text-[1.9rem] font-semibold leading-tight tracking-[-0.02em] text-white sm:text-[2.4rem]">
                  Open the console. Push a question.
                  <br />
                  <span className="font-display italic text-lime-300">Watch the room answer.</span>
                </h2>
                <p className="mt-3 max-w-lg text-[13px] leading-relaxed text-white/50">
                  Two demo logins are seeded with a live session, a question bank and a cohort of results — so you can
                  see the whole loop working in under a minute.
                </p>
                <div className="mt-7 flex flex-wrap gap-3">
                  <LinkButton href="/login" size="lg" variant="lime">
                    Enter the demo
                    <ArrowRight className="h-4 w-4" />
                  </LinkButton>
                  <Link
                    href="#features"
                    className="focus-ring inline-flex h-12 items-center rounded-xl px-2 text-[13px] text-white/50 underline-offset-4 transition hover:text-white hover:underline"
                  >
                    Explore capabilities
                  </Link>
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-ink-950/60 p-4 backdrop-blur-xl">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/35">demo credentials</p>
                <div className="mt-3 space-y-2.5">
                  <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
                    <p className="text-[11px] uppercase tracking-[0.12em] text-aurora-200">admin</p>
                    <p className="mt-1 font-mono text-[11.5px] text-white/70">admin@axiom.edu · admin123</p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
                    <p className="text-[11px] uppercase tracking-[0.12em] text-mint-300">student</p>
                    <p className="mt-1 font-mono text-[11.5px] text-white/70">aarav@axiom.edu · student123</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* footer */}
      <footer className="border-t border-white/[0.07] bg-ink-950/60">
        <div className="mx-auto grid max-w-7xl gap-8 px-5 py-12 sm:px-8 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <BrandLink href="/" />
            <p className="mt-4 max-w-xs text-[12px] leading-relaxed text-white/35">
              Real-time assessment infrastructure for institutes that would rather measure than guess.
            </p>
          </div>
          {footerColumns.map((col) => (
            <div key={col.title}>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/40">{col.title}</p>
              <ul className="mt-3 space-y-2">
                {col.links.map(([label, href]) => (
                  <li key={label}>
                    <Link
                      href={href!}
                      className="focus-ring rounded-md text-[12.5px] text-white/45 transition hover:text-white"
                    >
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="border-t border-white/[0.05] px-5 py-5 sm:px-8">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 text-[11.5px] text-white/25">
            <p>© {new Date().getFullYear()} Axiom Live. Built for real classrooms.</p>
            <p className="font-mono">Next.js · Express · MongoDB · Redis · Socket.io</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
