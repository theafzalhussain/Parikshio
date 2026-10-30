'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  BarChart3,
  Building2,
  FileUp,
  GraduationCap,
  KeyRound,
  LogIn,
  Mail,
  Presentation,
  Radio,
  Timer,
  TrendingUp,
  User
} from 'lucide-react';
import type { PublicUser } from '@shared/types';
import { AuthAlert, AuthDivider, AuthHeading, AuthShell, type AuthHighlight } from '@/components/auth/AuthShell';
import { GoogleButton } from '@/components/auth/GoogleButton';
import { PasswordField, passwordIssues } from '@/components/auth/PasswordField';
import { RoleSwitch, rolePanelId, roleTabId, syncRoleToUrl } from '@/components/auth/RoleSwitch';
import { Button, LinkButton } from '@/components/ui/Button';
import { Input, Label } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/lib/auth';
import { GoogleSignInError, firebaseConfigured, preloadGoogleSignIn } from '@/lib/firebaseConfig';
import { ApiError, firstName } from '@/lib/api';
import { authHref, landingFor, parseAuthRole, safeNext, type AuthRole } from '@/lib/nextPath';
import { SITE_NAME } from '@/lib/site';
import { cleanOrg, ORG_LIMITS, orgProblem } from '@shared/org';

const PANEL: Record<
  AuthRole,
  {
    badge: { tone: 'gold' | 'royal'; icon: React.ComponentType<{ className?: string }>; label: string };
    heading: React.ReactNode;
    subheading: string;
    highlights: AuthHighlight[];
  }
> = {
  student: {
    badge: { tone: 'gold', icon: GraduationCap, label: 'Student account' },
    heading: (
      <>
        One account for <span className="font-display italic gold-text">every exam you take.</span>
      </>
    ),
    subheading:
      'Create your student account to join live exams from any teacher on Parikshio and keep every result in one place.',
    highlights: [
      { icon: KeyRound, text: 'Join a live exam with the short code your teacher shares' },
      { icon: Timer, text: 'Everyone gets the same time: the timer runs on the server, not your device' },
      { icon: TrendingUp, text: 'Scores, ranks and topics to practise, gathered across sessions' }
    ]
  },
  faculty: {
    badge: { tone: 'royal', icon: Presentation, label: 'Faculty & admin' },
    heading: (
      <>
        Run fair, live exams <span className="font-display italic gold-text">from one console.</span>
      </>
    ),
    subheading:
      'Faculty accounts are created on request, so only approved teachers can author questions, push exams and see results.',
    highlights: [
      { icon: FileUp, text: 'Turn a PDF, Word file or photo of a paper into editable questions' },
      { icon: Radio, text: 'Push one question or a whole paper to every student at once' },
      { icon: BarChart3, text: 'Grading, leaderboards and per-question analytics as answers arrive' }
    ]
  }
};

const FACULTY_STEPS = [
  {
    title: 'Request access',
    body: 'Send your name, work email and institute through the contact form.'
  },
  {
    title: 'We set up your account',
    body: 'The Parikshio team creates your faculty account and replies to your work email.'
  },
  {
    title: 'Log in as faculty',
    body: 'Choose “Faculty & admin” on the log-in page and use your password or Google.'
  }
];

export function SignupClient({ initialRole, next }: { initialRole: AuthRole; next: string | null }) {
  const router = useRouter();
  const { user, ready, register, loginWithGoogle } = useAuth();
  const { push } = useToast();

  const [role, setRole] = useState<AuthRole>(initialRole);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [org, setOrg] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const panel = PANEL[role];

  useEffect(() => {
    if (ready && user) router.replace(landingFor(user.role, next));
  }, [ready, user, router, next]);

  // The Google sign-in code is not part of the page; fetch it while the person types.
  useEffect(() => preloadGoogleSignIn(), []);

  const mismatch = confirm.length > 0 && confirm !== password;
  const canSubmit = useMemo(
    () =>
      name.trim().length > 0 &&
      email.trim().length > 0 &&
      !orgProblem(org) &&
      passwordIssues(password).length === 0 &&
      confirm === password,
    [name, email, org, password, confirm]
  );

  function changeRole(nextRole: AuthRole) {
    if (nextRole === role) return;
    setRole(nextRole);
    setError(null);
    syncRoleToUrl(nextRole);
  }

  function land(authed: PublicUser, title: string) {
    push({
      kind: 'success',
      title,
      body: authed.role === 'admin' ? 'Opening the faculty console…' : 'Opening your exam lobby…'
    });
    router.replace(landingFor(authed.role, next));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const orgIssue = orgProblem(org);
    if (orgIssue) {
      setError(orgIssue);
      return;
    }
    const issues = passwordIssues(password);
    if (issues.length) {
      setError(issues[0]!);
      return;
    }
    if (password !== confirm) {
      setError('Both passwords must match');
      return;
    }

    setBusy(true);
    try {
      const authed = await register({
        name: name.trim(),
        email: email.trim(),
        password,
        org: cleanOrg(org)
      });
      land(authed, `Welcome to ${SITE_NAME}, ${firstName(authed.name)}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create your account right now');
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    setError(null);
    // A new Google account needs the institute too; ask before opening the popup.
    const orgIssue = orgProblem(org);
    if (orgIssue) {
      setError(`${orgIssue} first, then continue with Google.`);
      document.getElementById('signup-org')?.focus();
      return;
    }
    setGoogleBusy(true);
    try {
      // An existing account with this Google address is signed in, not duplicated.
      const authed = await loginWithGoogle({ org: cleanOrg(org), portal: 'student' });
      land(authed, `Welcome, ${firstName(authed.name)}`);
    } catch (err) {
      if (err instanceof GoogleSignInError && err.cancelled) return;
      setError(
        err instanceof GoogleSignInError || err instanceof ApiError
          ? err.message
          : 'Google sign-up failed. Please try again.'
      );
    } finally {
      setGoogleBusy(false);
    }
  }

  return (
    <AuthShell
      eyebrow="Create account"
      badge={panel.badge}
      heading={panel.heading}
      subheading={panel.subheading}
      highlights={panel.highlights}
      panelKey={role}
      footer={
        <p className="text-center text-[12px] leading-relaxed text-white/40">
          By creating an account you agree to the {SITE_NAME}{' '}
          <Link href="/terms" className="focus-ring rounded underline-offset-2 transition hover:text-white/70 hover:underline">
            Terms of use
          </Link>{' '}
          and{' '}
          <Link href="/privacy" className="focus-ring rounded underline-offset-2 transition hover:text-white/70 hover:underline">
            Privacy policy
          </Link>
          .
        </p>
      }
    >
      <RoleSwitch idBase="signup" label="Create an account as" value={role} onChange={changeRole} className="mb-8" />

      <div role="tabpanel" id={rolePanelId('signup')} aria-labelledby={roleTabId('signup', role)}>
        {role === 'student' ? (
          <>
            <AuthHeading title={`Join ${SITE_NAME}`} sub="Create a student account to join your institute's live exams." />

            <GoogleButton
              onClick={google}
              loading={googleBusy}
              disabled={busy}
              configured={firebaseConfigured}
              label="Sign up with Google as a student"
            />

            <AuthDivider label="or use email" />

            <form onSubmit={submit} className="space-y-4">
              <div>
                <Label htmlFor="signup-name">Full name</Label>
                <div className="relative">
                  <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
                  <Input
                    id="signup-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Aarav Gupta"
                    className="pl-9"
                    required
                    autoComplete="name"
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="signup-email">Email address</Label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
                  <Input
                    id="signup-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="pl-9"
                    required
                    autoComplete="email"
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="signup-org">Institute, college, school or class</Label>
                <div className="relative">
                  <Building2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
                  <Input
                    id="signup-org"
                    value={org}
                    onChange={(e) => setOrg(e.target.value)}
                    placeholder="Your school, college or class"
                    className="pl-9"
                    required
                    minLength={ORG_LIMITS.min}
                    maxLength={ORG_LIMITS.max}
                    aria-describedby="signup-org-help"
                    autoComplete="organization"
                  />
                </div>
                <p id="signup-org-help" className="mt-1.5 text-[12px] text-white/45">
                  Needed for Google sign-up too. Write it the way your institute is usually written.
                </p>
              </div>

              <PasswordField
                value={password}
                onChange={setPassword}
                label="Create password"
                autoComplete="new-password"
                showStrength
              />

              <div>
                <PasswordField
                  value={confirm}
                  onChange={setConfirm}
                  label="Confirm password"
                  placeholder="Re-enter your password"
                  autoComplete="new-password"
                />
                {mismatch && <p className="mt-1.5 text-[12px] text-ember-400">Passwords do not match</p>}
              </div>

              {error && <AuthAlert>{error}</AuthAlert>}

              <Button
                type="submit"
                size="lg"
                variant="gold"
                className="w-full"
                loading={busy}
                disabled={googleBusy || !canSubmit}
              >
                Create student account
                {!busy && <ArrowRight className="h-4 w-4" />}
              </Button>
            </form>

            <p className="mt-6 text-center text-[13px] text-white/55">
              Already have an account?{' '}
              <Link
                href={authHref('/login', 'student', next)}
                className="focus-ring rounded font-medium text-gold-300 transition hover:text-gold-200"
              >
                Log in
              </Link>
            </p>
          </>
        ) : (
          <>
            <AuthHeading
              title="Faculty accounts"
              sub="Faculty and admin accounts are created on request, so only approved teachers can author and run exams."
            />

            <ol className="space-y-3">
              {FACULTY_STEPS.map((step, index) => (
                <li
                  key={step.title}
                  className="flex gap-3.5 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-3.5"
                >
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-gold-400/[0.1] font-display text-[13px] font-semibold text-gold-200 ring-1 ring-inset ring-gold-300/30">
                    {index + 1}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[14px] font-semibold text-white/90">{step.title}</span>
                    <span className="mt-0.5 block text-[13px] leading-relaxed text-white/55">{step.body}</span>
                  </span>
                </li>
              ))}
            </ol>

            <div className="mt-6 space-y-3">
              <LinkButton href="/contact?topic=faculty" variant="gold" size="lg" className="w-full">
                Request faculty access
                <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
              </LinkButton>
              <LinkButton href="/login?role=faculty" variant="secondary" size="lg" className="w-full">
                <LogIn className="h-4 w-4" />
                Faculty log in
              </LinkButton>
            </div>

            <p className="mt-6 text-center text-[13px] leading-relaxed text-white/55">
              Bringing a whole school or college?{' '}
              <Link
                href="/contact?topic=onboarding"
                className="focus-ring rounded font-medium text-gold-300 transition hover:text-gold-200"
              >
                Talk to us about onboarding
              </Link>
            </p>
          </>
        )}
      </div>
    </AuthShell>
  );
}

/** Reads `?role=` and `?next=` in the browser, so the page itself can be static. */
export function SignupFromQuery() {
  const params = useSearchParams();
  return <SignupClient initialRole={parseAuthRole(params.get('role'))} next={safeNext(params.get('next'))} />;
}
