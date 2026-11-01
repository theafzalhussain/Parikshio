import crypto from 'node:crypto';
import type { Question, QuestionTranslation, TranslationLang } from '../shared/types';
import { config } from './config';
import { persist } from './mongo';

/**
 * DeepL client for the student portal's Hindi toggle.
 *
 *   • Questions are translated once and cached on the question (in memory and
 *     MongoDB), keyed by a hash of the English text: a class of 60 pressing
 *     "हिंदी" together costs one DeepL request, and editing the question
 *     makes the old translation stale instead of wrong.
 *   • Exam accuracy over fluency: blanks (______), keyboard shortcuts
 *     (Ctrl + Shift + R), acronyms (CPU, RAM), logic operators (AND / OR / NOT),
 *     codes such as 2F, A1:A5 or .docx stay exactly as written, so a translated
 *     option can never stop matching what the question asks about.
 *   • The question (and topic) travel as DeepL `context`, so short options are
 *     translated in the sense the question uses them. Context is not billed.
 *   • The English original stays the source of truth for grading; the
 *     translation is only a reading aid (the UI always shows the English below).
 *
 * The API key never leaves the server.
 */

const MAX_TEXT_CHARS = 5_000;

const TARGET: Record<TranslationLang, { deepl: string; name: string }> = {
  hi: { deepl: 'HI', name: 'Hindi' }
};

/** Standard Hindi exam wording for True / False (kept fixed so every paper reads the same). */
const TRUE_FALSE_HI = ['सत्य (True)', 'असत्य (False)'];

export type TranslateErrorKind = 'config' | 'quota' | 'busy' | 'unavailable' | 'invalid-output';

export class TranslateError extends Error {
  readonly kind: TranslateErrorKind;
  constructor(message: string, kind: TranslateErrorKind) {
    super(message);
    this.name = 'TranslateError';
    this.kind = kind;
  }
}

export function translationEnabled(): boolean {
  return config.deepl.enabled;
}

// ── keep exam-critical tokens untranslated ────────────────────
const KEY_NAMES =
  'Ctrl|Control|Shift|Alt|AltGr|Win|Windows|Cmd|Command|Option|Fn|Esc|Escape|Tab|Enter|Return|Delete|Del|Backspace|Space|Spacebar|Insert|Ins|Home|End|PgUp|PgDn|Page\\s?Up|Page\\s?Down|Print\\s?Screen|PrtSc|Caps\\s?Lock|Num\\s?Lock|Up|Down|Left|Right|F(?:1[0-2]|[1-9])';
const PROTECTED: RegExp[] = [
  // blanks students fill in
  /_{2,}|\.{4,}|…{2,}/g,
  // keyboard shortcuts: "Ctrl + Shift + T", "Alt + Up/Down arrow", "Win + L"
  new RegExp(`\\b(?:${KEY_NAMES})(?:\\s*\\+\\s*(?:${KEY_NAMES}|[A-Za-z0-9](?![A-Za-z0-9])|[/\\\\=\\-.,;\\[\\]\`'])(?:\\s*/\\s*(?:${KEY_NAMES}))?)+(?:\\s+arrow)?`, 'g'),
  // a lone function key: "The F12 key"
  /\bF(?:1[0-2]|[1-9])\b/g,
  // spreadsheet formulas and cell ranges: =MAX(A1:A5), A1:A5, B12
  /=[A-Z]{2,12}\([^)]{0,40}\)/g,
  /\b[A-Z]{1,3}\d{1,5}(?::[A-Z]{1,3}\d{1,5})?\b/g,
  // codes mixing digits and capitals: 2F, 2G, PDP-8, IBM 1401 stays as the acronym + number
  /\b(?=[A-Z0-9-]*\d)(?=[A-Z0-9-]*[A-Z])[A-Z0-9][A-Z0-9-]{1,9}\b/g,
  // file extensions: .docx, .pptx
  /(?<![\w.])\.[a-z0-9]{2,5}\b/g,
  // URLs and e-mail addresses
  /\bhttps?:\/\/\S+|\b[\w.+-]+@[\w-]+\.[\w.]+/g
];
/** Capitalised for emphasis ("based on SIZE"), not an acronym: these are translated. */
const EMPHASIS = new Set(['SIZE', 'ONLY', 'ALL', 'NONE', 'BOTH', 'EACH', 'TRUE', 'FALSE', 'YES', 'NO', 'NEVER', 'ALWAYS', 'MOST', 'LEAST', 'BEST', 'NOT', 'AND', 'OR', 'PURPOSE', 'EXCEPT', 'CORRECT', 'INCORRECT', 'WRONG', 'RIGHT']);
const ACRONYM = /\b[A-Z]{2,6}s?\b/g;
const LOGIC_OPERATOR = /\b(?:AND|OR|NOT|XOR|NAND|NOR|XNOR)\b/g;
const LOGIC_CONTEXT = /\b(?:logic|logical|boolean|gate|operation|operator|true|false)\b/i;

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function unescapeXml(text: string): string {
  return text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

/** Wraps every exam-critical token in <x>…</x>; DeepL leaves `x` elements untouched. */
export function protectTerms(text: string): string {
  const spans: [number, number][] = [];
  const add = (re: RegExp, keep: (m: RegExpMatchArray) => boolean = () => true) => {
    for (const m of text.matchAll(re)) {
      const start = m.index ?? 0;
      if (m[0].trim() && keep(m)) spans.push([start, start + m[0].length]);
    }
  };
  PROTECTED.forEach((re) => add(re));
  add(ACRONYM, (m) => !EMPHASIS.has(m[0].replace(/s$/, '')));
  if (LOGIC_CONTEXT.test(text)) add(LOGIC_OPERATOR);

  // merge overlapping spans, then rebuild the text
  spans.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const merged: [number, number][] = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
    else merged.push([...span]);
  }
  let out = '';
  let cursor = 0;
  for (const [start, end] of merged) {
    out += escapeXml(text.slice(cursor, start)) + `<x>${escapeXml(text.slice(start, end))}</x>`;
    cursor = end;
  }
  return out + escapeXml(text.slice(cursor));
}

/** Removes the protection markup from a DeepL reply. */
export function restoreTerms(text: string): string {
  return unescapeXml(text.replace(/<\/?x>/g, '')).replace(/[ \t]{2,}/g, ' ').trim();
}

// ── transport ─────────────────────────────────────────────────
interface DeepLReply {
  translations?: { text?: string; detected_source_language?: string }[];
  message?: string;
}

async function callDeepL(body: Record<string, unknown>): Promise<string[]> {
  if (!config.deepl.enabled) throw new TranslateError('Translation is not configured on this server (set DEEPL_API_KEY).', 'config');
  let res: globalThis.Response;
  try {
    res = await fetch(`${config.deepl.apiUrl}/v2/translate`, {
      method: 'POST',
      headers: {
        Authorization: `DeepL-Auth-Key ${config.deepl.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(config.deepl.timeoutMs)
    });
  } catch (err) {
    const timedOut = (err as Error)?.name === 'TimeoutError' || (err as Error)?.name === 'AbortError';
    throw new TranslateError(timedOut ? 'DeepL did not answer in time.' : 'Could not reach DeepL.', 'unavailable');
  }

  const payload = (await res.json().catch(() => null)) as DeepLReply | null;
  if (!res.ok) {
    const detail = String(payload?.message ?? `HTTP ${res.status}`).slice(0, 200);
    if (res.status === 401 || res.status === 403) throw new TranslateError(`DeepL rejected the API key: ${detail}`, 'config');
    if (res.status === 456) throw new TranslateError('The DeepL character quota for this month is used up.', 'quota');
    if (res.status === 429 || res.status >= 500) throw new TranslateError(`DeepL is busy (${detail}). Try again in a moment.`, 'busy');
    throw new TranslateError(`DeepL could not translate this (${detail}).`, 'unavailable');
  }
  const texts = (payload?.translations ?? []).map((t) => (typeof t.text === 'string' ? t.text : null));
  if (!texts.length || texts.some((t) => t === null)) throw new TranslateError('DeepL returned no translation.', 'invalid-output');
  return texts as string[];
}

/**
 * Translates English exam text, keeping protected tokens as written.
 * Every text is translated independently; `context` steers all of them.
 */
export async function translateExamTexts(texts: string[], lang: TranslationLang, context: string): Promise<string[]> {
  if (!texts.length) return [];
  const translated = await callDeepL({
    text: texts.map((t) => protectTerms(t.slice(0, MAX_TEXT_CHARS))),
    source_lang: 'EN',
    target_lang: TARGET[lang].deepl,
    context: context.slice(0, 4_000),
    tag_handling: 'xml',
    ignore_tags: ['x'],
    // Keeps line breaks in multi-line prompts and does not "fix" the examiner's punctuation.
    preserve_formatting: true,
    split_sentences: 'nonewlines',
    model_type: 'prefer_quality_optimized'
  });
  if (translated.length !== texts.length) throw new TranslateError('DeepL returned a different number of texts.', 'invalid-output');
  return translated.map(restoreTerms);
}

// ── question cache ────────────────────────────────────────────
/** Hash of everything a translation is made from; any edit makes the cache stale. */
export function translationSourceHash(question: Pick<Question, 'type' | 'prompt' | 'options'>): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify([question.type, question.prompt, question.type === 'mcq' ? question.options : []]))
    .digest('hex')
    .slice(0, 24);
}

/** A cached translation that still matches the question, or null. */
export function cachedTranslation(question: Question, lang: TranslationLang): QuestionTranslation | null {
  const cached = question.translations?.[lang];
  return cached && cached.sourceHash === translationSourceHash(question) ? cached : null;
}

const inFlight = new Map<string, Promise<QuestionTranslation>>();

/**
 * The question in `lang`, from the cache or from one DeepL request shared by
 * everyone who asks at the same moment.
 */
export function questionTranslation(question: Question, lang: TranslationLang): Promise<QuestionTranslation> {
  const cached = cachedTranslation(question, lang);
  if (cached) return Promise.resolve(cached);
  const sourceHash = translationSourceHash(question);
  const key = `${question.id}:${lang}:${sourceHash}`;
  const pending = inFlight.get(key);
  if (pending) return pending;

  const job = (async () => {
    const mcqOptions = question.type === 'mcq' ? question.options : [];
    const context =
      `Exam question for school students${question.topic ? ` (subject: ${question.topic})` : ''}. ` +
      `Translate faithfully and formally for a ${TARGET[lang].name}-medium classroom; keep the meaning exact and do not answer, simplify or add anything. ` +
      `The question is: ${question.prompt}` +
      (mcqOptions.length ? ` Options: ${mcqOptions.join(' | ')}` : '');
    const [prompt, ...options] = await translateExamTexts([question.prompt, ...mcqOptions], lang, context);
    const translation: QuestionTranslation = {
      prompt,
      options: question.type === 'truefalse' ? [...TRUE_FALSE_HI] : question.type === 'mcq' ? options : [],
      sourceHash,
      provider: 'deepl',
      translatedAt: Date.now()
    };
    // Only store it if the question was not edited while DeepL was working.
    if (translationSourceHash(question) === sourceHash) {
      question.translations = { ...(question.translations ?? {}), [lang]: translation };
      persist('questions', question as unknown as { id: string } & Record<string, unknown>);
    }
    return translation;
  })().finally(() => inFlight.delete(key));

  inFlight.set(key, job);
  return job;
}

/**
 * A student's Hindi answer in English, so it can be matched against an English
 * answer key. The question travels as context, so "इनपुट" for a blank about
 * data comes back as "input", not as a different sense of the word.
 */
export async function translateAnswerToEnglish(answer: string, question: Pick<Question, 'prompt' | 'topic'>): Promise<string> {
  const [english] = await callDeepL({
    text: [protectTerms(answer.slice(0, MAX_TEXT_CHARS))],
    source_lang: 'HI',
    target_lang: 'EN-US',
    context: `A student's exam answer${question.topic ? ` (subject: ${question.topic})` : ''} to the question: ${question.prompt}`.slice(0, 4_000),
    tag_handling: 'xml',
    ignore_tags: ['x'],
    preserve_formatting: true,
    model_type: 'prefer_quality_optimized'
  });
  return restoreTerms(english);
}
