'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Building2, CircleCheck, Mail, Send, Star, User } from 'lucide-react';
import { AuthAlert } from '@/components/auth/AuthShell';
import { Button, LinkButton } from '@/components/ui/Button';
import { Input, Label, TextArea } from '@/components/ui/Field';
import { useAuth } from '@/lib/auth';
import { api, ApiError, cx, firstName } from '@/lib/api';
import { CONTACT_EMAIL } from '@/lib/site';
import {
  CONTACT_LIMITS,
  CONTACT_ROLES,
  CONTACT_TOPICS,
  type ContactRole,
  type ContactTopic
} from '@shared/contact';

/** What to write for each topic: shown under the topic choice and as the message placeholder. */
const TOPIC_GUIDE: Record<ContactTopic, { hint: string; placeholder: string }> = {
  general: {
    hint: 'Ask us anything about Parikshio.',
    placeholder: 'How can we help?'
  },
  feedback: {
    hint: 'What worked well, what got in your way, and what you would add. A rating helps too.',
    placeholder: 'I liked… It would be better if…'
  },
  problem: {
    hint: 'Say what you were doing, what you expected and what happened instead. The exam code and your device or browser help us find it faster.',
    placeholder: 'While answering question 3 of exam ABC123 on my phone (Chrome), the timer…'
  },
  faculty: {
    hint: 'Include your institute, the subjects you teach and the work email your faculty account should use.',
    placeholder: 'I teach Physics at… Please create a faculty account for…'
  },
  onboarding: {
    hint: 'Tell us about your institute: roughly how many students and teachers, and how you run exams today.',
    placeholder: 'We are a coaching institute with about 300 students…'
  }
};

const RATING_LABELS = ['', 'Poor', 'Fair', 'Good', 'Very good', 'Excellent'];

function roleForTopic(topic: ContactTopic): ContactRole {
  if (topic === 'faculty') return 'faculty';
  if (topic === 'onboarding') return 'institute';
  return 'student';
}

/** A pill-shaped choice: a real radio input, visually hidden, inside its label. */
function Choice({
  name,
  value,
  checked,
  onSelect,
  children
}: {
  name: string;
  value: string;
  checked: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <label
      className={cx(
        'inline-flex cursor-pointer select-none items-center rounded-full border px-3.5 py-2 text-[13.5px] font-medium transition duration-200',
        'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-gold-300/80 has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-ink-950',
        checked
          ? 'border-gold-300/55 bg-gold-400/[0.12] text-gold-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]'
          : 'border-white/[0.1] bg-white/[0.03] text-white/65 hover:border-white/25 hover:text-white'
      )}
    >
      <input type="radio" name={name} value={value} checked={checked} onChange={onSelect} className="sr-only" />
      {children}
    </label>
  );
}

function StarRating({ value, onChange }: { value: number; onChange: (next: number) => void }) {
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  return (
    <fieldset>
      <legend className="mb-2 flex w-full items-baseline justify-between gap-3 text-[13.5px] font-medium text-white/85">
        How was your experience?
        <span className="text-[12px] font-normal text-white/45">optional</span>
      </legend>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex items-center" onMouseLeave={() => setHover(0)}>
          {[1, 2, 3, 4, 5].map((n) => (
            <label
              key={n}
              onMouseEnter={() => setHover(n)}
              className="cursor-pointer rounded-lg p-1 transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-gold-300/80"
            >
              <input
                type="radio"
                name="rating"
                value={n}
                checked={value === n}
                onChange={() => onChange(n)}
                className="sr-only"
              />
              <span className="sr-only">
                {n} {n === 1 ? 'star' : 'stars'}, {RATING_LABELS[n]}
              </span>
              <Star
                aria-hidden="true"
                className={cx(
                  'h-7 w-7 transition duration-150',
                  n <= shown ? 'fill-gold-300 text-gold-300' : 'fill-transparent text-white/25'
                )}
              />
            </label>
          ))}
        </div>
        <span className="min-w-[5.5rem] text-[13px] text-white/60" aria-hidden="true">
          {RATING_LABELS[shown]}
        </span>
        {value > 0 && (
          <button
            type="button"
            onClick={() => onChange(0)}
            className="focus-ring rounded text-[12.5px] text-white/45 underline-offset-2 transition hover:text-white/80 hover:underline"
          >
            Clear rating
          </button>
        )}
      </div>
    </fieldset>
  );
}

/**
 * The contact and feedback form. Anyone can use it; when somebody is signed
 * in, their details are filled in and the server notes which account wrote.
 */
export function ContactForm({ initialTopic }: { initialTopic: ContactTopic }) {
  const { user } = useAuth();
  const [topic, setTopic] = useState<ContactTopic>(initialTopic);
  const [role, setRole] = useState<ContactRole>(roleForTopic(initialTopic));
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [org, setOrg] = useState('');
  const [message, setMessage] = useState('');
  const [rating, setRating] = useState(0);
  const [website, setWebsite] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ name: string; email: string; reference?: string; confirmationSent: boolean } | null>(
    null
  );

  const roleTouched = useRef(false);
  const prefilled = useRef(false);
  const successHeading = useRef<HTMLHeadingElement>(null);

  // A footer link such as "Report a problem" while already on this page.
  useEffect(() => {
    setTopic(initialTopic);
    if (!roleTouched.current && !prefilled.current) setRole(roleForTopic(initialTopic));
  }, [initialTopic]);

  useEffect(() => {
    if (!user || prefilled.current) return;
    prefilled.current = true;
    setName((v) => v || user.name);
    setEmail((v) => v || user.email);
    setOrg((v) => v || user.org || '');
    if (!roleTouched.current) setRole(user.role === 'admin' ? 'faculty' : 'student');
  }, [user]);

  useEffect(() => {
    if (sent) successHeading.current?.focus();
  }, [sent]);

  function chooseTopic(next: ContactTopic) {
    setTopic(next);
    setError(null);
    if (!roleTouched.current && !user) setRole(roleForTopic(next));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const body = message.trim();
    if (name.trim().length < 2) {
      setError('Please tell us your name.');
      return;
    }
    if (body.length < CONTACT_LIMITS.messageMin) {
      setError(`Please write at least ${CONTACT_LIMITS.messageMin} characters.`);
      return;
    }

    setBusy(true);
    try {
      const res = await api<{ ok: true; id?: string; reference?: string; confirmationSent?: boolean }>('/contact', {
        method: 'POST',
        body: {
          topic,
          role,
          name: name.trim(),
          email: email.trim(),
          org: org.trim(),
          message: body,
          rating: topic === 'feedback' && rating > 0 ? rating : undefined,
          website
        }
      });
      setSent({
        name: name.trim(),
        email: email.trim(),
        reference: res.reference,
        confirmationSent: res.confirmationSent === true
      });
    } catch (err) {
      setError(
        err instanceof ApiError && err.status < 500
          ? err.message
          : `Your message could not be sent just now. Please try again in a moment, or email ${CONTACT_EMAIL}.`
      );
    } finally {
      setBusy(false);
    }
  }

  function startAnother() {
    setSent(null);
    setMessage('');
    setRating(0);
    setError(null);
  }

  if (sent) {
    return (
      <div className="panel gold-edge flex flex-col items-center px-6 py-14 text-center sm:px-10">
        <span className="grid h-16 w-16 place-items-center rounded-full bg-mint-500/[0.14] text-mint-300 ring-1 ring-inset ring-mint-400/30">
          <CircleCheck className="h-8 w-8" />
        </span>
        <h2
          ref={successHeading}
          tabIndex={-1}
          className="mt-6 font-display text-[28px] font-medium leading-tight text-white"
        >
          Message sent
        </h2>
        <p className="mt-3 max-w-md text-[15px] leading-relaxed text-white/65" role="status">
          Thank you, {firstName(sent.name)}. Your message is with the Parikshio team, and replies go to{' '}
          <span className="font-medium text-white/90">{sent.email}</span>.
          {sent.confirmationSent && ' We have also emailed you a copy for your records.'}
        </p>
        {sent.reference && (
          <p className="mt-4 rounded-full border border-gold-300/25 bg-gold-400/[0.08] px-3.5 py-1.5 text-[12.5px] text-gold-100">
            Reference <span className="font-mono tracking-[0.08em]">{sent.reference}</span>
          </p>
        )}
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button type="button" variant="secondary" onClick={startAnother}>
            Send another message
          </Button>
          <LinkButton href="/" variant="ghost">
            Back to home <ArrowRight className="h-4 w-4" />
          </LinkButton>
        </div>
      </div>
    );
  }

  const guide = TOPIC_GUIDE[topic];
  const tooShort = message.trim().length > 0 && message.trim().length < CONTACT_LIMITS.messageMin;

  return (
    <form onSubmit={submit} className="panel gold-edge relative space-y-7 p-6 sm:p-8">
      <fieldset>
        <legend className="mb-3 text-[13.5px] font-medium text-white/85">What is this about?</legend>
        <div className="flex flex-wrap gap-2">
          {CONTACT_TOPICS.map((option) => (
            <Choice
              key={option.key}
              name="topic"
              value={option.key}
              checked={topic === option.key}
              onSelect={() => chooseTopic(option.key)}
            >
              {option.label}
            </Choice>
          ))}
        </div>
        <p className="mt-3 text-[13px] leading-relaxed text-white/50">{guide.hint}</p>
      </fieldset>

      <fieldset>
        <legend className="mb-3 text-[13.5px] font-medium text-white/85">I am a</legend>
        <div className="flex flex-wrap gap-2">
          {CONTACT_ROLES.map((option) => (
            <Choice
              key={option.key}
              name="role"
              value={option.key}
              checked={role === option.key}
              onSelect={() => {
                roleTouched.current = true;
                setRole(option.key);
              }}
            >
              {option.label}
            </Choice>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="contact-name">Your name</Label>
          <div className="relative">
            <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
            <Input
              id="contact-name"
              name="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Priya Sharma"
              className="pl-9"
              required
              minLength={2}
              maxLength={CONTACT_LIMITS.name}
              autoComplete="name"
            />
          </div>
        </div>
        <div>
          <Label htmlFor="contact-email">Email address</Label>
          <div className="relative">
            <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
            <Input
              id="contact-email"
              name="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="pl-9"
              required
              maxLength={CONTACT_LIMITS.email}
              autoComplete="email"
            />
          </div>
        </div>
      </div>

      <div>
        <Label htmlFor="contact-org" hint="optional">
          Institute, school or class
        </Label>
        <div className="relative">
          <Building2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
          <Input
            id="contact-org"
            name="organization"
            value={org}
            onChange={(e) => setOrg(e.target.value)}
            placeholder="Where you study or teach"
            className="pl-9"
            maxLength={CONTACT_LIMITS.org}
            autoComplete="organization"
          />
        </div>
      </div>

      {topic === 'feedback' && <StarRating value={rating} onChange={setRating} />}

      <div>
        <Label htmlFor="contact-message" hint={`${message.length.toLocaleString('en-IN')} / ${CONTACT_LIMITS.messageMax.toLocaleString('en-IN')}`}>
          Message
        </Label>
        <TextArea
          id="contact-message"
          name="message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={guide.placeholder}
          rows={7}
          required
          minLength={CONTACT_LIMITS.messageMin}
          maxLength={CONTACT_LIMITS.messageMax}
          aria-describedby={tooShort ? 'contact-message-min' : undefined}
        />
        {tooShort && (
          <p id="contact-message-min" className="mt-1.5 text-[12px] text-white/50">
            A few more words, please: at least {CONTACT_LIMITS.messageMin} characters.
          </p>
        )}
      </div>

      {/* Hidden from people; bots that fill every field are dropped by the server. */}
      <div aria-hidden="true" className="absolute -left-[9999px] top-0 h-px w-px overflow-hidden">
        <label htmlFor="contact-website">Leave this field empty</label>
        <input
          id="contact-website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
        />
      </div>

      {user && (
        <p className="text-[12.5px] leading-relaxed text-white/45">
          Logged in as <span className="text-white/70">{user.email}</span>, so this message will be linked to your
          account.
        </p>
      )}

      {error && <AuthAlert>{error}</AuthAlert>}

      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-white/[0.07] pt-6">
        <p className="max-w-sm text-[12.5px] leading-relaxed text-white/45">
          We reply to the email address above. See how we handle your details in the{' '}
          <Link href="/privacy" className="focus-ring rounded text-white/70 underline-offset-2 hover:text-white hover:underline">
            Privacy policy
          </Link>
          .
        </p>
        <Button type="submit" variant="gold" size="lg" loading={busy} className="px-7">
          Send message
          {!busy && <Send className="h-4 w-4" />}
        </Button>
      </div>
    </form>
  );
}
