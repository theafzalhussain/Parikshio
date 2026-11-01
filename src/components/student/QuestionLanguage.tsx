'use client';

import { useCallback, useEffect, useState } from 'react';
import { Languages, Loader2 } from 'lucide-react';
import type { StudentTranslation } from '@shared/types';
import { api, ApiError, cx } from '@/lib/api';

/**
 * Hindi reading aid for the student portal.
 *
 * The switch is a reading preference only: answers are still option indexes or
 * the student's own text, and grading always uses the English original (which
 * stays visible under the Hindi), so a translation slip can never change a
 * score. Translations come from the server (DeepL, cached per question); the
 * API key never reaches the browser.
 */

export type StudentLang = 'en' | 'hi';

const STORAGE_KEY = 'axiom.student.lang';
const CHANGE_EVENT = 'axiom:student-lang';

function readLang(): StudentLang {
  if (typeof window === 'undefined') return 'en';
  return window.localStorage.getItem(STORAGE_KEY) === 'hi' ? 'hi' : 'en';
}

/** The student's reading language, shared by every question view and remembered on this device. */
export function useStudentLanguage(): [StudentLang, (lang: StudentLang) => void] {
  const [lang, setLangState] = useState<StudentLang>('en');
  useEffect(() => {
    setLangState(readLang());
    const sync = () => setLangState(readLang());
    window.addEventListener(CHANGE_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(CHANGE_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  const setLang = useCallback((next: StudentLang) => {
    window.localStorage.setItem(STORAGE_KEY, next);
    setLangState(next);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);
  return [lang, setLang];
}

// One request per question per page load, however many components ask.
const cache = new Map<string, Promise<StudentTranslation>>();

function fetchTranslation(examId: string, questionId: string): Promise<StudentTranslation> {
  const key = `${examId}:${questionId}`;
  const existing = cache.get(key);
  if (existing) return existing;
  const request = api<{ translation: StudentTranslation }>('/student/translate', {
    method: 'POST',
    body: { examId, questionId, lang: 'hi' }
  }).then((res) => res.translation);
  cache.set(key, request);
  // A failed request may succeed later (DeepL busy, quota reset), so it is not cached.
  request.catch(() => cache.delete(key));
  return request;
}

export interface TranslationState {
  translation: StudentTranslation | null;
  loading: boolean;
  error: string | null;
}

/** The Hindi version of a question while `enabled`, or nothing. */
export function useQuestionTranslation(examId: string | undefined, questionId: string | undefined, enabled: boolean): TranslationState {
  const [state, setState] = useState<TranslationState>({ translation: null, loading: false, error: null });

  useEffect(() => {
    if (!enabled || !examId || !questionId) {
      setState({ translation: null, loading: false, error: null });
      return;
    }
    let alive = true;
    setState({ translation: null, loading: true, error: null });
    fetchTranslation(examId, questionId)
      .then((translation) => {
        if (alive) setState({ translation, loading: false, error: null });
      })
      .catch((err) => {
        if (!alive) return;
        const message =
          err instanceof ApiError ? err.message : 'Hindi translation is unavailable right now. The question is shown in English.';
        setState({ translation: null, loading: false, error: message });
      });
    return () => {
      alive = false;
    };
  }, [examId, questionId, enabled]);

  return state;
}

/** English | हिंदी switch shown above the question. */
export function LanguageToggle({
  lang,
  onChange,
  loading
}: {
  lang: StudentLang;
  onChange: (lang: StudentLang) => void;
  loading?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label="Question language"
      className="inline-flex items-center gap-0.5 rounded-xl border border-white/[0.1] bg-ink-950/50 p-0.5"
    >
      <Languages className="ml-1.5 mr-0.5 h-3.5 w-3.5 text-white/45" aria-hidden />
      {(
        [
          ['en', 'English'],
          ['hi', 'हिंदी']
        ] as const
      ).map(([value, label]) => (
        <button
          key={value}
          type="button"
          lang={value}
          aria-pressed={lang === value}
          onClick={() => onChange(value)}
          className={cx(
            'inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[12.5px] font-medium transition focus-ring',
            lang === value ? 'bg-royal-500/[0.22] text-white' : 'text-white/60 hover:text-white/85'
          )}
        >
          {label}
          {value === 'hi' && lang === 'hi' && loading && <Loader2 className="h-3 w-3 animate-spin" aria-label="Translating" />}
        </button>
      ))}
    </div>
  );
}

/**
 * The prompt in the chosen language. In Hindi the English original stays
 * underneath: it is the version that is graded.
 */
export function QuestionPrompt({ prompt, translation, error }: { prompt: string; translation: StudentTranslation | null; error: string | null }) {
  if (!translation) {
    return (
      <div>
        <h2 className="font-display text-[19px] font-normal leading-[1.5] text-white sm:text-[22px]">{prompt}</h2>
        {error && (
          <p role="status" className="mt-2 text-[12.5px] text-amber-300/85">
            {error}
          </p>
        )}
      </div>
    );
  }
  return (
    <div>
      <h2 lang="hi" className="hindi-text text-[19px] font-medium leading-[1.75] text-white sm:text-[21px]">
        {translation.prompt}
      </h2>
      <p lang="en" className="mt-2 text-[13px] leading-relaxed text-white/50">
        <span className="mr-1.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white/40">English</span>
        {prompt}
      </p>
    </div>
  );
}
