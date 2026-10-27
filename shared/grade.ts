import type { Grade, LeaderboardEntry, Question, QuestionStat, QuestionType, Response } from './types';

/** Normalise a free-text answer for tolerant comparison. */
export function normalise(value: string): string {
  return (value ?? '')
    .toString()
    .toLowerCase()
    .replace(/[\u2018\u2019\u201c\u201d]/g, "'")
    .replace(/[^a-z0-9\s.'-]/g, ' ')
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
  // A student writing a full sentence that contains the key phrase is still correct
  const contains =
    !exact &&
    question.type !== 'long' &&
    accepted.some((a) => {
      if (a.length < 3) return false;
      if (a.includes(' ')) return ` ${given} `.includes(` ${a} `);
      return given.split(' ').includes(a);
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

  if (exact || contains || close) return { grade: 'correct', awarded: worth };
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
