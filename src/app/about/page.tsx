import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowRight,
  BarChart3,
  Building2,
  CloudOff,
  EyeOff,
  FileUp,
  Gavel,
  GraduationCap,
  KeyRound,
  Layers,
  Lock,
  Mail,
  MessageSquareText,
  Radio,
  School,
  ServerCog,
  ShieldCheck,
  Sparkles,
  Timer,
  UserCheck
} from 'lucide-react';
import { MailLink } from '@/components/site/MailLink';
import { PublicPage } from '@/components/site/PublicPage';
import { LinkButton } from '@/components/ui/Button';
import { CONTACT_EMAIL, SITE_DESCRIPTION, SITE_DOMAIN, SITE_NAME, SITE_URL, SOCIAL_LINKS } from '@/lib/site';

/*
 * Every statement on this page describes something the product does today
 * (see the landing page, the privacy policy, the terms and the server code).
 * No customer counts, awards or certifications are claimed.
 */

const DESCRIPTION =
  'Parikshio is a live assessment platform for universities, colleges, schools and coaching institutes: question papers, live exams on a server-synced timer, instant and AI-assisted grading, and analytics in one secure workflow.';

export const metadata: Metadata = {
  title: 'About',
  description: DESCRIPTION,
  alternates: { canonical: '/about' },
  openGraph: {
    title: `About ${SITE_NAME}`,
    description: DESCRIPTION,
    url: '/about',
    type: 'website'
  }
};

const facts = [
  { value: '5', label: 'question formats' },
  { value: '2', label: 'exam modes' },
  { value: '1', label: 'server clock for every student' },
  { value: '0', label: 'apps to install' }
];

const audiences = [
  {
    icon: Building2,
    title: 'Universities and colleges',
    body: 'Faculty accounts are set up for approved teachers, and hundreds of students can join one session with a single code.'
  },
  {
    icon: School,
    title: 'Schools',
    body: 'Run class tests and unit exams on any phone or laptop, and link sessions to Google Classroom to match rosters and post grades.'
  },
  {
    icon: GraduationCap,
    title: 'Coaching and training institutes',
    body: 'Push timed practice papers to a whole batch, rank results by accuracy and speed, and see which topics need more work.'
  }
];

const capabilities = [
  {
    icon: FileUp,
    title: 'Papers in minutes',
    body: 'Write questions in a reusable bank, or upload a PDF, Word file, photo or text. Questions, options, marks and answer keys are detected and imported for review.'
  },
  {
    icon: Radio,
    title: 'Two ways to run an exam',
    body: 'Live push puts one question on every screen at once. A self-paced set lets students choose the order, with each question timed from the moment it is opened.'
  },
  {
    icon: Timer,
    title: 'One fair deadline',
    body: 'Timers run on the server clock, not the device. Every student gets the same time, and answers lock when it ends.'
  },
  {
    icon: CloudOff,
    title: 'Built for real networks',
    body: 'If the connection drops, an answer is saved on the device and delivered when it is back online. The server timer keeps running throughout.'
  },
  {
    icon: Sparkles,
    title: 'Grading that keeps up',
    body: 'Objective answers are graded the instant they arrive. Written answers can be scored by AI, and anything uncertain is flagged for faculty to review.'
  },
  {
    icon: BarChart3,
    title: 'Results worth reading',
    body: 'A live leaderboard, accuracy per question, answer-time patterns and option spread, with CSV export for your own records.'
  }
];

const steps = [
  { title: 'Create', body: 'Build the paper from the question bank or upload an existing one.' },
  { title: 'Deliver', body: 'Share a short join code and push questions live on one timer.' },
  { title: 'Grade', body: 'Answers are graded as they land; faculty confirm anything written.' },
  { title: 'Improve', body: 'Use the analytics to see what the class understood and what to revisit.' }
];

const security = [
  { icon: Lock, text: 'Passwords are stored only as bcrypt hashes, never as typed, and every connection is encrypted (HTTPS).' },
  { icon: UserCheck, text: 'Students sign up themselves; faculty accounts are created on request, so only approved teachers can run exams.' },
  {
    icon: Layers,
    text: 'Each teacher sees only their own question bank, sessions and results. Students see only their own answers and the sessions they joined with a code.'
  },
  { icon: KeyRound, text: 'Correct answers stay on the server while an exam is running and never reach a student device.' },
  { icon: ShieldCheck, text: 'Sign-ins expire after 12 hours, password-reset links work once and expire after 30 minutes, and repeated failed attempts are blocked.' },
  { icon: ServerCog, text: 'Sign-ins and sensitive actions are written to a security log, and Google Classroom tokens are encrypted with AES-256-GCM.' }
];

const commitments = [
  { icon: EyeOff, text: 'No ads, no tracking cookies, and personal data is never sold.' },
  { icon: Sparkles, text: 'AI grading receives the question and the answer text, never the student’s name or email.' },
  { icon: Gavel, text: 'Results, including any AI-suggested score, are decided by faculty and the institute.' },
  { icon: Mail, text: 'You can ask for a copy of your data, or for it to be deleted, at any time.' }
];

/** Organisation and page details for search engines (schema.org). */
function structuredData() {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': `${SITE_URL}/#organization`,
        name: SITE_NAME,
        url: SITE_URL,
        logo: `${SITE_URL}/brand/parikshio-mark-1024.png`,
        description: SITE_DESCRIPTION,
        email: CONTACT_EMAIL,
        contactPoint: [{ '@type': 'ContactPoint', contactType: 'customer support', email: CONTACT_EMAIL }],
        sameAs: SOCIAL_LINKS.filter((s) => s.network !== 'whatsapp').map((s) => s.href)
      },
      {
        '@type': 'AboutPage',
        '@id': `${SITE_URL}/about#webpage`,
        url: `${SITE_URL}/about`,
        name: `About ${SITE_NAME}`,
        description: DESCRIPTION,
        about: { '@id': `${SITE_URL}/#organization` },
        inLanguage: 'en-IN'
      }
    ]
  };
}

function SectionHeading({ id, eyebrow, title, body }: { id: string; eyebrow: string; title: string; body?: string }) {
  return (
    <div className="max-w-3xl">
      <p className="eyebrow eyebrow-rule">{eyebrow}</p>
      <h2 id={id} className="mt-4 font-display text-[1.9rem] font-normal leading-tight text-white sm:text-[2.3rem]">
        {title}
      </h2>
      {body && <p className="mt-4 text-[15.5px] leading-relaxed text-white/60">{body}</p>}
    </div>
  );
}

function IconCard({ icon: Icon, title, body, tone = 'gold' }: { icon: typeof Lock; title: string; body: string; tone?: 'gold' | 'royal' }) {
  return (
    <article className="panel p-6 sm:p-7">
      <span
        className={
          tone === 'royal'
            ? 'grid h-11 w-11 place-items-center rounded-2xl bg-royal-500/[0.12] text-royal-100 ring-1 ring-inset ring-royal-400/30'
            : 'grid h-11 w-11 place-items-center rounded-2xl bg-gold-400/[0.09] text-gold-200 ring-1 ring-inset ring-gold-300/25'
        }
      >
        <Icon className="h-5 w-5" />
      </span>
      <h3 className="mt-5 font-display text-[20px] font-medium text-white">{title}</h3>
      <p className="mt-2 text-[14.5px] leading-relaxed text-white/60">{body}</p>
    </article>
  );
}

export default function AboutPage() {
  return (
    <PublicPage>
      <script
        type="application/ld+json"
        // Static, server-built JSON with no user input; `<` is escaped so it can never close the tag.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData()).replace(/</g, '\\u003c') }}
      />

      <div className="mx-auto max-w-7xl px-5 pb-24 pt-10 sm:px-8 sm:pt-16 lg:pb-28">
        {/* ── Who we are ─────────────────────────────────────────── */}
        <section aria-labelledby="about-title" className="max-w-3xl animate-fadeUp">
          <p className="eyebrow eyebrow-rule">About {SITE_NAME}</p>
          <h1 id="about-title" className="mt-5 font-display text-[2.5rem] font-normal leading-[1.06] text-white sm:text-[3.3rem]">
            Fair exams, run live.
            <br />
            <span className="gold-text italic">Results you can trust.</span>
          </h1>
          <p className="mt-5 max-w-2xl text-[16px] leading-relaxed text-white/65">
            {SITE_NAME} is a live assessment platform for universities, colleges, schools and coaching institutes. It brings
            question papers, live exam delivery, grading and performance analytics into one dependable workflow, so teachers
            spend less time managing exams and more time teaching.
          </p>
          <p className="mt-3 max-w-2xl text-[14px] leading-relaxed text-white/45">
            The name comes from <span lang="hi" className="text-gold-200/80">परीक्षा</span> (pariksha), the Hindi word for an
            examination.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <LinkButton href="/signup" variant="gold" size="lg">
              Get started
              <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
            </LinkButton>
            <LinkButton href="/contact?topic=onboarding" variant="secondary" size="lg">
              <MessageSquareText className="h-4 w-4" />
              Bring {SITE_NAME} to your institute
            </LinkButton>
          </div>
        </section>

        <dl className="mt-14 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {facts.map((f) => (
            <div key={f.label} className="panel px-5 py-5 sm:px-6">
              <dt className="sr-only">{f.label}</dt>
              <dd>
                <span className="num block font-display text-[2.2rem] leading-none text-gold-200">{f.value}</span>
                <span className="mt-2 block text-[13.5px] leading-snug text-white/60">{f.label}</span>
              </dd>
            </div>
          ))}
        </dl>

        {/* ── Why it exists ──────────────────────────────────────── */}
        <section aria-labelledby="mission" className="mt-24 max-w-3xl">
          <SectionHeading id="mission" eyebrow="Our mission" title="Make every assessment fair, fast and useful" />
          <div className="mt-5 space-y-4 text-[15.5px] leading-relaxed text-white/60">
            <p>
              Running a test should not mean printing papers, chasing late submissions or spending a weekend marking. Online
              forms help, but they rely on each student&apos;s device clock, lose answers when the network drops and leave
              written answers waiting for days.
            </p>
            <p>
              {SITE_NAME} was built to fix exactly that. The server keeps one clock for the whole room, answers are protected
              even on a weak connection, and grading starts the moment an answer arrives. Teachers stay in control of every
              result; students get a calm, consistent exam on whatever device they have.
            </p>
          </div>
        </section>

        {/* ── Who it is for ──────────────────────────────────────── */}
        <section aria-labelledby="audiences" className="mt-24">
          <SectionHeading
            id="audiences"
            eyebrow="Who it is for"
            title="Made for the way institutes run exams"
            body="From a ten-minute class quiz to an institute-wide test, the same workflow scales with you."
          />
          <div className="mt-10 grid gap-4 md:grid-cols-3 md:gap-5">
            {audiences.map((a) => (
              <IconCard key={a.title} {...a} tone="royal" />
            ))}
          </div>
        </section>

        {/* ── What it does ───────────────────────────────────────── */}
        <section aria-labelledby="capabilities" className="mt-24">
          <SectionHeading id="capabilities" eyebrow="What Parikshio does" title="Everything an exam needs, in one place" />
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 lg:gap-5">
            {capabilities.map((c) => (
              <IconCard key={c.title} {...c} />
            ))}
          </div>

          <div className="gold-edge panel relative mt-8 overflow-hidden p-7 sm:p-10">
            <p className="eyebrow">How an exam runs</p>
            <ol className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-4" aria-label="The Parikshio workflow">
              {steps.map((step, i) => (
                <li key={step.title}>
                  <span className="flex items-center gap-3">
                    <span className="num grid h-8 w-8 place-items-center rounded-full bg-gold-400/[0.1] text-[13px] font-semibold text-gold-100 ring-1 ring-inset ring-gold-300/30">
                      {i + 1}
                    </span>
                    <span className="font-display text-[19px] text-white">{step.title}</span>
                  </span>
                  <p className="mt-2.5 text-[14px] leading-relaxed text-white/60">{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ── Security and privacy ───────────────────────────────── */}
        <section aria-labelledby="trust" className="mt-24">
          <SectionHeading
            id="trust"
            eyebrow="Security and privacy"
            title="Student data is protected by design"
            body="Exams decide grades and hold students’ personal details, so every account, answer and answer key is handled with care. These measures are in place today."
          />
          <div className="mt-10 grid gap-5 lg:grid-cols-[1.25fr_1fr]">
            <ul className="grid gap-3 sm:grid-cols-2" aria-label="Security measures">
              {security.map(({ icon: Icon, text }) => (
                <li key={text} className="flex gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4">
                  <Icon className="mt-0.5 h-[18px] w-[18px] shrink-0 text-mint-300" />
                  <span className="text-[14px] leading-relaxed text-white/70">{text}</span>
                </li>
              ))}
            </ul>
            <div className="panel flex flex-col p-6 sm:p-7">
              <h3 className="font-display text-[19px] text-white">Our commitments</h3>
              <ul className="mt-4 space-y-3.5">
                {commitments.map(({ icon: Icon, text }) => (
                  <li key={text} className="flex gap-3">
                    <Icon className="mt-0.5 h-[18px] w-[18px] shrink-0 text-gold-300" />
                    <span className="text-[14px] leading-relaxed text-white/70">{text}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-6 flex flex-wrap gap-2.5 border-t border-white/[0.07] pt-5">
                <Link
                  href="/privacy"
                  className="focus-ring group inline-flex items-center gap-1.5 rounded-xl border border-white/[0.08] bg-white/[0.02] px-3.5 py-2 text-[13.5px] text-white/85 transition hover:border-gold-200/30"
                >
                  Privacy policy <ArrowRight className="h-3.5 w-3.5 text-gold-300 transition group-hover:translate-x-0.5" />
                </Link>
                <Link
                  href="/terms"
                  className="focus-ring group inline-flex items-center gap-1.5 rounded-xl border border-white/[0.08] bg-white/[0.02] px-3.5 py-2 text-[13.5px] text-white/85 transition hover:border-gold-200/30"
                >
                  Terms of use <ArrowRight className="h-3.5 w-3.5 text-gold-300 transition group-hover:translate-x-0.5" />
                </Link>
              </div>
              <p className="mt-4 text-[12.5px] leading-relaxed text-white/45">
                Our terms are governed by the laws of India. No system is perfectly secure: if you find a security problem,
                write to <MailLink className="focus-ring rounded text-gold-200 underline-offset-2 hover:underline" /> so we can
                look into it.
              </p>
            </div>
          </div>
        </section>

        {/* ── Contact ────────────────────────────────────────────── */}
        <section aria-labelledby="contact" className="gold-edge panel relative mt-24 overflow-hidden p-7 sm:p-10">
          <div className="grid gap-8 lg:grid-cols-[1.2fr_1fr] lg:items-center">
            <div>
              <p className="eyebrow">Get in touch</p>
              <h2 id="contact" className="mt-3 font-display text-[1.8rem] font-normal leading-tight text-white">
                Talk to the {SITE_NAME} team
              </h2>
              <p className="mt-3 text-[14.5px] leading-relaxed text-white/60">
                Onboarding an institute, faculty access, a problem during an exam or a question about your data: write to us
                and we reply from our support inbox.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <LinkButton href="/contact" variant="gold">
                  <MessageSquareText className="h-4 w-4" /> Contact us
                </LinkButton>
                <LinkButton href="/contact?topic=faculty" variant="secondary">
                  Request faculty access
                </LinkButton>
              </div>
            </div>
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4">
                <dt className="flex items-center gap-2 text-[11.5px] font-semibold uppercase tracking-[0.12em] text-white/45">
                  <Mail className="h-3.5 w-3.5" /> Email
                </dt>
                <dd className="mt-1.5 break-all text-[14.5px] text-white/90">
                  <MailLink className="focus-ring rounded hover:text-gold-200" />
                </dd>
              </div>
              <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4">
                <dt className="flex items-center gap-2 text-[11.5px] font-semibold uppercase tracking-[0.12em] text-white/45">
                  <Building2 className="h-3.5 w-3.5" /> Website
                </dt>
                <dd className="mt-1.5 text-[14.5px] text-white/90">{SITE_DOMAIN}</dd>
              </div>
            </dl>
          </div>
        </section>
      </div>
    </PublicPage>
  );
}
