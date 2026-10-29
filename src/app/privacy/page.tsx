import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalPage, type LegalSection } from '@/components/site/LegalPage';
import { MailLink } from '@/components/site/MailLink';
import { SITE_DOMAIN } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Privacy policy',
  description: 'What Parikshio collects, why, who can see it and how to ask for a copy or deletion of your data.',
  alternates: { canonical: '/privacy' }
};

const mail = <MailLink />;

/*
 * Every statement below describes what the code actually does (see server/
 * and src/lib/). Update this page in the same change as any new data flow.
 */
const sections: LegalSection[] = [
  {
    id: 'who-we-are',
    title: 'Who we are',
    body: (
      <>
        <p>
          Parikshio ({SITE_DOMAIN}) is an online platform for running live exams. In this policy “Parikshio”, “we” and
          “us” mean the team that operates it. You can reach us at {mail}.
        </p>
        <p>
          Institutes and teachers decide how they use Parikshio for their own exams, for example who takes part and what
          students see after an exam ends.
        </p>
      </>
    )
  },
  {
    id: 'what-we-collect',
    title: 'What we collect',
    body: (
      <ul>
        <li>
          <strong>Account details:</strong> your name, email address, role (student or faculty) and, if you add it, your
          institute or class. Your password is never stored as typed; we keep only a bcrypt hash of it.
        </li>
        <li>
          <strong>Google sign-in:</strong> if you continue with Google, we receive your name, email address, Google account
          ID, profile photo link and whether Google has verified the address. We never see your Google password.
        </li>
        <li>
          <strong>Exam activity:</strong> the exams you join, your answers, scores and grades, and timings such as when a
          question opened for you and how long you took to answer.
        </li>
        <li>
          <strong>Exam integrity alerts:</strong> during a live session, the faculty running it are alerted when your exam
          tab is hidden, for example when you switch to another tab or app.
        </li>
        <li>
          <strong>Messages you send us:</strong> through the contact form we receive your name, email address, role,
          institute, topic and message, and for feedback an optional rating. We email you a confirmation with a copy of
          the message and a reference number.
        </li>
        <li>
          <strong>Security records:</strong> a log of sign-ins and sensitive actions, such as password resets, with the IP
          address they came from. IP and email addresses are also counted for a short time to block repeated failed
          attempts.
        </li>
        <li>
          <strong>Faculty content:</strong> questions, answer keys and papers you upload. Uploaded files are read in memory
          to extract questions; we keep the questions, the file name and a text preview, not the original file.
        </li>
        <li>
          <strong>Google Classroom (faculty, optional):</strong> if you connect Classroom, we store your Google account
          email, the courses you link and an encrypted access token, and we read course rosters (student names and emails)
          to match students and post their exam scores back to the course.
        </li>
      </ul>
    )
  },
  {
    id: 'how-we-use-it',
    title: 'How we use it',
    body: (
      <>
        <ul>
          <li>to create and protect your account and keep you logged in;</li>
          <li>
            to run exams: deliver questions, keep everyone on the same server-side timer, grade answers and show results;
          </li>
          <li>to show leaderboards and answer reviews when the faculty running a session turns them on;</li>
          <li>to send password reset emails, to send you a copy of any message you write to us, and to reply to it;</li>
          <li>to detect and stop abuse, such as repeated failed sign-ins.</li>
        </ul>
        <p>We do not sell personal data, we do not show ads, and we do not use analytics or advertising trackers.</p>
      </>
    )
  },
  {
    id: 'who-can-see-it',
    title: 'Who can see your data',
    body: (
      <>
        <ul>
          <li>
            <strong>Faculty and admin accounts</strong> can see students’ answers, scores, timings and tab alerts, and the
            security log. This is why faculty accounts are created only on request.
          </li>
          <li>
            <strong>Other students</strong> see names and scores on the leaderboard only when the faculty turns the
            leaderboard on for that session.
          </li>
          <li>
            <strong>Service providers</strong> that run Parikshio for us, only for that purpose: Vercel (website hosting),
            Render (application server), our MongoDB database and Redis cache hosting, and Brevo (delivery of password reset
            emails, contact messages and their confirmations).
          </li>
          <li>
            <strong>Google</strong>, for three features: Firebase handles Google sign-in; Gemini helps grade written answers
            when AI grading is used, receiving the question, the reference answer and the answer text without your name or
            email; and Google Classroom, when faculty connect it.
          </li>
        </ul>
        <p>
          These providers may process data outside India, for example in Singapore, the European Union or the United
          States. We may also disclose information when the law requires it.
        </p>
      </>
    )
  },
  {
    id: 'in-your-browser',
    title: 'What is stored in your browser',
    body: (
      <>
        <ul>
          <li>a login token in your browser’s local storage, which expires after 12 hours or when you log out;</li>
          <li>answers saved while your device was offline, kept on that device until they are delivered.</li>
        </ul>
        <p>Parikshio does not use cookies for tracking or advertising.</p>
      </>
    )
  },
  {
    id: 'security',
    title: 'How we protect it',
    body: (
      <>
        <ul>
          <li>passwords are hashed with bcrypt, and every request is checked against the logged-in role;</li>
          <li>answer keys stay on the server and are never sent to student devices during an exam;</li>
          <li>password reset links expire after 30 minutes and work only once;</li>
          <li>Google Classroom tokens are encrypted (AES-256-GCM) before they are stored;</li>
          <li>connections to Parikshio use HTTPS.</li>
        </ul>
        <p>
          No system is perfectly secure. If you think someone has used your account, reset your password and tell us at{' '}
          {mail}.
        </p>
      </>
    )
  },
  {
    id: 'retention',
    title: 'How long we keep it',
    body: (
      <p>
        We keep your account and exam records while your account exists, because institutes rely on exam results. Contact
        messages are kept so we can follow up on them, and security records so we can investigate misuse. You can ask us to
        delete your data at any time, as described below.
      </p>
    )
  },
  {
    id: 'your-choices',
    title: 'Your choices',
    body: (
      <>
        <p>
          To get a copy of your data, correct it, or delete your account, email {mail} from the address on your account.
          We may need to confirm that it is you, and for exam records we may check with your institute first.
        </p>
        <p>Logging out removes the login token from that browser.</p>
      </>
    )
  },
  {
    id: 'students-under-18',
    title: 'Students under 18',
    body: (
      <p>
        Many Parikshio users are school students. If you are under 18, use Parikshio with the knowledge of your parent,
        guardian or school. Institutes that use Parikshio with students under 18 are responsible for obtaining any consent
        needed from parents or guardians.
      </p>
    )
  },
  {
    id: 'changes',
    title: 'Changes to this policy',
    body: (
      <p>
        When we change this policy we update the date at the top of this page. Please check back from time to time; the{' '}
        <Link href="/terms">Terms of use</Link> explain the rules for using Parikshio.
      </p>
    )
  },
  {
    id: 'contact',
    title: 'Contact',
    body: (
      <p>
        Questions about privacy? Email {mail} or use the <Link href="/contact">contact form</Link>.
      </p>
    )
  }
];

export default function PrivacyPage() {
  return (
    <LegalPage
      eyebrow="Legal"
      title="Privacy policy"
      updated="29 October 2026"
      updatedIso="2026-10-29"
      intro={
        <p>
          This policy explains what Parikshio collects when you use it, why, who can see it, and how to ask for a copy or
          deletion of your data.
        </p>
      }
      sections={sections}
    />
  );
}
