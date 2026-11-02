import crypto from 'node:crypto';
import type { AnswerReveal, Exam, Question, QuestionRevealKit, Response } from '../shared/types';
import { hasDevanagari, requiredAnswerWords } from '../shared/grade';
import { config } from './config';
import { generateModelAnswer } from './gemini';
import { persist } from './mongo';
import { resultSealed } from './sessionRules';
import { db } from './store';
import { cachedTranslation, questionTranslation, translateExamTexts, translationEnabled } from './translate';

/**
 * The answer reveal on student devices.
 *
 * When a live question locks (faculty pressed Lock, or its timer ran out),
 * every student who did not earn full marks — a wrong answer, partial marks,
 * or no answer at all — is shown the right answer: the correct option, the
 * examiner's accepted answers or, for written questions without a key, a model
 * answer written by the AI grader. A student whose written answer was scored by
 * the AI also sees what the evaluator said about it. A student who answered in
 * Hindi gets all of it in Hindi too.
 *
 * Nothing here is ever sent while the question is open (`resultSealed`), and a
 * student with full marks gets no reveal. Slow parts (the AI model answer, DeepL
 * translations) run in the background; the student's view refreshes when each
 * one is ready, so a lock never waits on them.
 */

/** A failed AI / DeepL step is retried after this long, not on every refresh. */
const RETRY_AFTER_MS = 2 * 60_000;
/** Answers whose AI feedback is translated in one DeepL request. */
const FEEDBACK_BATCH = 8;
const FEEDBACK_FLUSH_MS = 400;
const FEEDBACK_CACHE_MAX = 5_000;

type RevealReady = (examId: string, studentId?: string) => void;
let notifyReady: RevealReady | null = null;

/** The engine registers how a refreshed view reaches students (avoids an import cycle). */
export function onRevealReady(handler: RevealReady): void {
  notifyReady = handler;
}

const objective = (q: Pick<Question, 'type'>) => q.type === 'mcq' || q.type === 'truefalse';

/** The examiner's accepted answers for a written question, as shown to students. */
function keyAnswers(q: Question): string[] {
  if (objective(q)) return [];
  return q.acceptedAnswers.map((a) => a.trim()).filter(Boolean).slice(0, 5);
}

/** Written questions with no key get an AI model answer (when AI is configured). */
function wantsModelAnswer(q: Question): boolean {
  return !objective(q) && keyAnswers(q).length === 0 && config.gemini.enabled;
}

// ── per-question kit (cached on the question) ─────────────────

function kitHash(q: Question): string {
  return crypto
    .createHash('sha256')
    .update(
      JSON.stringify([q.type, q.prompt, q.options, q.correctOptionIndex, q.acceptedAnswers, q.explanation, q.points, q.minAnswerWords ?? null])
    )
    .digest('hex')
    .slice(0, 24);
}

/** The kit, if it still matches the question as it is now. */
function kitOf(q: Question): QuestionRevealKit | null {
  const kit = q.revealKit;
  return kit && kit.sourceHash === kitHash(q) ? kit : null;
}

/** Stores part of the kit unless the question was edited while it was being made. */
function writeKit(q: Question, hash: string, patch: Omit<Partial<QuestionRevealKit>, 'sourceHash'>): boolean {
  if (kitHash(q) !== hash) return false;
  q.revealKit = { ...(kitOf(q) ?? {}), ...patch, sourceHash: hash };
  persist('questions', q as unknown as { id: string } & Record<string, unknown>);
  return true;
}

/** Someone reads this question in Hindi, or answered it in Hindi. */
function hindiWanted(q: Question, rows: Response[]): boolean {
  if (!translationEnabled()) return false;
  if (cachedTranslation(q, 'hi')) return true;
  return rows.some((r) => hasDevanagari(r.answer));
}

// ── background jobs ───────────────────────────────────────────

const jobs = new Map<string, Set<string>>();
const failedAt = new Map<string, number>();

function recentlyFailed(key: string): boolean {
  const at = failedAt.get(key);
  return at !== undefined && Date.now() - at < RETRY_AFTER_MS;
}

/**
 * Runs `work` once per key; every exam that asked meanwhile is refreshed when
 * it finishes (also after a failure, so "preparing" never sticks).
 */
function runOnce(key: string, examId: string, work: () => Promise<void>): void {
  const waiting = jobs.get(key);
  if (waiting) {
    waiting.add(examId);
    return;
  }
  if (recentlyFailed(key)) return;
  const exams = new Set([examId]);
  jobs.set(key, exams);
  work()
    .then(
      () => failedAt.delete(key),
      (err: unknown) => {
        failedAt.set(key, Date.now());
        console.warn(`[reveal] ${key}: ${(err as Error)?.message ?? err}`);
      }
    )
    .finally(() => {
      jobs.delete(key);
      exams.forEach((id) => notifyReady?.(id));
    });
}

/** Still waiting on this step: it is running, or about to be started. */
function pending(key: string): boolean {
  return jobs.has(key) || !recentlyFailed(key);
}

function modelAnswerKey(q: Question) {
  return `model:${q.id}:${kitHash(q)}`;
}
function keyHindiKey(q: Question) {
  return `key-hi:${q.id}:${kitHash(q)}`;
}
function promptHindiKey(q: Question) {
  return `prompt-hi:${q.id}`;
}

function needsModelAnswer(q: Question): boolean {
  return wantsModelAnswer(q) && !kitOf(q)?.modelAnswer;
}

function keyHindiTexts(q: Question): string[] {
  return [...keyAnswers(q), q.explanation.trim()];
}

function needsKeyHindi(q: Question, wantHindi: boolean): boolean {
  if (kitOf(q)?.hi) return false;
  return wantHindi && keyHindiTexts(q).some(Boolean);
}

function needsPromptHindi(q: Question, wantHindi: boolean): boolean {
  return wantHindi && translationEnabled() && !cachedTranslation(q, 'hi');
}

/** Starts whatever the question's reveal still lacks. */
function prepareQuestion(examId: string, q: Question, wantHindi: boolean): void {
  if (needsModelAnswer(q)) {
    const hash = kitHash(q);
    runOnce(modelAnswerKey(q), examId, async () => {
      const answer = await generateModelAnswer({
        type: q.type as 'fill' | 'short' | 'long',
        prompt: q.prompt,
        topic: q.topic,
        maxPoints: q.points > 0 ? q.points : 1,
        minWords: requiredAnswerWords(q),
        explanation: q.explanation ?? '',
        translatedPrompt: cachedTranslation(q, 'hi')?.prompt
      });
      writeKit(q, hash, { modelAnswer: { ...answer, createdAt: Date.now() } });
    });
  }
  if (needsPromptHindi(q, wantHindi)) {
    runOnce(promptHindiKey(q), examId, async () => {
      await questionTranslation(q, 'hi');
    });
  }
  if (needsKeyHindi(q, wantHindi)) {
    const hash = kitHash(q);
    runOnce(keyHindiKey(q), examId, async () => {
      const texts = keyHindiTexts(q);
      const sendable = texts.map((t, i) => ({ t, i })).filter(({ t }) => t);
      const translated = await translateExamTexts(
        sendable.map(({ t }) => t),
        'hi',
        `Answer key of an exam question${q.topic ? ` (subject: ${q.topic})` : ''}. Translate faithfully and formally for a Hindi-medium classroom; do not add anything. The question is: ${q.prompt}`
      );
      const out = texts.map(() => '');
      sendable.forEach(({ i }, n) => {
        out[i] = translated[n] ?? '';
      });
      const explanation = out.pop() ?? '';
      writeKit(q, hash, { hi: { answers: out, explanation, translatedAt: Date.now() } });
    });
  }
}

// ── the student's own AI feedback, in Hindi ───────────────────

interface FeedbackHindi {
  stamp: number;
  feedback: string;
  strengths: string[];
  improvements: string[];
}

const feedbackHindi = new Map<string, FeedbackHindi>();
const feedbackQueue = new Map<string, string>(); // response id → exam id
const feedbackRunning = new Set<string>();
const feedbackFailedAt = new Map<string, number>();
let feedbackTimer: NodeJS.Timeout | null = null;

const feedbackStamp = (r: Response) => r.ai?.completedAt ?? r.ai?.requestedAt ?? 0;

/** The AI's words about this answer, when they still describe its current score. */
function aiFeedback(r: Response | undefined) {
  if (!r?.ai || r.ai.status !== 'done' || r.gradedBy !== 'ai' || !r.ai.feedback) return null;
  return { text: r.ai.feedback, strengths: r.ai.strengths ?? [], improvements: r.ai.improvements ?? [] };
}

function cachedFeedbackHindi(r: Response): FeedbackHindi | null {
  const hit = feedbackHindi.get(r.id);
  return hit && hit.stamp === feedbackStamp(r) ? hit : null;
}

function wantsFeedbackHindi(r: Response): boolean {
  return translationEnabled() && !!aiFeedback(r) && hasDevanagari(r.answer) && !cachedFeedbackHindi(r);
}

function feedbackPending(r: Response): boolean {
  if (feedbackQueue.has(r.id) || feedbackRunning.has(r.id)) return true;
  const failed = feedbackFailedAt.get(r.id);
  return !(failed !== undefined && Date.now() - failed < RETRY_AFTER_MS);
}

function queueFeedbackHindi(examId: string, r: Response): void {
  if (!wantsFeedbackHindi(r) || feedbackQueue.has(r.id) || feedbackRunning.has(r.id)) return;
  const failed = feedbackFailedAt.get(r.id);
  if (failed !== undefined && Date.now() - failed < RETRY_AFTER_MS) return;
  feedbackQueue.set(r.id, examId);
  if (!feedbackTimer) feedbackTimer = setTimeout(() => void flushFeedback(), FEEDBACK_FLUSH_MS);
}

/** Translates queued feedback a question at a time, a few answers per DeepL request. */
async function flushFeedback(): Promise<void> {
  feedbackTimer = null;
  const batch = [...feedbackQueue.entries()];
  feedbackQueue.clear();
  const byQuestion = new Map<string, { examId: string; response: Response }[]>();
  for (const [responseId, examId] of batch) {
    const response = db.responsesByExam(examId).find((r) => r.id === responseId);
    if (!response || !aiFeedback(response)) continue;
    feedbackRunning.add(response.id);
    const rows = byQuestion.get(response.questionId) ?? [];
    rows.push({ examId, response });
    byQuestion.set(response.questionId, rows);
  }

  for (const [questionId, rows] of byQuestion) {
    const question = db.questionById(questionId);
    for (let i = 0; i < rows.length; i += FEEDBACK_BATCH) {
      const chunk = rows.slice(i, i + FEEDBACK_BATCH);
      const texts: string[] = [];
      const layout = chunk.map(({ response }) => {
        const fb = aiFeedback(response)!;
        const start = texts.length;
        texts.push(fb.text, ...fb.strengths, ...fb.improvements);
        return { response, stamp: feedbackStamp(response), start, strengths: fb.strengths.length, improvements: fb.improvements.length };
      });
      try {
        const translated = await translateExamTexts(
          texts,
          'hi',
          `An examiner's comments on a student's exam answer${question?.prompt ? ` to the question: ${question.prompt}` : ''}. Translate faithfully for a Hindi-medium student.`
        );
        for (const row of layout) {
          let at = row.start;
          const feedback = translated[at++] ?? '';
          const strengths = translated.slice(at, at + row.strengths);
          at += row.strengths;
          const improvements = translated.slice(at, at + row.improvements);
          if (feedbackHindi.size >= FEEDBACK_CACHE_MAX) {
            const oldest = feedbackHindi.keys().next().value;
            if (oldest !== undefined) feedbackHindi.delete(oldest);
          }
          feedbackHindi.set(row.response.id, { stamp: row.stamp, feedback, strengths, improvements });
          feedbackFailedAt.delete(row.response.id);
        }
      } catch (err) {
        console.warn(`[reveal] feedback translation for ${questionId}: ${(err as Error)?.message ?? err}`);
        chunk.forEach(({ response }) => feedbackFailedAt.set(response.id, Date.now()));
      }
      for (const { examId, response } of chunk) {
        feedbackRunning.delete(response.id);
        notifyReady?.(examId, response.studentId);
      }
    }
  }
}

// ── entry points ──────────────────────────────────────────────

/** At push time: start the AI model answer early, so it is ready by the lock. Nothing reaches students. */
export function warmReveal(exam: Exam, q: Question): void {
  if (needsModelAnswer(q)) prepareQuestion(exam.id, q, false);
}

/** At lock time: prepare the question's reveal and the Hindi feedback of everyone who needs it. */
export function prepareReveal(exam: Exam, questionId: string): void {
  const q = db.questionById(questionId);
  if (!q) return;
  const rows = db.responsesByExamQuestion(exam.id, q.id);
  prepareQuestion(exam.id, q, hindiWanted(q, rows));
  for (const r of rows) {
    if (r.grade !== 'pending' && r.awarded < q.points) queueFeedbackHindi(exam.id, r);
  }
}

/** A grade that landed after the lock (AI or a teacher): its Hindi feedback may now be needed. */
export function noteLateGrade(r: Response): void {
  const exam = db.examById(r.examId);
  const q = db.questionById(r.questionId);
  if (!exam || !q || resultSealed(exam, r.questionId)) return;
  if (r.grade !== 'pending' && r.awarded < q.points) queueFeedbackHindi(exam.id, r);
}

/**
 * The reveals one student gets, for the given closed live questions (newest
 * first). Skips questions still open, answers still being graded and full marks.
 */
export function buildReveals(exam: Exam, studentId: string, questionIds: string[]): AnswerReveal[] {
  const out: AnswerReveal[] = [];
  for (const questionId of questionIds) {
    if (resultSealed(exam, questionId)) continue;
    const q = db.questionById(questionId);
    if (!q) continue;
    const rows = db.responsesByExamQuestion(exam.id, q.id);
    const mine = rows.find((r) => r.studentId === studentId);
    if (mine && mine.grade === 'pending') continue;
    if (mine && mine.awarded >= q.points) continue;

    const wantHindi = hindiWanted(q, rows);
    prepareQuestion(exam.id, q, wantHindi);
    if (mine) queueFeedbackHindi(exam.id, mine);

    const kit = kitOf(q);
    const keys = keyAnswers(q);
    const model = keys.length ? null : kit?.modelAnswer ?? null;
    const answerSource: AnswerReveal['answerSource'] = objective(q) || keys.length ? 'key' : model ? 'ai' : 'none';
    const feedback = aiFeedback(mine);
    const explanation = q.explanation?.trim() || undefined;

    let preparing = false;
    if (needsModelAnswer(q) && pending(modelAnswerKey(q))) preparing = true;
    if (needsKeyHindi(q, wantHindi) && pending(keyHindiKey(q))) preparing = true;
    if (needsPromptHindi(q, wantHindi) && pending(promptHindiKey(q))) preparing = true;
    if (mine && wantsFeedbackHindi(mine) && feedbackPending(mine)) preparing = true;

    const promptHi = cachedTranslation(q, 'hi');
    const feedbackHi = mine ? cachedFeedbackHindi(mine) : null;
    const hindi: NonNullable<AnswerReveal['hindi']> = {};
    if (promptHi?.prompt) hindi.prompt = promptHi.prompt;
    if (objective(q) && promptHi?.options.length) hindi.options = promptHi.options;
    if (answerSource === 'key' && kit?.hi?.answers.some(Boolean)) hindi.answers = kit.hi.answers;
    if (answerSource === 'ai' && model?.hi) hindi.answers = [model.hi];
    if (explanation && kit?.hi?.explanation) hindi.explanation = kit.hi.explanation;
    if (feedback && feedbackHi) {
      hindi.feedback = feedbackHi.feedback;
      hindi.strengths = feedbackHi.strengths;
      hindi.improvements = feedbackHi.improvements;
    }

    out.push({
      questionId: q.id,
      index: exam.questionIds.indexOf(q.id) + 1,
      type: q.type,
      prompt: q.prompt,
      options: objective(q) ? q.options : [],
      points: q.points,
      outcome: !mine ? 'unanswered' : mine.awarded > 0 ? 'partial' : 'incorrect',
      awarded: mine?.awarded ?? 0,
      myAnswer: mine?.answer ?? null,
      ...(objective(q) && q.correctOptionIndex !== null ? { correctOptionIndex: q.correctOptionIndex } : {}),
      answers: keys.length ? keys : model ? [model.en] : [],
      answerSource,
      ...(explanation ? { explanation } : {}),
      ...(feedback ? { feedback } : {}),
      ...(Object.keys(hindi).length ? { hindi } : {}),
      answeredInHindi: !!mine && hasDevanagari(mine.answer),
      preparing
    });
  }
  return out;
}
