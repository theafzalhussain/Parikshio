import Link from 'next/link';
import type { Metadata } from 'next';
import {
  ArrowRight,
  BarChart3,
  BookOpenCheck,
  BrainCircuit,
  Check,
  ChevronDown,
  ClipboardList,
  CloudUpload,
  EyeOff,
  Gauge,
  Landmark,
  Layers,
  ListChecks,
  Lock,
  Mail,
  PenLine,
  Radio,
  School,
  ShieldCheck,
  Timer,
  Type,
  Users
} from 'lucide-react';
import { LivePill, Seal } from '@/components/Logo';
import { HeroConsole } from '@/components/landing/HeroConsole';
import { HeroJoin } from '@/components/landing/HeroJoin';
import { LandingNav } from '@/components/landing/LandingNav';
import { MailLink } from '@/components/site/MailLink';
import { SiteFooter } from '@/components/site/SiteFooter';
import { BarChart, Donut, Sparkline, chartColors } from '@/components/charts/Charts';
import { Badge, Panel } from '@/components/ui/Panel';
import { LinkButton } from '@/components/ui/Button';
import { cx } from '@/lib/api';

export const metadata: Metadata = {
  alternates: { canonical: '/' }
};

/**
 * Marketing page. This is a server component on purpose: the only parts that
 * need the browser are the scroll-aware nav and the hero code box (which
 * depends on who is signed in), so those live in their own small client
 * islands. Everything else is rendered on the server and ships no JavaScript.
 *
 * Every claim on this page describes something the product actually does.
 */

const capabilities = [
  'Live push',
  'Self-paced question sets',
  'Server-synced timers',
  'Instant auto-grading',
  'AI evaluation for written answers',
  'Answers saved offline',
  'Paper upload with OCR',
  'Google Classroom sync',
  'Live leaderboard',
  'Analytics & CSV export'
];

const audiences = [
  {
    icon: Landmark,
    title: 'Universities & colleges',
    lede: 'Lecture-hall quizzes and internal assessments for large cohorts.',
    points: [
      'Hundreds of students on a single join code',
      'Faculty accounts provisioned by an administrator',
      'Per-question analytics, exportable as CSV'
    ]
  },
  {
    icon: School,
    title: 'Schools',
    lede: 'Classroom quizzes that run on any phone, tablet or laptop.',
    points: [
      'Students join with a short code — nothing to install',
      'One question at a time, with large touch-friendly answers',
      'Google Classroom roster matching and grade publishing'
    ]
  },
  {
    icon: BookOpenCheck,
    title: 'Coaching & training institutes',
    lede: 'Timed mock tests, daily practice papers and revision sprints.',
    points: [
      'Upload a paper and push it as one self-paced set',
      'Timers from 5 seconds to an hour, per question',
      'Live leaderboard ranked by accuracy, then speed'
    ]
  }
];

const steps = [
  {
    n: 'I',
    title: 'Compose the paper',
    body: 'Write questions in five formats — MCQ, true/false, fill in the blank, short and long answer — or upload a paper you already have. Each question carries its own points and timer.',
    icon: ClipboardList
  },
  {
    n: 'II',
    title: 'Push it live',
    body: 'Send one question to the whole room, or a whole set at once. It reaches every student’s screen instantly, with a deadline kept by the server clock.',
    icon: Radio
  },
  {
    n: 'III',
    title: 'Read the room',
    body: 'Answers arrive timestamped and graded. The leaderboard ranks accuracy first, speed second; analytics break results down by question, format and cohort.',
    icon: BarChart3
  }
];

const modes = [
  {
    key: 'live',
    icon: Radio,
    badge: 'Instructor-paced',
    title: 'Live push',
    body: 'One question appears on every screen at the same moment, with the same server-side timer for everyone.',
    best: 'Lecture quizzes, competitions, quick checks for understanding',
    points: ['Push, lock and push the next with one click', 'Answers lock automatically when the timer ends', 'Results reveal to the whole room together'],
    tone: 'royal' as const
  },
  {
    key: 'set',
    icon: Layers,
    badge: 'Student-paced',
    title: 'Self-paced set',
    body: 'Push ten questions together. Each student sees the whole list, picks the order, and a question’s timer starts only when they open it.',
    best: 'Mock tests, practice papers, homework in class',
    points: [
      'One timer for all, or a different one per question',
      'The next question can start automatically after each answer',
      'A question that times out stays closed until you re-open it'
    ],
    tone: 'gold' as const
  }
];

const features = [
  {
    key: 'bank',
    icon: Layers,
    title: 'A question bank that behaves like a library',
    body: 'Filter by format, topic and difficulty. Every question carries its own timer, points and answer key, so it is exam-ready the moment it is saved.',
    span: 'lg:col-span-2'
  },
  {
    key: 'timers',
    icon: Timer,
    title: 'A timer for every question',
    body: 'Twenty seconds for recall, four minutes for a derivation. Change it at push time; the deadline is enforced on the server.',
    span: ''
  },
  {
    key: 'access',
    icon: ShieldCheck,
    title: 'Strict role-based access',
    body: 'Faculty author and push. Students can only see their own paper and submit. Checked on every request and in every live room.',
    span: ''
  },
  {
    key: 'grading',
    icon: BrainCircuit,
    title: 'Grading that keeps up',
    body: 'Objective answers are graded the instant they arrive, with typo-tolerant matching for written keys. Long answers go to the AI evaluator or a one-tap faculty score.',
    span: ''
  },
  {
    key: 'analytics',
    icon: Gauge,
    title: 'Analytics your department can use',
    body: 'Accuracy per question, answer-time patterns, and option distributions that show which distractor is catching students.',
    span: ''
  }
];

const adminRights = [
  'Write questions in every format',
  'Set a timer and points per question',
  'Push, lock and end a live session',
  'Watch answers arrive in real time',
  'Score long answers by hand or with AI',
  'Export results and analytics'
];

const studentRights = [
  'Join with an exam code — no setup',
  'A clear, distraction-free exam screen',
  'A countdown synced to the server',
  'Answer inputs built for phones',
  'Instant results on objective questions',
  'See your rank among classmates'
];

const examDay = [
  {
    icon: Timer,
    title: 'Fair timing for everyone',
    body: 'Deadlines come from the server clock, not the student’s device, so changing the phone’s time changes nothing.'
  },
  {
    icon: CloudUpload,
    title: 'No answer lost to bad Wi-Fi',
    body: 'If the connection drops, the answer is saved on the device and delivered the moment it reconnects.'
  },
  {
    icon: Lock,
    title: 'Answer keys stay secret',
    body: 'Correct answers never leave the server while an exam is running — not even hidden inside the page.'
  },
  {
    icon: EyeOff,
    title: 'Integrity built in',
    body: 'Faculty are alerted when a student leaves the exam tab during a live session.'
  }
];

const faqs = [
  {
    q: 'How do students join an exam?',
    a: 'Faculty shares a short join code. Students type it into the box on this page (or in their lobby), log in, and the exam room opens. There is nothing to install.'
  },
  {
    q: 'Can I push many questions at once?',
    a: 'Yes. Tick questions in the control room, the question bank or an uploaded paper and choose “Push together”. Give them one shared timer or a different timer each. Students see the whole list and choose the order; each timer starts only when a student opens that question.'
  },
  {
    q: 'What happens when a student runs out of time on a question?',
    a: 'That question closes for that student, and the next one is offered. Faculty can re-open it from the control room for everyone who missed it — answers already given stay as they are.'
  },
  {
    q: 'What if a student’s internet drops in the middle?',
    a: 'Their answer is saved on the device and delivered automatically when the connection returns. The timer keeps running on the server, so nobody gains extra time.'
  },
  {
    q: 'Which question types are supported?',
    a: 'Multiple choice, true/false, fill in the blank, short answer and long answer. Objective answers are graded instantly by the answer key; written answers can be scored by the AI evaluator (when enabled) or by faculty.'
  },
  {
    q: 'Can students see the correct answers?',
    a: 'Never while the exam is running — answer keys stay on the server. After a session ends, faculty can choose to share the key and explanations in each student’s review.'
  },
  {
    q: 'Can I use a question paper I already have?',
    a: 'Yes. Upload a PDF, Word file, photo or plain text. Questions, options, marks and answer keys are detected and imported into your bank, ready to time and push.'
  },
  {
    q: 'How do faculty get an account?',
    a: 'Students sign up on their own. Faculty and administrator accounts are created by your institute, so only authorised staff can write and push questions. If your institute is new to Parikshio, contact us and we will help you set up.'
  }
];

/** Eyebrow + serif headline + lede, shared by every landing section. */
function SectionIntro({
  eyebrow,
  title,
  sub,
  action
}: {
  eyebrow: string;
  title: React.ReactNode;
  sub?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="reveal flex flex-wrap items-end justify-between gap-6">
      <div className="max-w-3xl">
        <p className="eyebrow eyebrow-rule">{eyebrow}</p>
        <h2 className="mt-4 font-display text-[2.1rem] font-normal leading-[1.08] text-white sm:text-[2.8rem]">{title}</h2>
        {sub && <p className="mt-4 max-w-2xl text-[16px] leading-relaxed text-white/60">{sub}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export default function LandingPage() {
  return (
    // `overflow-x-clip`, not `overflow-hidden`: hidden makes this wrapper a
    // scroll container, and the sticky header inside it would stop sticking.
    <div className="relative min-h-screen overflow-x-clip">
      {/*
        Ambient wash: painted radial gradients over ruled lines. These used to
        be `filter: blur(120px)` boxes, which forced the GPU to re-rasterise a
        34rem blur on every frame; gradients give the same look for a fraction.
      */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute inset-0 grid-veil opacity-70" />
        <div className="aura aura-royal -left-48 -top-48 h-[40rem] w-[40rem] animate-drift" />
        <div className="aura aura-gold -right-40 top-10 h-[34rem] w-[34rem] animate-drift [animation-delay:3s]" />
        <div className="aura aura-royal bottom-0 left-1/3 h-[28rem] w-[28rem] opacity-60" />
      </div>

      <LandingNav />

      <main id="main">
        {/* ── hero ─────────────────────────────────────────── */}
        <section className="mx-auto max-w-7xl px-5 pb-16 pt-12 sm:px-8 sm:pt-20 lg:pb-24 lg:pt-24">
          <div className="grid items-center gap-16 lg:grid-cols-[1.04fr_0.96fr] lg:gap-12 [&>*]:min-w-0">
            <div className="animate-fadeUp">
              <a
                href="#modes"
                className="focus-ring group mb-8 inline-flex max-w-full items-center gap-2.5 rounded-full border border-gold-200/20 bg-gold-300/[0.06] py-1 pl-1 pr-3.5 transition hover:border-gold-200/40"
              >
                <span className="shrink-0 rounded-full bg-gradient-to-b from-gold-200 to-gold-400 px-2.5 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.14em] text-ink-950">
                  new
                </span>
                <span className="truncate text-[13px] text-white/75">Push a whole paper at once — students choose the order</span>
                <ArrowRight className="h-3.5 w-3.5 shrink-0 text-gold-200/70 transition group-hover:translate-x-0.5" />
              </a>

              <h1 className="font-display text-[2.85rem] font-normal leading-[1.02] text-white sm:text-[4rem] lg:text-[4.35rem]">
                Run the exam
                <br className="hidden sm:block" /> at the speed of{' '}
                <span className="relative inline-block">
                  <span className="gold-text italic">thought.</span>
                  <svg
                    viewBox="0 0 220 12"
                    className="absolute -bottom-2.5 left-0 h-3 w-full"
                    preserveAspectRatio="none"
                    aria-hidden="true"
                  >
                    <path
                      d="M2 8c40-6 92-7 140-4 26 1.6 52 3.5 76 2"
                      fill="none"
                      stroke="url(#brand-gold-soft)"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                    />
                  </svg>
                </span>
              </h1>

              <p className="mt-7 max-w-xl text-[16.5px] leading-relaxed text-white/65 sm:text-[17.5px]">
                <span className="font-semibold text-white">Parikshio</span> is the live exam platform for universities,
                schools and coaching institutes. Push questions to every student’s screen with a server-synced timer —
                one at a time or a whole paper at once — and watch answers grade themselves as they arrive.
              </p>

              <HeroJoin />

              <dl className="mt-11 grid max-w-md grid-cols-3 items-start gap-6 border-t border-white/[0.07] pt-7">
                {[
                  { k: '5', v: 'question formats' },
                  { k: '2', v: 'exam modes' },
                  { k: '0', v: 'apps to install' }
                ].map((s) => (
                  <div key={s.v} className="flex flex-col-reverse">
                    <dt className="mt-2 text-[11px] uppercase tracking-[0.14em] text-white/50">{s.v}</dt>
                    <dd className="font-display text-[30px] font-medium leading-none text-white">{s.k}</dd>
                  </div>
                ))}
              </dl>
            </div>

            <div className="relative animate-fadeUp [animation-delay:150ms] lg:pl-4">
              <HeroConsole />
            </div>
          </div>
        </section>

        {/* ── capability ribbon ────────────────────────────── */}
        <div
          className="edge-fade-x relative overflow-hidden border-y border-white/[0.06] bg-white/[0.015] py-5"
          aria-label="What Parikshio does"
        >
          <div className="flex w-max animate-marquee items-center gap-10 whitespace-nowrap px-5">
            {[0, 1].map((dup) => (
              <ul key={dup} className="flex items-center gap-10" aria-hidden={dup === 1}>
                {capabilities.map((item) => (
                  <li
                    key={`${dup}-${item}`}
                    className="flex items-center gap-10 font-display text-[18px] italic text-white/55"
                  >
                    {item}
                    <span aria-hidden="true" className="h-1.5 w-1.5 rotate-45 bg-gold-300/60" />
                  </li>
                ))}
              </ul>
            ))}
          </div>
        </div>

        {/* ── who it's for ─────────────────────────────────── */}
        <section id="audience" className="defer-paint mx-auto max-w-7xl px-5 pt-24 sm:px-8 lg:pt-28">
          <SectionIntro
            eyebrow="Who it’s for"
            title={
              <>
                One platform for every <span className="gold-text italic">place of learning.</span>
              </>
            }
            sub="Whether you run a university department, a school or a coaching institute, the same console handles authoring, delivery, grading and results."
          />
          <div className="mt-14 grid gap-5 md:grid-cols-3">
            {audiences.map((a) => (
              <div key={a.title} className="reveal">
                <Panel hover className="h-full p-7">
                  <span className="grid h-12 w-12 place-items-center rounded-2xl bg-gold-400/[0.1] text-gold-200 ring-1 ring-inset ring-gold-300/30">
                    <a.icon className="h-5 w-5" />
                  </span>
                  <h3 className="mt-6 font-display text-[23px] font-medium text-white">{a.title}</h3>
                  <p className="mt-2 text-[14.5px] leading-relaxed text-white/60">{a.lede}</p>
                  <ul className="mt-5 space-y-2.5 border-t border-white/[0.07] pt-5">
                    {a.points.map((point) => (
                      <li key={point} className="flex items-start gap-2.5 text-[14px] leading-snug text-white/75">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-gold-300" />
                        {point}
                      </li>
                    ))}
                  </ul>
                </Panel>
              </div>
            ))}
          </div>
        </section>

        {/* ── how it works ─────────────────────────────────── */}
        <section id="how" className="defer-paint mx-auto max-w-7xl px-5 py-24 sm:px-8 lg:py-28">
          <SectionIntro
            eyebrow="How it works"
            title={
              <>
                Three moves. <span className="gold-text italic">One live exam.</span>
              </>
            }
            sub="Parikshio is built around the shortest path between a question and a fair, defensible score."
            action={<Badge tone="royal">Real-time · server clock</Badge>}
          />
          <ol className="relative mt-14 grid gap-5 md:grid-cols-3">
            {/* Thread joining the three steps. */}
            <span
              aria-hidden="true"
              className="absolute left-[12%] right-[12%] top-[52px] hidden h-px bg-gradient-to-r from-transparent via-gold-200/35 to-transparent md:block"
            />
            {steps.map((step) => (
              <li key={step.n} className="reveal">
                <Panel hover className="relative h-full overflow-hidden p-7">
                  <div className="flex items-center justify-between">
                    <span className="relative grid h-12 w-12 place-items-center rounded-2xl bg-ink-850 text-gold-200 shadow-gold ring-1 ring-inset ring-gold-300/30">
                      <step.icon className="h-5 w-5" />
                    </span>
                    <span className="font-display text-[40px] italic leading-none text-white/[0.14]">{step.n}</span>
                  </div>
                  <h3 className="mt-7 font-display text-[23px] font-medium text-white">{step.title}</h3>
                  <p className="mt-3 text-[14.5px] leading-relaxed text-white/60">{step.body}</p>
                </Panel>
              </li>
            ))}
          </ol>
        </section>

        {/* ── exam modes ───────────────────────────────────── */}
        <section id="modes" className="defer-paint mx-auto max-w-7xl px-5 pb-24 sm:px-8 lg:pb-28">
          <SectionIntro
            eyebrow="Exam modes"
            title={
              <>
                Two ways to run an exam. <span className="gold-text italic">Switch any time.</span>
              </>
            }
            sub="Keep the whole room on the same question, or hand students a set to work through at their own pace — inside the same session."
          />
          <div className="mt-14 grid gap-5 lg:grid-cols-2">
            {modes.map((mode) => (
              <div key={mode.key} className="reveal">
                <Panel className={cx('relative h-full overflow-hidden p-7 sm:p-8', mode.key === 'set' && 'gold-edge')}>
                  <div className={cx('aura -right-24 -top-24 h-64 w-64', mode.key === 'set' ? 'aura-gold' : 'aura-royal')} />
                  <div className="relative flex flex-wrap items-center justify-between gap-3">
                    <span
                      className={cx(
                        'grid h-12 w-12 place-items-center rounded-2xl ring-1 ring-inset',
                        mode.key === 'set'
                          ? 'bg-gold-400/[0.1] text-gold-200 ring-gold-300/30'
                          : 'bg-royal-500/[0.14] text-royal-100 ring-royal-400/30'
                      )}
                    >
                      <mode.icon className="h-5 w-5" />
                    </span>
                    <Badge tone={mode.tone}>{mode.badge}</Badge>
                  </div>
                  <h3 className="relative mt-6 font-display text-[28px] font-medium text-white">{mode.title}</h3>
                  <p className="relative mt-2.5 text-[15px] leading-relaxed text-white/65">{mode.body}</p>
                  <ul className="relative mt-6 space-y-3">
                    {mode.points.map((point) => (
                      <li key={point} className="flex items-start gap-2.5 text-[14.5px] leading-snug text-white/80">
                        <Check className={cx('mt-0.5 h-4 w-4 shrink-0', mode.key === 'set' ? 'text-gold-300' : 'text-royal-300')} />
                        {point}
                      </li>
                    ))}
                  </ul>
                  <p className="relative mt-6 rounded-xl border border-white/[0.07] bg-ink-950/50 px-4 py-3 text-[13.5px] text-white/60">
                    <span className="font-semibold text-white/85">Best for:</span> {mode.best}
                  </p>
                </Panel>
              </div>
            ))}
          </div>
        </section>

        {/* ── features bento ───────────────────────────────── */}
        <section id="features" className="defer-paint mx-auto max-w-7xl px-5 pb-24 sm:px-8 lg:pb-28">
          <SectionIntro
            eyebrow="Features"
            title={
              <>
                Everything an invigilator needs,{' '}
                <span className="gold-text italic">nothing a student can break.</span>
              </>
            }
            sub="Authoring, delivery, grading and analytics share one data model — so a question written at 9:00 can be analysed at 9:20."
          />
          <div className="mt-14 grid gap-5 lg:grid-cols-3">
            {features.map((f) => (
              <div key={f.key} className={cx('reveal', f.span)}>
                <Panel hover className="group h-full p-7">
                  <span className="grid h-11 w-11 place-items-center rounded-xl bg-white/[0.05] text-gold-200 ring-1 ring-inset ring-white/10 transition duration-300 group-hover:bg-gold-400/[0.1] group-hover:ring-gold-300/35">
                    <f.icon className="h-5 w-5" />
                  </span>
                  <h3 className="mt-6 font-display text-[22px] font-medium leading-snug text-white">{f.title}</h3>
                  <p className="mt-2.5 text-[14.5px] leading-relaxed text-white/60">{f.body}</p>

                  {f.key === 'bank' && (
                    <div className="mt-6 grid gap-2 sm:grid-cols-3">
                      {[
                        { icon: ListChecks, label: 'MCQ · 4 options', meta: '45s', tone: 'text-royal-200' },
                        { icon: Type, label: 'Fill in the blank', meta: '30s · typo-tolerant', tone: 'text-gold-200' },
                        { icon: PenLine, label: 'Long answer', meta: '4 min · reviewed', tone: 'text-ember-300' }
                      ].map((row) => (
                        <div key={row.label} className="rounded-xl border border-white/[0.07] bg-ink-950/50 px-3.5 py-3">
                          <div className="flex items-center justify-between">
                            <row.icon className={cx('h-4 w-4', row.tone)} />
                            <Check className="h-3.5 w-3.5 text-mint-400" />
                          </div>
                          <p className="mt-2.5 text-[13px] font-medium text-white/85">{row.label}</p>
                          <p className="mt-0.5 text-[12px] text-white/50">{row.meta}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {f.key === 'timers' && (
                    <div className="mt-6 space-y-2.5 rounded-xl border border-white/[0.07] bg-ink-950/50 p-3.5">
                      {[
                        { label: 'Recall', time: '0:20', pct: 30, color: 'bg-mint-400' },
                        { label: 'Application', time: '1:30', pct: 62, color: 'bg-gold-300' },
                        { label: 'Derivation', time: '4:00', pct: 100, color: 'bg-royal-400' }
                      ].map((row) => (
                        <div key={row.label}>
                          <div className="mb-1 flex items-center justify-between text-[12px]">
                            <span className="text-white/65">{row.label}</span>
                            <span className="num font-medium text-white/85">{row.time}</span>
                          </div>
                          <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
                            <div className={cx('h-full rounded-full', row.color)} style={{ width: `${row.pct}%` }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {f.key === 'analytics' && (
                    <div className="mt-6 rounded-xl border border-white/[0.07] bg-ink-950/50 p-3.5">
                      <div className="mb-2 flex items-center justify-between text-[11px] uppercase tracking-[0.14em] text-white/50">
                        <span>accuracy by question</span>
                        <span className="text-mint-300">sample</span>
                      </div>
                      <Sparkline points={[38, 44, 41, 55, 62, 58, 71, 78, 74, 86]} />
                    </div>
                  )}
                </Panel>
              </div>
            ))}
          </div>
        </section>

        {/* ── analytics spotlight ──────────────────────────── */}
        <section id="analytics" className="defer-paint relative mx-auto max-w-7xl px-5 pb-24 sm:px-8 lg:pb-28">
          <div className="reveal panel gold-edge overflow-hidden">
            <div className="grid gap-10 p-7 sm:p-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-center lg:p-12 [&>*]:min-w-0">
              <div>
                <p className="eyebrow eyebrow-rule">Analytics</p>
                <h2 className="mt-4 font-display text-[2rem] font-normal leading-[1.1] text-white sm:text-[2.5rem]">
                  Know which question broke the room —{' '}
                  <span className="gold-text italic">while it is still live.</span>
                </h2>
                <p className="mt-5 text-[15.5px] leading-relaxed text-white/60">
                  Every submission records how long it took. Parikshio turns that into signal: accuracy per question, per
                  format and per cohort, plus the option distribution that shows exactly which distractor is catching
                  students.
                </p>
                <ul className="mt-7 space-y-3.5">
                  {[
                    'Accuracy, completion and average score per session',
                    'Answer-time patterns that separate recall from reasoning',
                    'Top performers ranked by accuracy, then speed'
                  ].map((line) => (
                    <li key={line} className="flex items-start gap-3 text-[14.5px] text-white/75">
                      <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-gold-400/15 text-gold-200 ring-1 ring-inset ring-gold-300/30">
                        <Check className="h-3 w-3" />
                      </span>
                      {line}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded-2xl border border-white/[0.08] bg-ink-950/60 p-5 shadow-lift sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-display text-[17px] font-medium text-white">Quantum Foundations — Live Sprint</p>
                    <p className="mt-0.5 text-[12.5px] text-white/50">Sample report · Physics · 6 questions</p>
                  </div>
                  <LivePill label="ended" tone="glass" />
                </div>
                <div className="mt-5 grid grid-cols-3 gap-2.5">
                  {[
                    { k: '82%', v: 'accuracy' },
                    { k: '9', v: 'participants' },
                    { k: '18.4s', v: 'avg time' }
                  ].map((s) => (
                    <div key={s.v} className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-3">
                      <p className="num text-[19px] font-semibold text-white">{s.k}</p>
                      <p className="mt-0.5 text-[10.5px] uppercase tracking-[0.12em] text-white/50">{s.v}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-5 grid gap-5 sm:grid-cols-[1.3fr_auto] sm:items-center">
                  <div>
                    <p className="mb-2.5 text-[11px] uppercase tracking-[0.14em] text-white/50">attempts per question</p>
                    <BarChart
                      height={100}
                      accent={chartColors.royal}
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
          </div>
        </section>

        {/* ── roles ────────────────────────────────────────── */}
        <section id="roles" className="defer-paint mx-auto max-w-7xl px-5 pb-24 sm:px-8 lg:pb-28">
          <SectionIntro
            eyebrow="Two roles"
            title={
              <>
                Faculty run it. <span className="gold-text italic">Students focus.</span>
              </>
            }
            sub="Each login carries its role, and every request checks it. Students never receive an answer key; faculty never lose control of the room."
          />
          <div className="mt-14 grid gap-5 lg:grid-cols-2">
            {[
              {
                title: 'Faculty & admins',
                sub: 'The control room',
                badge: 'full access',
                tone: 'gold' as const,
                icon: Lock,
                rights: adminRights,
                aura: 'aura-gold',
                check: 'text-gold-300',
                tile: 'bg-gold-400/[0.1] text-gold-200 ring-gold-300/30'
              },
              {
                title: 'Students',
                sub: 'The exam room',
                badge: 'own paper only',
                tone: 'royal' as const,
                icon: Users,
                rights: studentRights,
                aura: 'aura-royal',
                check: 'text-royal-300',
                tile: 'bg-royal-500/[0.14] text-royal-100 ring-royal-400/30'
              }
            ].map((role) => (
              <div key={role.title} className="reveal">
                <Panel className="relative h-full overflow-hidden p-7 sm:p-8">
                  <div className={cx('aura -right-20 -top-20 h-56 w-56', role.aura)} />
                  <div className="relative flex items-center justify-between gap-3">
                    <div className="flex items-center gap-4">
                      <span className={cx('grid h-12 w-12 place-items-center rounded-2xl ring-1 ring-inset', role.tile)}>
                        <role.icon className="h-5 w-5" />
                      </span>
                      <div>
                        <p className="font-display text-[22px] font-medium text-white">{role.title}</p>
                        <p className="text-[13px] text-white/55">{role.sub}</p>
                      </div>
                    </div>
                    <Badge tone={role.tone}>{role.badge}</Badge>
                  </div>
                  <ul className="relative mt-7 grid gap-3 sm:grid-cols-2">
                    {role.rights.map((r) => (
                      <li key={r} className="flex items-start gap-2.5 text-[14px] leading-snug text-white/70">
                        <Check className={cx('mt-0.5 h-4 w-4 shrink-0', role.check)} />
                        {r}
                      </li>
                    ))}
                  </ul>
                </Panel>
              </div>
            ))}
          </div>
        </section>

        {/* ── exam day ─────────────────────────────────────── */}
        <section className="defer-paint mx-auto max-w-7xl px-5 pb-24 sm:px-8 lg:pb-28">
          <SectionIntro
            eyebrow="Trust & integrity"
            title={
              <>
                Built for <span className="gold-text italic">exam day.</span>
              </>
            }
            sub="The details that keep a live exam fair, handled for you."
          />
          <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {examDay.map((item) => (
              <div key={item.title} className="reveal">
                <Panel className="h-full p-6">
                  <span className="grid h-11 w-11 place-items-center rounded-xl bg-gold-400/[0.09] text-gold-200 ring-1 ring-inset ring-gold-300/25">
                    <item.icon className="h-5 w-5" />
                  </span>
                  <h3 className="mt-5 text-[16px] font-semibold text-white">{item.title}</h3>
                  <p className="mt-2 text-[14px] leading-relaxed text-white/60">{item.body}</p>
                </Panel>
              </div>
            ))}
          </div>
        </section>

        {/* ── FAQ ──────────────────────────────────────────── */}
        <section id="faq" className="defer-paint mx-auto max-w-7xl px-5 pb-24 sm:px-8 lg:pb-28">
          <div className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr] [&>*]:min-w-0">
            <div className="reveal lg:sticky lg:top-28 lg:self-start">
              <p className="eyebrow eyebrow-rule">Questions, answered</p>
              <h2 className="mt-4 font-display text-[2.1rem] font-normal leading-[1.08] text-white sm:text-[2.6rem]">
                Everything you need to know <span className="gold-text italic">before exam day.</span>
              </h2>
              <p className="mt-4 max-w-md text-[15.5px] leading-relaxed text-white/60">
                For students, faculty and the administrators who set the institute up.
              </p>
              <div className="mt-7 space-y-3 text-[14.5px]">
                <Link
                  href="/contact"
                  className="focus-ring group inline-flex items-center gap-2 rounded-lg font-medium text-gold-200 transition hover:text-gold-100"
                >
                  Ask us anything
                  <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
                </Link>
                <p className="flex items-center gap-2 text-white/55">
                  <Mail className="h-4 w-4 text-gold-300/70" />
                  <MailLink className="focus-ring rounded transition hover:text-white" />
                </p>
              </div>
            </div>
            <div className="reveal space-y-3">
              {faqs.map((item) => (
                <details
                  key={item.q}
                  className="group rounded-2xl border border-white/[0.08] bg-ink-900/60 transition open:border-gold-200/25 open:bg-ink-880/80"
                >
                  <summary className="focus-ring flex cursor-pointer list-none items-center justify-between gap-4 rounded-2xl px-5 py-4 text-[15.5px] font-medium text-white/90 transition hover:text-white sm:px-6 [&::-webkit-details-marker]:hidden">
                    {item.q}
                    <ChevronDown className="h-5 w-5 shrink-0 text-gold-200/70 transition duration-300 group-open:rotate-180" />
                  </summary>
                  <p className="px-5 pb-5 text-[14.5px] leading-relaxed text-white/65 sm:px-6">{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* ── call to action ───────────────────────────────── */}
        <section className="defer-paint mx-auto max-w-7xl px-5 pb-24 sm:px-8">
          <div className="reveal gold-edge relative overflow-hidden rounded-4xl border border-white/[0.08] bg-gradient-to-br from-royal-600/25 via-ink-880 to-gold-600/10 p-8 sm:p-12 lg:p-14">
            <div className="absolute inset-0 dot-veil opacity-40" />
            <Seal className="pointer-events-none absolute -right-14 -top-14 hidden h-80 w-80 opacity-40 md:block" />
            <div className="relative max-w-2xl">
              <LivePill label="now live" />
              <h2 className="mt-5 font-display text-[2.1rem] font-normal leading-[1.08] text-white sm:text-[3rem]">
                Ready when <span className="gold-text italic">your class is.</span>
              </h2>
              <p className="mt-4 max-w-lg text-[15.5px] leading-relaxed text-white/60">
                Students can create an account in a minute. Bringing Parikshio to your whole institute? Talk to us and we
                will help you set up faculty accounts.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-4">
                <LinkButton href="/signup" size="lg" variant="gold" className="px-7">
                  Get started
                  <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
                </LinkButton>
                <Link
                  href="/contact?topic=onboarding"
                  className="focus-ring group inline-flex items-center gap-2 rounded-lg text-[14.5px] font-medium text-white/75 transition hover:text-white"
                >
                  Talk to us about your institute
                  <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
