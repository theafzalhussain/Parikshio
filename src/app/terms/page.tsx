import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalPage, type LegalSection } from '@/components/site/LegalPage';
import { MailLink } from '@/components/site/MailLink';
import { SITE_DOMAIN } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Terms of use',
  description: 'The rules for using Parikshio as a student, a member of faculty or an institute.',
  alternates: { canonical: '/terms' }
};

const mail = <MailLink />;

const sections: LegalSection[] = [
  {
    id: 'about',
    title: 'About these terms',
    body: (
      <>
        <p>
          These terms apply when you use Parikshio at {SITE_DOMAIN}, whether as a student, a member of faculty or on behalf
          of an institute. By creating an account or using Parikshio you agree to them. If you use Parikshio for an
          institute, you confirm that you may agree to these terms on its behalf.
        </p>
        <p>
          How we handle personal data is explained in the <Link href="/privacy">Privacy policy</Link>.
        </p>
      </>
    )
  },
  {
    id: 'accounts',
    title: 'Accounts',
    body: (
      <ul>
        <li>Students can create their own account. Faculty and admin accounts are created on request.</li>
        <li>Give accurate details and keep your password private. You are responsible for activity on your account.</li>
        <li>One person per account: do not share your account or log in as someone else.</li>
        <li>Tell us at {mail} if you think someone else has used your account.</li>
      </ul>
    )
  },
  {
    id: 'exams',
    title: 'Exams and fair play',
    body: (
      <ul>
        <li>
          Faculty decide how each exam runs: the questions, the timers, whether students see a leaderboard, and what is
          shown after the exam ends.
        </li>
        <li>
          Timers run on Parikshio’s server. Answers saved while a device is offline are sent when it reconnects, but an
          answer that arrives after its question has closed may not count.
        </li>
        <li>During a live session, leaving the exam tab is reported to the faculty running it.</li>
        <li>
          Results, including any grade suggested by AI for a written answer, are decided by the faculty and institute,
          who can review and change them. Parikshio is a tool for running exams and does not decide academic outcomes.
        </li>
      </ul>
    )
  },
  {
    id: 'acceptable-use',
    title: 'Acceptable use',
    body: (
      <>
        <p>When using Parikshio you must not:</p>
        <ul>
          <li>try to access accounts, exams, answer keys or data that are not yours;</li>
          <li>interfere with or overload the service, or try to get around its timers, limits or security;</li>
          <li>use bots, scrapers or other automated tools against Parikshio;</li>
          <li>upload anything unlawful, infringing or harmful, including malware;</li>
          <li>harass other people, or use the contact form to send spam.</li>
        </ul>
      </>
    )
  },
  {
    id: 'content',
    title: 'Your content',
    body: (
      <ul>
        <li>Questions, papers and answers you add remain yours or your institute’s.</li>
        <li>
          You allow us to store, process and display them only to run Parikshio for you, for example showing questions to
          the students in your sessions and their answers to you.
        </li>
        <li>Only upload material you have the right to use.</li>
      </ul>
    )
  },
  {
    id: 'availability',
    title: 'Availability and changes',
    body: (
      <>
        <p>
          We work to keep Parikshio available and accurate, but it is provided “as is”, without a promise that it will be
          uninterrupted or error-free. Network problems on a student’s or an institute’s side can affect an exam.
        </p>
        <p>We may change, add or remove features, and may pause access briefly for maintenance or security.</p>
      </>
    )
  },
  {
    id: 'liability',
    title: 'Liability',
    body: (
      <p>
        To the extent the law allows, Parikshio is not liable for indirect or consequential losses, or for losses caused by
        events outside our reasonable control, such as network or power outages. Nothing in these terms limits liability
        that cannot be limited by law.
      </p>
    )
  },
  {
    id: 'ending',
    title: 'Suspension and closing your account',
    body: (
      <p>
        You can stop using Parikshio at any time and ask us to delete your account by emailing {mail}. We may suspend or
        close accounts that break these terms or put other users at risk.
      </p>
    )
  },
  {
    id: 'governing-law',
    title: 'Governing law',
    body: <p>These terms are governed by the laws of India.</p>
  },
  {
    id: 'changes',
    title: 'Changes to these terms',
    body: (
      <p>
        We may update these terms. The date at the top shows when they last changed, and continuing to use Parikshio after
        a change means you accept the updated terms.
      </p>
    )
  },
  {
    id: 'contact',
    title: 'Contact',
    body: (
      <p>
        Questions about these terms? Email {mail} or use the <Link href="/contact">contact form</Link>.
      </p>
    )
  }
];

export default function TermsPage() {
  return (
    <LegalPage
      eyebrow="Legal"
      title="Terms of use"
      updated="29 October 2026"
      updatedIso="2026-10-29"
      intro={<p>The rules for using Parikshio, in plain language. Please read them before you create an account.</p>}
      sections={sections}
    />
  );
}
