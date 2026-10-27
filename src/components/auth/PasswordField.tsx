'use client';

import { useId, useMemo, useState } from 'react';
import { Check, Eye, EyeOff, Lock } from 'lucide-react';
import { Input, Label } from '@/components/ui/Field';
import { cx } from '@/lib/api';

/**
 * Mirrors the server-side rules in `server/security.ts` → `passwordProblem()`.
 * Kept in sync deliberately: the client gives instant feedback, the server
 * remains the authority.
 */
const RULES = [
  { id: 'length', label: 'At least 8 characters', test: (v: string) => v.length >= 8 },
  { id: 'letter', label: 'Contains a letter', test: (v: string) => /[a-zA-Z]/.test(v) },
  { id: 'number', label: 'Contains a number', test: (v: string) => /[0-9]/.test(v) }
] as const;

const COMMON = ['password', '12345678', 'qwerty123', 'admin123', 'student123', 'letmein1'];

export function passwordIssues(value: string): string[] {
  const failed: string[] = RULES.filter((rule) => !rule.test(value)).map((rule) => rule.label);
  if (value && COMMON.includes(value.toLowerCase())) failed.push('Too common — pick something harder to guess');
  return failed;
}

function strengthOf(value: string): { score: 0 | 1 | 2 | 3; label: string; className: string } {
  if (!value) return { score: 0, label: '', className: '' };
  let score = 0;
  if (value.length >= 8) score++;
  if (value.length >= 12) score++;
  if (/[a-zA-Z]/.test(value) && /[0-9]/.test(value)) score++;
  if (/[^a-zA-Z0-9]/.test(value)) score++;
  if (COMMON.includes(value.toLowerCase())) score = 1;

  if (score <= 1) return { score: 1, label: 'Weak', className: 'bg-ember-500' };
  if (score === 2) return { score: 2, label: 'Fair', className: 'bg-amber-400' };
  return { score: 3, label: 'Strong', className: 'bg-mint-400' };
}

export function PasswordField({
  value,
  onChange,
  label = 'Password',
  hint,
  placeholder = '••••••••',
  autoComplete = 'current-password',
  required = true,
  /** Show the live rule checklist + strength meter (sign-up / reset screens). */
  showStrength = false,
  name
}: {
  value: string;
  onChange: (next: string) => void;
  label?: string;
  hint?: string;
  placeholder?: string;
  autoComplete?: string;
  required?: boolean;
  showStrength?: boolean;
  name?: string;
}) {
  const [visible, setVisible] = useState(false);
  const strength = useMemo(() => strengthOf(value), [value]);
  const fieldId = useId();
  const rulesId = `${fieldId}-rules`;
  const showRules = showStrength && value.length > 0;

  return (
    <div>
      <Label hint={hint} htmlFor={fieldId}>
        {label}
      </Label>
      <div className="relative">
        <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/25" />
        <Input
          id={fieldId}
          type={visible ? 'text' : 'password'}
          name={name}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="pl-9 pr-10"
          required={required}
          autoComplete={autoComplete}
          aria-describedby={showRules ? rulesId : undefined}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="focus-ring absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-white/30 transition hover:text-white/70"
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>

      {showRules && (
        <div className="mt-2.5">
          <div className="flex items-center gap-2">
            <div className="flex h-1 flex-1 gap-1">
              {[1, 2, 3].map((step) => (
                <span
                  key={step}
                  className={cx(
                    'h-full flex-1 rounded-full transition-colors',
                    strength.score >= step ? strength.className : 'bg-white/10'
                  )}
                />
              ))}
            </div>
            <span
              className={cx(
                'w-12 text-right text-[10.5px] font-semibold uppercase tracking-[0.1em]',
                strength.score === 1 && 'text-ember-400',
                strength.score === 2 && 'text-amber-300',
                strength.score === 3 && 'text-mint-300'
              )}
            >
              {strength.label}
            </span>
          </div>

          <ul id={rulesId} className="mt-2 space-y-1">
            {RULES.map((rule) => {
              const passed = rule.test(value);
              return (
                <li
                  key={rule.id}
                  className={cx(
                    'flex items-center gap-1.5 text-[11px] transition-colors',
                    passed ? 'text-mint-300/80' : 'text-white/30'
                  )}
                >
                  <span
                    className={cx(
                      'grid h-3 w-3 shrink-0 place-items-center rounded-full',
                      passed ? 'bg-mint-400/20 text-mint-300' : 'bg-white/[0.07]'
                    )}
                  >
                    {passed && <Check className="h-2 w-2" />}
                  </span>
                  {rule.label}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
