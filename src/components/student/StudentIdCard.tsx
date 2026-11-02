'use client';

import { useEffect, useState } from 'react';
import { Check, Copy, IdCard } from 'lucide-react';
import { cx } from '@/lib/api';

/** The student's permanent Student ID, with one-tap copy (teachers ask for it). */
export function StudentIdCard({ code, className }: { code: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(t);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      // Clipboard blocked (http, old browser): the ID is selectable text anyway.
    }
  }

  return (
    <div
      className={cx(
        'inline-flex max-w-full items-center gap-3 rounded-2xl border border-gold-300/20 bg-gold-400/[0.05] py-2 pl-3 pr-2',
        className
      )}
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gold-400/[0.12] text-gold-200 ring-1 ring-inset ring-gold-300/25">
        <IdCard className="h-4 w-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-[10.5px] font-semibold uppercase tracking-[0.16em] text-white/50">Student ID</span>
        <span className="block select-all font-mono text-[16px] font-semibold tracking-[0.12em] text-gold-100" data-testid="student-id">
          {code}
        </span>
      </span>
      <button
        type="button"
        onClick={() => void copy()}
        className="focus-ring ml-1 grid h-9 w-9 shrink-0 place-items-center rounded-xl text-white/55 transition hover:bg-white/[0.06] hover:text-white"
        aria-label={copied ? 'Student ID copied' : 'Copy Student ID'}
        title={copied ? 'Copied' : 'Copy'}
      >
        {copied ? <Check className="h-4 w-4 text-mint-300" /> : <Copy className="h-4 w-4" />}
      </button>
    </div>
  );
}
