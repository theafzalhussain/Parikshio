import type { Grade, LeaderboardEntry, Question, QuestionStat, QuestionType, Response } from './types';

/** Devanagari script (Hindi, Marathi, Sanskrit …). */
const DEVANAGARI = /[\u0900-\u097F]/;

/** True when the text contains Hindi (Devanagari) letters. */
export function hasDevanagari(text: string): boolean {
  return DEVANAGARI.test(text ?? '');
}

/**
 * Normalise a free-text answer for tolerant comparison. Unicode-aware, so a
 * Hindi answer keeps its letters (and vowel signs) instead of collapsing to an
 * empty string; Devanagari digits become ASCII ("२५६" = "256").
 */
export function normalise(value: string): string {
  return (value ?? '')
    .toString()
    .normalize('NFC')
    .toLowerCase()
    .replace(/[\u0966-\u096F]/g, (d) => String(d.charCodeAt(0) - 0x0966))
    .replace(/[\u2018\u2019\u201c\u201d]/g, "'")
    .replace(/[\u0964\u0965]/g, ' ') // danda । ॥ (Hindi full stops)
    .replace(/[^\p{L}\p{M}\p{N}\s.'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Levenshtein distance — used for typo-tolerant fill-in-the-blank grading. */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/**
 * Dual-mode grading split.
 * Objective formats have one right answer, so a deterministic answer key grades
 * them instantly. Subjective formats need judgement and go to the AI evaluator
 * (falling back to manual review when AI is unavailable).
 */
export const OBJECTIVE_TYPES: readonly QuestionType[] = ['mcq', 'truefalse', 'fill'];
export const SUBJECTIVE_TYPES: readonly QuestionType[] = ['short', 'long'];

export function isSubjective(type: QuestionType): boolean {
  return type === 'short' || type === 'long';
}

// ── Answer substance (short / long) ───────────────────────────
/**
 * A correct keyword is not a full answer to a 5-mark question. Every short or
 * long answer has a word floor for full marks: answers below it can still earn
 * partial credit, but never the full points, whichever engine (answer key or
 * AI) scored them. The floor comes from, in order:
 *   1. `question.minAnswerWords` (set by the paper import or by faculty; 0 = none)
 *   2. a word limit written in the prompt ("in about 50 words", "30-50 words")
 *   3. the marks: each mark beyond the first asks for roughly one more sentence
 */
const MAX_REQUIRED_WORDS = 400;

/** Counts words that carry letters or digits (a lone "=" or "-" is not a word). */
export function countWords(text: string): number {
  return (text ?? '')
    .trim()
    .split(/\s+/)
    .filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
}

/**
 * Minimum words implied by a word limit in the text, or `null` when there is none.
 * "30-50 words" → 30 · "at least 80 words" → 80 · "about 50 words" → 35 ·
 * "not more than 100 words" → 50 (a cap is not a target, so half of it).
 */
export function wordLimitFrom(text: string): number | null {
  const t = text ?? '';
  const range = /(\d{2,4})\s*(?:-|–|to)\s*(\d{2,4})\s*words?\b/i.exec(t);
  if (range && Number(range[1]) < Number(range[2])) return Number(range[1]);
  const atLeast = /\b(?:at\s+least|minimum(?:\s+of)?|not\s+less\s+than|no\s+less\s+than)\s+(\d{2,4})\s*words?\b/i.exec(t);
  if (atLeast) return Number(atLeast[1]);
  const atMost =
    /\b(?:not\s+more\s+than|not\s+exceeding|no\s+more\s+than|within|maximum(?:\s+of)?|up\s*to|less\s+than)\s+(\d{2,4})\s*words?\b/i.exec(t);
  if (atMost) return Math.round(Number(atMost[1]) * 0.5);
  const about = /\b(?:about|around|approximately|approx\.?|nearly|in)\s+(\d{2,4})\s*words?\b/i.exec(t);
  if (about) return Math.round(Number(about[1]) * 0.7);
  // "Answer in 2 to 3 lines": roughly 8 words a line, counted from the lower bound
  const lines =
    /\b(?:answer|write|explain|describe)\b[^.]{0,60}?\b(?:in|within)\s+(?:about\s+)?(\d{1,2})\s*(?:(?:-|–|to)\s*\d{1,2}\s*)?lines?\b/i.exec(t);
  if (lines) return Math.max(1, Number(lines[1])) * 8;
  return null;
}

/** Prompts that ask for a name, a term or a value rather than an explanation. */
const BRIEF_CUE =
  /^(?:name|which|who|whom|when|where|expand|identify|spell|how\s+many|in\s+which|write\s+the\s+(?:full\s+form|name|formula|symbol|unit|chemical\s+formula)|give\s+(?:one|the|a)\s+(?:word|name|term|example)|what\s+is\s+the\s+(?:s\.?i\.?\s+)?unit|state\s+the\s+(?:value|unit|number|name)|mention\s+(?:one|the\s+name))\b|\bone[\s-]word\b/i;
const EXPLAIN_CUE =
  /\b(?:explain|describe|discuss|why|how\s+(?:does|do|is|are|can)|justify|differentiate|distinguish|compare|elaborate|illustrate|account\s+for|give\s+reasons?|derive|prove)\b/i;
/** Numerical problems: the working is mostly symbols, so fewer words are expected per mark. */
const NUMERIC_CUE = /\b(?:solve|calculate|compute|evaluate|simplify|find|determine|how\s+(?:much|many|long|far))\b/i;

interface SubstanceInput {
  type: QuestionType;
  points: number;
  prompt: string;
  acceptedAnswers: string[];
}

/**
 * Word floor for full marks when nobody set one explicitly.
 * `instructions` is extra paper text that applies to the question (a section
 * heading such as "Answer in about 30 words each").
 */
export function defaultMinAnswerWords(q: SubstanceInput, instructions = ''): number {
  if (!isSubjective(q.type) || !Number.isFinite(q.points) || q.points <= 0) return 0;
  // A word limit printed on the question itself always wins.
  const own = wordLimitFrom(q.prompt);
  if (own !== null) return Math.min(MAX_REQUIRED_WORDS, own);

  // The examiner's own model answer shows how much they expect: a one- to
  // three-word key means a brief answer is fine, unless the question itself
  // asks for an explanation (then the key is only the core point).
  const reference = q.acceptedAnswers.length ? Math.max(...q.acceptedAnswers.map(countWords)) : 0;
  const explains = EXPLAIN_CUE.test(q.prompt);
  if (q.type === 'short') {
    const prompt = q.prompt.trim();
    if (q.points <= 1 || (BRIEF_CUE.test(prompt) && !explains)) return 0;
    if (!explains && reference > 0 && reference <= 3) return 0;
  }

  // A limit for the whole section ("Answer in 30-50 words").
  const general = instructions ? wordLimitFrom(instructions) : null;
  if (general !== null) return Math.min(MAX_REQUIRED_WORDS, general);

  // A calculation with numbers in it: working is mostly symbols, not words.
  const numeric = NUMERIC_CUE.test(q.prompt) && /\d/.test(q.prompt) && !explains;
  let words = numeric
    ? Math.round((q.type === 'long' ? 6 : 3) * q.points)
    : q.type === 'long'
      ? Math.max(40, Math.round(15 * q.points))
      : Math.round(5 + 10 * (q.points - 1));
  if (q.type === 'short' && reference > 0 && reference < words) {
    // A short model answer lowers the floor, but an "explain" question still needs at least half of it.
    words = explains ? Math.max(Math.ceil(words / 2), reference) : Math.floor(reference * 0.5);
  }
  return Math.min(MAX_REQUIRED_WORDS, words);
}

/** The word floor that grading enforces for this question (0 = no floor). */
export function requiredAnswerWords(q: SubstanceInput & { minAnswerWords?: number }): number {
  if (!isSubjective(q.type)) return 0;
  const explicit = q.minAnswerWords;
  if (typeof explicit === 'number' && Number.isFinite(explicit) && explicit >= 0) {
    return Math.min(MAX_REQUIRED_WORDS * 5, Math.round(explicit));
  }
  return defaultMinAnswerWords(q);
}

export interface SubstanceCap {
  /** Highest score this answer can receive. Equal to the question's points when there is no limit. */
  cap: number;
  words: number;
  required: number;
}

/**
 * The most an answer can score given its length. Below the floor the cap grows
 * in proportion to the words written (snapped down to half marks), with at
 * least half a mark available and always half a mark short of full.
 */
export function substanceCap(q: SubstanceInput & { minAnswerWords?: number }, answer: string): SubstanceCap {
  const worth = Number.isFinite(q.points) ? q.points : 0;
  const required = requiredAnswerWords(q);
  const words = countWords(answer);
  if (required <= 0 || words >= required || worth <= 0.5) return { cap: worth, words, required };
  const scaled = Math.floor(worth * (words / required) * 2) / 2;
  return { cap: Math.min(worth - 0.5, Math.max(0.5, scaled)), words, required };
}

/**
 * Whether a question can be graded automatically as it stands. One rule for
 * every screen, so a row can never say "ready" and "no key" at the same time.
 * - `ready`   → has its answer key / model answer
 * - `missing` → nothing can grade it until a key is added (MCQ / True-False /
 *               Fill in the blank always; Short when AI grading is off)
 * - `ai`      → no model answer, but the AI evaluator marks it from the question
 * - `manual`  → Long answer with no model answer and AI off: a teacher marks it
 */
export type KeyStatus = 'ready' | 'missing' | 'ai' | 'manual';

export function answerKeyStatus(
  q: { type: QuestionType; correctOptionIndex: number | null; acceptedAnswers: string[] },
  aiEnabled: boolean
): KeyStatus {
  if (q.type === 'mcq' || q.type === 'truefalse') return q.correctOptionIndex === null ? 'missing' : 'ready';
  if (q.acceptedAnswers.length > 0) return 'ready';
  if (q.type === 'fill') return 'missing';
  if (aiEnabled) return 'ai';
  return q.type === 'short' ? 'missing' : 'manual';
}

/**
 * Any partial credit counts as graded-correct (the UI renders it as "partial");
 * zero is incorrect. Shared by manual and AI scoring so both read the same way.
 */
export function gradeForAward(awarded: number): Grade {
  return awarded > 0 ? 'correct' : 'incorrect';
}

/**
 * Automated grading.
 * - mcq / truefalse → option index comparison (answer is the option index as string)
 * - fill / short    → normalised match against accepted answers (typo tolerant ≤ 1 edit for words > 4 chars)
 * - long            → pending manual review (automatically matched only if an accepted answer exists)
 * - short / long without any key → pending (the AI evaluator or a human scores them)
 * - short / long key matches are limited by `substanceCap()` (no full marks for a bare keyword)
 */
export function gradeAnswer(
  question: Question,
  answer: string
): { grade: Grade; awarded: number } {
  const raw = (answer ?? '').trim();
  if (!raw) return { grade: 'incorrect', awarded: 0 };

  // Guards against a question stored with a non-finite `points` value (older
  // records written before the API validated it): NaN here would propagate into
  // every leaderboard total.
  const worth = Number.isFinite(question.points) ? question.points : 0;

  if (question.type === 'mcq' || question.type === 'truefalse') {
    const idx = Number(raw);
    const isCorrect = question.correctOptionIndex !== null && idx === question.correctOptionIndex;
    return { grade: isCorrect ? 'correct' : 'incorrect', awarded: isCorrect ? worth : 0 };
  }

  // Without a key there is nothing to compare against — marking every answer
  // wrong would be worse than asking for a human (or AI) judgement.
  if (isSubjective(question.type) && question.acceptedAnswers.length === 0) {
    return { grade: 'pending', awarded: 0 };
  }

  const given = normalise(raw);
  const accepted = question.acceptedAnswers.map(normalise).filter(Boolean);
  const exact = accepted.some((a) => a === given);
  // A student writing a full sentence that contains the key phrase is still correct.
  // Sentence punctuation is dropped from word edges first, so "…of scattering." still
  // contains "scattering" (decimals such as "9.8" keep their point).
  const loose = (text: string) => text.split(' ').map((t) => t.replace(/^[.'-]+|[.'-]+$/g, '')).filter(Boolean);
  const givenWords = loose(given);
  const givenText = ` ${givenWords.join(' ')} `;
  const contains =
    !exact &&
    question.type !== 'long' &&
    accepted.some((a) => {
      const key = loose(a).join(' ');
      if (key.length < 3) return false;
      if (key.includes(' ')) return givenText.includes(` ${key} `);
      return givenWords.includes(key);
    });
  const close =
    !exact &&
    !contains &&
    question.type !== 'long' &&
    accepted.some((a) => {
      if (Math.abs(a.length - given.length) > 2) return false;
      const dist = editDistance(a, given);
      return dist <= (a.length > 4 ? 1 : 0);
    });

  if (exact || contains || close) {
    // Matching the key proves the idea is right, not that the answer is complete:
    // a one-phrase reply to a multi-mark written question cannot take full marks.
    if (isSubjective(question.type)) {
      const { cap } = substanceCap(question, raw);
      return { grade: 'correct', awarded: Math.min(worth, cap) };
    }
    return { grade: 'correct', awarded: worth };
  }
  if (question.type === 'long') return { grade: 'pending', awarded: 0 };
  return { grade: 'incorrect', awarded: 0 };
}

export function rankResponses(responses: Response[]): LeaderboardEntry[] {
  const byStudent = new Map<
    string,
    { name: string; points: number; answered: number; correct: number; pending: number; latency: number[]; order: number[] }
  >();

  for (const r of responses) {
    const entry =
      byStudent.get(r.studentId) ??
      { name: r.studentName, points: 0, answered: 0, correct: 0, pending: 0, latency: [], order: [] as number[] };
    entry.points += r.awarded;
    entry.answered += 1;
    if (r.grade === 'correct') entry.correct += 1;
    if (r.grade === 'pending') entry.pending += 1;
    entry.latency.push(r.latencyMs);
    entry.order.push(r.grade === 'correct' ? 1 : 0);
    byStudent.set(r.studentId, entry);
  }

  const rows = [...byStudent.entries()].map(([studentId, v]) => {
    // longest trailing streak of correct answers (fast + accurate = good)
    let streak = 0;
    for (let i = v.order.length - 1; i >= 0; i--) {
      if (v.order[i] === 1) streak++;
      else break;
    }
    return {
      studentId,
      name: v.name,
      points: v.points,
      answered: v.answered,
      correct: v.correct,
      pending: v.pending,
      avgLatencyMs: v.latency.length ? Math.round(v.latency.reduce((a, b) => a + b, 0) / v.latency.length) : 0,
      streak
    };
  });

  rows.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.correct !== a.correct) return b.correct - a.correct;
    return a.avgLatencyMs - b.avgLatencyMs;
  });

  return rows.map((r, i) => ({ ...r, rank: i + 1 }));
}

export function buildQuestionStat(
  question: Question,
  responses: Response[]
): QuestionStat {
  const mine = responses.filter((r) => r.questionId === question.id);
  const correct = mine.filter((r) => r.grade === 'correct').length;
  const pending = mine.filter((r) => r.grade === 'pending').length;
  const graded = mine.length - pending;
  const distribution =
    question.type === 'mcq' || question.type === 'truefalse'
      ? question.options.map((_, idx) => mine.filter((r) => Number(r.answer) === idx).length)
      : null;

  return {
    questionId: question.id,
    prompt: question.prompt,
    type: question.type,
    points: question.points,
    attempts: mine.length,
    correct,
    pending,
    accuracy: graded > 0 ? Math.round((correct / graded) * 100) : 0,
    avgLatencyMs: mine.length ? Math.round(mine.reduce((a, b) => a + b.latencyMs, 0) / mine.length) : 0,
    avgAwarded: mine.length ? Number((mine.reduce((a, b) => a + b.awarded, 0) / mine.length).toFixed(1)) : 0,
    optionDistribution: distribution
  };
}

export const TYPE_LABEL: Record<QuestionType, string> = {
  mcq: 'Multiple choice',
  truefalse: 'True / False',
  fill: 'Fill in the blank',
  short: 'Short answer',
  long: 'Long answer'
};

export const TYPE_SHORT: Record<QuestionType, string> = {
  mcq: 'MCQ',
  truefalse: 'T/F',
  fill: 'FILL',
  short: 'SHORT',
  long: 'LONG'
};

export function formatMs(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
