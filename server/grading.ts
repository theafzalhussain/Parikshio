import type { AiEvaluation, Exam, GradingStatus, Question, Response } from '../shared/types';
import { gradeAnswer, gradeForAward, isSubjective, rankResponses } from '../shared/grade';
import { config } from './config';
import { cache, cacheKeys } from './cache';
import { persist } from './mongo';
import { db, store } from './store';
import { emitExam, emitStaff, emitUser } from './realtime';
import { resultSealed, studentsSeeLeaderboard } from './sessionRules';
import {
  coolingModels,
  evaluateAnswer,
  evaluateBatch,
  GeminiError,
  modelWaitMs,
  quotaMessage,
  type EvaluationContext,
  type EvaluationResult
} from './gemini';

/**
 * Dual-mode grading engine.
 *
 *   Mode 1 — answer key (instant, deterministic): MCQ · True/False · Fill in the blank
 *            graded inside `submitAnswer()` by `gradeAnswer()`.
 *   Mode 2 — AI evaluation (async): Short · Long answers are queued here, scored
 *            by Gemini against the examiner's reference, and pushed to the admin
 *            control room the moment each result lands.
 *
 * Built for a whole class submitting at once: answers to the same question are
 * collected for a moment and graded in batches, so 60 students cost a handful
 * of API requests instead of 60 — which keeps the class inside Gemini's quotas.
 *
 * Guarantees:
 *   • Submission never waits on the AI — the student gets an instant receipt.
 *   • A faculty override always wins over an AI result that was requested
 *     before it (and an explicit AI re-run wins over an older override).
 *   • Busy / rate-limited models are waited out, not counted as failures.
 *   • If AI really cannot grade an answer, it is left for human review rather
 *     than being marked wrong; an exact key match still earns its marks.
 */

/** Wait this long after the first answer so the rest of the class joins the batch. */
const BATCH_WINDOW_MS = 1_200;
/** Keep batch prompts comfortably sized even for long essays. */
const MAX_BATCH_CHARS = 30_000;
/** Real attempts (a model answered badly or every model errored) before giving up. */
const MAX_ATTEMPTS = 3;
/** After this many attempts an answer is retried on its own, isolating a bad apple. */
const SOLO_AFTER_ATTEMPTS = 2;
/** Never let one answer wait on busy models longer than this. */
const MAX_WAIT_MS = 10 * 60_000;
const MAX_BULK = 500;

const queue: string[] = [];
const queued = new Set<string>();
const running = new Set<string>();
let activeBatches = 0;
let lastError: string | null = null;
let pumpTimer: NodeJS.Timeout | null = null;
let pumpDueAt = 0;

const asPersistable = (r: Response) => r as unknown as { id: string } & Record<string, unknown>;

/** Phrases that try to talk to the grader instead of answering the question. */
const INJECTION_RE =
  /\b(ignore|disregard|forget|override)\b[^.\n]{0,40}\b(instruction|prompt|rule|previous|above)s?\b|\b(award|give|assign|grant)\b[^.\n]{0,30}\b(full|maximum|max|all|10\/10|20\/20|100%)\b[^.\n]{0,20}\b(marks?|points?|score|credit)\b|\b(give|award|assign)\b[^.\n]{0,25}\b\d+\s*\/\s*\d+\b|\bsystem prompt\b|^\s*system\s*:|\byou are (now )?(an?|the) ([a-z]+ )?(grader|examiner|ai|assistant|model)\b/im;

export function looksLikeInjection(answer: string): boolean {
  return INJECTION_RE.test(answer);
}

export function aiGradingEnabled(): boolean {
  return config.gemini.enabled;
}

/** Should this submission be handed to the AI evaluator automatically? */
export function wantsAutoAi(question: Question, answer: string): boolean {
  return aiGradingEnabled() && config.gemini.autoGrade && isSubjective(question.type) && answer.trim().length > 0;
}

export function gradingStatus(): GradingStatus {
  const ai = aiGradingEnabled();
  return {
    ai: {
      enabled: ai,
      autoGrade: config.gemini.autoGrade,
      provider: 'gemini',
      models: [...config.gemini.models],
      cooling: coolingModels(),
      quotaExhausted: ai && modelWaitMs() === Infinity,
      queued: queued.size,
      running: running.size,
      lastError
    },
    // Without AI, short answers still match their key; long answers wait for a human.
    modes: { mcq: 'key', truefalse: 'key', fill: 'key', short: ai ? 'ai' : 'key', long: ai ? 'ai' : 'pending' }
  };
}

function evaluationContext(question: Question): EvaluationContext {
  return {
    type: question.type === 'long' ? 'long' : 'short',
    prompt: question.prompt,
    topic: question.topic,
    maxPoints: Number.isFinite(question.points) && question.points > 0 ? question.points : 1,
    referenceAnswers: question.acceptedAnswers,
    explanation: question.explanation ?? ''
  };
}

function errorMessage(err: unknown): string {
  return (err instanceof Error ? err.message : String(err ?? 'Unknown error')).slice(0, 300);
}

// ── broadcasting ──────────────────────────────────────────────
/**
 * Publishes a grade change everywhere it matters: the control room row, both
 * leaderboards, the cached analytics and — once the question has closed — the
 * student's own device. `final=false` is a progress update (queued / running)
 * that only the staff room needs.
 */
export function broadcastGradeChange(response: Response, final = true): void {
  const exam = db.examById(response.examId);
  if (!exam) return;
  emitStaff(exam.code, 'response:graded', { examId: exam.id, response });
  if (!final) return;

  void cache.delPrefix(cacheKeys.examPrefix(exam.id));
  emitLeaderboards(exam);

  // Grades unlock at lock time — never reveal one while the question is still
  // open, whether that is a live push or a self-paced set classmates are in.
  const stillOpen = resultSealed(exam, response.questionId);
  if (!stillOpen) {
    emitUser(response.studentId, 'answer:graded', {
      examId: exam.id,
      questionId: response.questionId,
      grade: response.grade,
      awarded: response.awarded
    });
  }
}

/**
 * Leaderboard recomputation is O(responses), so a batch of 10 results landing
 * together triggers one recompute per exam instead of ten.
 */
const leaderboardDue = new Map<string, NodeJS.Timeout>();
function emitLeaderboards(exam: Exam): void {
  if (leaderboardDue.has(exam.id)) return;
  leaderboardDue.set(
    exam.id,
    setTimeout(() => {
      leaderboardDue.delete(exam.id);
      const entries = rankResponses(db.responsesByExam(exam.id));
      if (studentsSeeLeaderboard(exam)) emitExam(exam.code, 'leaderboard:update', { examId: exam.id, entries });
      emitStaff(exam.code, 'leaderboard:update', { examId: exam.id, entries });
    }, 150)
  );
}

// ── outcome helpers ───────────────────────────────────────────
/**
 * A batch can outlive its answers: deleting a session removes them while the
 * model is still thinking. Writing a late result back would re-create the row
 * in MongoDB (persist upserts), so results for removed answers are dropped.
 */
function stillStored(response: Response): boolean {
  return db.responseById(response.id) === response;
}

/** Drops queued AI work for answers that no longer exist (their session was deleted). */
export function forgetAiWork(responseIds: Set<string>): void {
  if (!responseIds.size) return;
  for (let i = queue.length - 1; i >= 0; i--) {
    if (!responseIds.has(queue[i]!)) continue;
    queued.delete(queue[i]!);
    queue.splice(i, 1);
  }
}

function applyResult(response: Response, result: EvaluationResult, started: number): void {
  if (!stillStored(response)) return;
  const ai = response.ai!;
  const suspicious = result.injectionSuspected || looksLikeInjection(response.answer);
  const evaluation: AiEvaluation = {
    status: 'done',
    model: result.model,
    score: result.score,
    maxPoints: result.maxPoints,
    verdict: result.verdict,
    feedback: result.feedback,
    strengths: result.strengths,
    improvements: result.improvements,
    confidence: result.confidence,
    needsReview: suspicious || result.confidence < config.gemini.reviewBelowConfidence,
    attempts: ai.attempts,
    requestedAt: ai.requestedAt,
    completedAt: Date.now(),
    latencyMs: Date.now() - started
  };
  response.ai = evaluation;

  // A teacher who scored this by hand *after* asking for AI keeps their score;
  // the AI result is still stored alongside it as a second opinion.
  const overriddenByHuman = response.gradedBy === 'manual' && (response.gradedAt ?? 0) >= evaluation.requestedAt;
  if (!overriddenByHuman) {
    response.awarded = result.score;
    response.grade = gradeForAward(result.score);
    response.gradedBy = 'ai';
    response.manual = false;
    response.gradedAt = Date.now();
  }
  persist('responses', asPersistable(response));
  broadcastGradeChange(response, true);
}

function failResponse(response: Response, message: string, model?: string): void {
  if (!stillStored(response)) return;
  const ai = response.ai ?? { status: 'failed' as const, maxPoints: 0, attempts: 0, requestedAt: Date.now() };
  response.ai = {
    ...ai,
    status: 'failed',
    error: message,
    completedAt: Date.now(),
    latencyMs: Date.now() - ai.requestedAt,
    ...(model ? { model } : {})
  };
  // Fallback: an exact answer-key hit still earns its marks; anything else
  // waits for a human instead of being marked wrong because the AI was down.
  const question = db.questionById(response.questionId);
  if (question && response.grade === 'pending' && response.gradedBy !== 'manual') {
    const fallback = gradeAnswer(question, response.answer);
    if (fallback.grade === 'correct') {
      response.grade = 'correct';
      response.awarded = fallback.awarded;
      response.gradedBy = 'key';
      response.gradedAt = Date.now();
    }
  }
  console.warn(`[ai-grading] ${response.id} failed: ${message}`);
  persist('responses', asPersistable(response));
  broadcastGradeChange(response, true);
}

/** Puts responses back at the front of the queue (keeps arrival order). */
function requeue(responses: Response[]): void {
  const ids: string[] = [];
  for (const response of responses) {
    if (!stillStored(response)) continue;
    response.ai = { ...response.ai!, status: 'queued' };
    queued.add(response.id);
    ids.push(response.id);
    persist('responses', asPersistable(response));
    broadcastGradeChange(response, false);
  }
  queue.unshift(...ids);
}

// ── queue ─────────────────────────────────────────────────────
function schedulePump(delayMs: number): void {
  const dueAt = Date.now() + Math.max(0, delayMs);
  if (pumpTimer && pumpDueAt <= dueAt) return; // an earlier run is already booked
  if (pumpTimer) clearTimeout(pumpTimer);
  pumpDueAt = dueAt;
  // Always deferred so the caller (e.g. submitAnswer) finishes emitting
  // `response:new` before the first progress event for the same row goes out.
  pumpTimer = setTimeout(() => {
    pumpTimer = null;
    pump();
  }, Math.max(0, delayMs));
}

/** Pulls the next batch: oldest queued answer plus later ones to the same question. */
function takeBatch(): Response[] {
  const batch: Response[] = [];
  let chars = 0;
  let questionId: string | null = null;
  let limit = config.gemini.batchSize;

  for (let i = 0; i < queue.length && batch.length < limit; ) {
    const response = db.responseById(queue[i]);
    if (!response?.ai) {
      queued.delete(queue[i]);
      queue.splice(i, 1);
      continue;
    }
    if (questionId === null) {
      questionId = response.questionId;
      // An answer that keeps failing is retried alone so it cannot sink others.
      if (response.ai.attempts >= SOLO_AFTER_ATTEMPTS) limit = 1;
    } else if (response.questionId !== questionId || response.ai.attempts >= SOLO_AFTER_ATTEMPTS) {
      i++;
      continue;
    }
    if (batch.length > 0 && chars + response.answer.length > MAX_BATCH_CHARS) break;
    chars += response.answer.length;
    batch.push(response);
    queued.delete(queue[i]);
    queue.splice(i, 1);
  }
  return batch;
}

function pump(): void {
  while (activeBatches < config.gemini.concurrency && queue.length) {
    const wait = modelWaitMs();
    if (wait === Infinity) {
      // Every model is out of quota for hours: tell the teacher now instead of
      // leaving the whole class spinning.
      const message = quotaMessage();
      lastError = message;
      const stranded = queue.splice(0).map((id) => db.responseById(id)).filter((r): r is Response => !!r?.ai);
      queued.clear();
      stranded.forEach((r) => failResponse(r, message));
      return;
    }
    if (wait > 0) {
      schedulePump(wait);
      return;
    }
    const batch = takeBatch();
    if (!batch.length) continue;
    activeBatches++;
    batch.forEach((r) => running.add(r.id));
    void runBatch(batch).finally(() => {
      activeBatches--;
      batch.forEach((r) => running.delete(r.id));
      if (queue.length) schedulePump(0);
    });
  }
}

async function runBatch(batch: Response[]): Promise<void> {
  const started = Date.now();
  const question = db.questionById(batch[0].questionId);
  if (!question || !isSubjective(question.type)) {
    batch.forEach((r) => failResponse(r, 'Question no longer exists or is not subjective'));
    return;
  }

  for (const response of batch) {
    response.ai = { ...response.ai!, status: 'running', attempts: response.ai!.attempts + 1, maxPoints: question.points };
    persist('responses', asPersistable(response));
    broadcastGradeChange(response, false);
  }

  try {
    const outcome = await evaluateBatch(
      evaluationContext(question),
      batch.map((r) => ({ key: r.id, answer: r.answer }))
    );
    lastError = null;
    const skipped: Response[] = [];
    for (const response of batch) {
      const result = outcome.results.get(response.id);
      if (result) applyResult(response, result, started);
      else skipped.push(response);
    }
    // The model occasionally drops an item from a long batch — retry just those.
    retryOrFail(skipped, `${outcome.model} skipped this answer`, outcome.model);
  } catch (err) {
    const message = errorMessage(err);
    lastError = message;
    const kind = err instanceof GeminiError ? err.kind : 'unavailable';
    const model = err instanceof GeminiError ? err.model : undefined;
    if (kind === 'config' || kind === 'quota') {
      batch.forEach((r) => failResponse(r, message, model));
      return;
    }
    // Rate limited / overloaded is waiting, not a failed attempt. `retryOrFail`
    // still gives up once an answer has waited MAX_WAIT_MS.
    if (kind === 'busy') batch.forEach((r) => (r.ai!.attempts = Math.max(0, r.ai!.attempts - 1)));
    retryOrFail(batch, message, model);
  }
}

function retryOrFail(responses: Response[], message: string, model?: string): void {
  if (!responses.length) return;
  const retry: Response[] = [];
  for (const response of responses) {
    const waitedTooLong = Date.now() - response.ai!.requestedAt > MAX_WAIT_MS;
    if (response.ai!.attempts >= MAX_ATTEMPTS || waitedTooLong) failResponse(response, message, model);
    else retry.push(response);
  }
  if (retry.length) requeue(retry);
}

export type QueueResult =
  | { ok: true; queued: boolean; response: Response }
  | { ok: false; status: number; error: string };

/**
 * Queues one response for AI evaluation.
 * `silent` skips persisting/broadcasting — used by `submitAnswer`, which does
 * both itself right after creating the row.
 */
export function requestAiEvaluation(response: Response, options: { silent?: boolean } = {}): QueueResult {
  if (!aiGradingEnabled()) {
    return { ok: false, status: 503, error: 'AI grading is not configured on this server (set GEMINI_API_KEY).' };
  }
  const question = db.questionById(response.questionId);
  if (!question) return { ok: false, status: 404, error: 'The question for this response no longer exists' };
  if (!isSubjective(question.type)) {
    return {
      ok: false,
      status: 400,
      error: 'AI evaluation is for short and long answers. MCQ, True/False and Fill in the blank are graded by the answer key.'
    };
  }
  if (!response.answer.trim()) return { ok: false, status: 400, error: 'This response is empty — there is nothing to evaluate' };
  if (queued.has(response.id) || running.has(response.id)) return { ok: true, queued: false, response };

  // Each request gets a fresh attempt budget; the timestamp decides who wins
  // against a manual override.
  response.ai = { status: 'queued', maxPoints: question.points, attempts: 0, requestedAt: Date.now() };
  queue.push(response.id);
  queued.add(response.id);
  if (!options.silent) {
    persist('responses', asPersistable(response));
    broadcastGradeChange(response, false);
  }
  // Always open a short collection window: arrivals inside it coalesce into one
  // batch instead of each spare worker firing a request for a single answer.
  schedulePump(BATCH_WINDOW_MS);
  return { ok: true, queued: true, response };
}

export type BulkScope = 'pending' | 'all';

/**
 * Queues every subjective response of a session.
 * - `pending` → still awaiting a grade, or the last AI attempt failed
 * - `all`     → every non-empty subjective answer that a teacher has not scored by hand
 */
export function queueExamAiEvaluations(exam: Exam, scope: BulkScope): { queued: number; skipped: number } {
  let count = 0;
  let skipped = 0;
  for (const response of db.responsesByExam(exam.id)) {
    const question = db.questionById(response.questionId);
    if (!question || !isSubjective(question.type) || !response.answer.trim()) continue;
    if (response.gradedBy === 'manual') continue;
    if (queued.has(response.id) || running.has(response.id)) {
      skipped++;
      continue;
    }
    const eligible = scope === 'all' || response.grade === 'pending' || response.ai?.status === 'failed';
    if (!eligible) continue;
    if (count >= MAX_BULK) {
      skipped++;
      continue;
    }
    const result = requestAiEvaluation(response);
    if (result.ok && result.queued) count++;
  }
  return { queued: count, skipped };
}

/** Dry-run evaluation — nothing is stored. Powers the "test the grader" endpoint. */
export async function previewEvaluation(question: Question, answer: string): Promise<EvaluationResult & { needsReview: boolean }> {
  const wait = modelWaitMs();
  if (wait === Infinity) throw new GeminiError(quotaMessage(), 'quota');
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(wait, 15_000)));
  const result = await evaluateAnswer({ ...evaluationContext(question), answer });
  const suspicious = result.injectionSuspected || looksLikeInjection(answer);
  return {
    ...result,
    injectionSuspected: suspicious,
    needsReview: suspicious || result.confidence < config.gemini.reviewBelowConfidence
  };
}

/** Re-queues evaluations that were interrupted by a restart. */
export function resumeAiQueue(): void {
  const interrupted = store.responses.filter((r) => r.ai && (r.ai.status === 'queued' || r.ai.status === 'running'));
  if (!interrupted.length) return;
  for (const response of interrupted) {
    if (!aiGradingEnabled()) {
      response.ai = { ...response.ai!, status: 'failed', error: 'AI grading was disabled when the server restarted', completedAt: Date.now() };
      persist('responses', asPersistable(response));
      continue;
    }
    response.ai = { ...response.ai!, status: 'queued', attempts: 0, requestedAt: Date.now() };
    queue.push(response.id);
    queued.add(response.id);
  }
  if (aiGradingEnabled()) {
    console.log(`[ai-grading] resuming ${interrupted.length} interrupted evaluation(s)`);
    schedulePump(BATCH_WINDOW_MS);
  }
}
