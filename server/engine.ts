import type {
  ActiveWindow,
  Analytics,
  Exam,
  ExamPublic,
  LeaderboardEntry,
  PublicUser,
  Question,
  QuestionStat,
  QuestionType,
  Response,
  StudentQuestion
} from '../shared/types';
import { buildQuestionStat, gradeAnswer, rankResponses } from '../shared/grade';
import { config } from './config';
import { cache, cacheKeys } from './cache';
import { persist } from './mongo';
import { db, examCode, store, uid } from './store';
import { emitExam, emitStaff } from './realtime';

const lockTimers = new Map<string, NodeJS.Timeout>();

export function sanitizeQuestion(q: Question): StudentQuestion {
  return {
    id: q.id,
    type: q.type,
    prompt: q.prompt,
    topic: q.topic,
    difficulty: q.difficulty,
    options: q.options,
    points: q.points,
    timerSeconds: q.timerSeconds
  };
}

export function activeWindow(exam: Exam): (ActiveWindow & { question: StudentQuestion }) | null {
  if (!exam.current) return null;
  const question = db.questionById(exam.current.questionId);
  if (!question) return null;
  return {
    questionId: question.id,
    question: sanitizeQuestion(question),
    index: exam.questionIds.indexOf(question.id) + 1,
    total: exam.questionIds.length,
    pushedAt: exam.current.pushedAt,
    endsAt: exam.current.endsAt,
    locked: exam.current.locked
  };
}

export function buildExamPublic(exam: Exam, studentId?: string): ExamPublic {
  const myAnswers: ExamPublic['myAnswers'] = {};
  if (studentId) {
    for (const r of db.responsesByExam(exam.id).filter((r) => r.studentId === studentId)) {
      const isCurrent = exam.current?.questionId === r.questionId && !exam.current?.locked;
      myAnswers[r.questionId] = {
        answer: r.answer,
        grade: isCurrent ? 'pending' : r.grade,
        awarded: isCurrent ? 0 : r.awarded
      };
    }
  }
  return {
    id: exam.id,
    code: exam.code,
    title: exam.title,
    subject: exam.subject,
    status: exam.status,
    totalQuestions: exam.questionIds.length,
    active: activeWindow(exam),
    myAnswers,
    endedAt: exam.endedAt
  };
}

export function getLeaderboard(examId: string): LeaderboardEntry[] {
  return rankResponses(db.responsesByExam(examId));
}

export async function cachedLeaderboard(examId: string): Promise<LeaderboardEntry[]> {
  const key = cacheKeys.leaderboard(examId);
  const hit = await cache.get<LeaderboardEntry[]>(key);
  if (hit) return hit;
  const fresh = getLeaderboard(examId);
  await cache.set(key, fresh, 4);
  return fresh;
}

export async function pushQuestion(
  exam: Exam,
  questionId: string,
  overrideSeconds?: number
): Promise<{ ok: true } | { ok: false; error: string }> {
  const question = db.questionById(questionId);
  if (!question) return { ok: false, error: 'Question not found' };
  if (!exam.questionIds.includes(questionId)) return { ok: false, error: 'Question is not part of this exam' };
  // Pushing into a finished exam used to flip it back to 'live' while keeping
  // `endedAt` set, leaving the session in a state no screen renders correctly.
  if (exam.status === 'ended') return { ok: false, error: 'This session has already ended' };

  // Close the outgoing question properly instead of abandoning it: without this
  // it stays unlocked forever, never emits its final leaderboard, and in-flight
  // answers are rejected as "no longer active".
  if (exam.current && !exam.current.locked) lockQuestion(exam);

  const now = Date.now();
  const requested = Number(overrideSeconds ?? question.timerSeconds);
  // A NaN here would make `endsAt` NaN, and `now > NaN` is always false — the
  // question would never time out.
  const safeSeconds = Number.isFinite(requested) ? requested : 60;
  const seconds = Math.max(5, Math.min(3600, Math.trunc(safeSeconds)));
  const endsAt = now + seconds * 1000;

  exam.current = { questionId, pushedAt: now, endsAt, locked: false };
  exam.status = 'live';
  persist('exams', exam as unknown as { id: string } & Record<string, unknown>);
  await cache.delPrefix(cacheKeys.examPrefix(exam.id));

  const active = activeWindow(exam);
  if (active) {
    emitExam(exam.code, 'question:pushed', { examId: exam.id, active });
    emitExam(exam.code, 'time:sync', { serverTime: Date.now() });
  }

  const existing = lockTimers.get(exam.id);
  if (existing) clearTimeout(existing);
  // Lock after the grace window so answers that were in flight at the buzzer are
  // included in the final leaderboard this timer emits.
  const lockAt = endsAt + config.graceMs;
  lockTimers.set(
    exam.id,
    setTimeout(() => {
      lockQuestion(exam);
    }, Math.max(0, lockAt - Date.now()))
  );

  return { ok: true };
}

export function lockQuestion(exam: Exam): void {
  if (!exam.current || exam.current.locked) return;
  exam.current.locked = true;
  persist('exams', exam as unknown as { id: string } & Record<string, unknown>);
  void cache.delPrefix(cacheKeys.examPrefix(exam.id));
  emitExam(exam.code, 'question:locked', { examId: exam.id, questionId: exam.current.questionId });
  emitExam(exam.code, 'leaderboard:update', { examId: exam.id, entries: getLeaderboard(exam.id) });
  emitStaff(exam.code, 'leaderboard:update', { examId: exam.id, entries: getLeaderboard(exam.id) });
  const timer = lockTimers.get(exam.id);
  if (timer) clearTimeout(timer);
  lockTimers.delete(exam.id);
}

export function endExam(exam: Exam): void {
  exam.status = 'ended';
  exam.endedAt = Date.now();
  exam.current = null;
  const timer = lockTimers.get(exam.id);
  if (timer) clearTimeout(timer);
  lockTimers.delete(exam.id);
  persist('exams', exam as unknown as { id: string } & Record<string, unknown>);
  void cache.delPrefix(cacheKeys.examPrefix(exam.id));
  emitExam(exam.code, 'exam:ended', { examId: exam.id });
  emitStaff(exam.code, 'exam:ended', { examId: exam.id });
}

export type SubmitResult =
  | { ok: true; response: Response }
  | { ok: false; code: number; error: string };

export function submitAnswer(
  exam: Exam,
  student: PublicUser,
  payload: { questionId: string; answer: string }
): SubmitResult {
  if (exam.status !== 'live') return { ok: false, code: 409, error: 'This exam is not live right now' };
  if (!exam.current) return { ok: false, code: 409, error: 'No question is live right now' };
  if (exam.current.questionId !== payload.questionId)
    return { ok: false, code: 409, error: 'That question is no longer active' };

  const now = Date.now();
  // The grace window exists for answers that were already travelling when the
  // timer hit zero. It used to be computed as `locked ? 0 : graceMs`, but the
  // lock timer fired exactly at `endsAt`, so by the time `now > endsAt` the flag
  // was always true and the allowance was never actually granted.
  const deadline = exam.current.endsAt + config.graceMs;
  if (now > deadline) return { ok: false, code: 409, error: 'Time is up for this question' };

  const question = db.questionById(payload.questionId);
  if (!question) return { ok: false, code: 404, error: 'Question not found' };

  const duplicate = db
    .responsesByExamQuestion(exam.id, question.id)
    .find((r) => r.studentId === student.id);
  if (duplicate) return { ok: false, code: 409, error: 'You already answered this question' };

  const { grade, awarded } = gradeAnswer(question, payload.answer);
  const response: Response = {
    id: uid('rsp_'),
    examId: exam.id,
    questionId: question.id,
    studentId: student.id,
    studentName: student.name,
    answer: payload.answer,
    submittedAt: now,
    latencyMs: Math.max(0, now - exam.current.pushedAt),
    grade,
    awarded,
    manual: false
  };
  store.responses.push(response);
  persist('responses', response as unknown as { id: string } & Record<string, unknown>);
  void cache.del(cacheKeys.leaderboard(exam.id), cacheKeys.analytics(exam.id));

  emitStaff(exam.code, 'response:new', {
    examId: exam.id,
    response,
    questionPrompt: question.prompt
  });
  emitExam(exam.code, 'leaderboard:update', { examId: exam.id, entries: getLeaderboard(exam.id) });

  return { ok: true, response };
}

export function manualGrade(response: Response, awarded: number): Response {
  const question = db.questionById(response.questionId);
  // Cap at what the question is actually worth, and never let a non-finite
  // value through — one NaN award turns every leaderboard total into NaN.
  const ceiling = Number.isFinite(question?.points) ? (question!.points as number) : 999;
  const safe = Number.isFinite(awarded) ? awarded : 0;
  response.awarded = Math.max(0, Math.min(safe, ceiling));
  response.manual = true;
  // Any partial credit counts as graded; 'pending' would mean "still needs a
  // human", which is exactly what just happened.
  response.grade = response.awarded > 0 ? 'correct' : 'incorrect';
  persist('responses', response as unknown as { id: string } & Record<string, unknown>);
  const exam = db.examById(response.examId);
  if (exam) {
    void cache.delPrefix(cacheKeys.examPrefix(exam.id));
    emitExam(exam.code, 'leaderboard:update', { examId: exam.id, entries: getLeaderboard(exam.id) });
    emitStaff(exam.code, 'leaderboard:update', { examId: exam.id, entries: getLeaderboard(exam.id) });
  }
  return response;
}

/**
 * Latency histogram. Bucket width scales with the session (short quizzes are
 * measured in seconds, long-form papers in minutes) instead of a fixed ladder,
 * so the chart never collapses into one bar.
 */
function latencyBuckets(rows: Response[]) {
  if (!rows.length) return [];
  // `Math.max(...rows.map(...))` passes one argument per response and throws
  // RangeError once a session gets large, so fold instead of spreading.
  const maxLatency = rows.reduce((acc, r) => Math.max(acc, r.latencyMs), 1_000);
  const rawStep = maxLatency / 4;
  const niceSteps = [2, 5, 10, 15, 30, 60, 120, 300];
  const stepSeconds = niceSteps.find((s) => s * 1000 >= rawStep) ?? 600;
  const step = stepSeconds * 1000;
  return Array.from({ length: 4 }, (_, i) => {
    const min = i * step;
    const max = (i + 1) * step;
    return {
      label: `${i === 3 ? `${min / 1000}s+` : `${min / 1000}–${max / 1000}s`}`,
      count: rows.filter((r) => (i === 3 ? r.latencyMs >= min : r.latencyMs >= min && r.latencyMs < max)).length
    };
  });
}

export function analytics(examId: string): Analytics | null {
  const exam = db.examById(examId);
  if (!exam) return null;

  const responses = db.responsesByExam(examId);
  const questions = exam.questionIds
    .map((id) => db.questionById(id))
    .filter((q): q is Question => !!q);
  const students = [...new Set(responses.map((r) => r.studentId))];
  const graded = responses.filter((r) => r.grade !== 'pending');
  const correct = responses.filter((r) => r.grade === 'correct');
  const maxPossible = questions.reduce((a, q) => a + q.points, 0);
  const board = rankResponses(responses);
  const totalPoints = board.reduce((a, b) => a + b.points, 0);

  const typeStats = (['mcq', 'truefalse', 'fill', 'short', 'long'] as QuestionType[])
    .map((type) => {
      const rows = responses.filter((r) => {
        const q = db.questionById(r.questionId);
        return q?.type === type;
      });
      const gradedRows = rows.filter((r) => r.grade !== 'pending');
      return {
        type,
        attempts: rows.length,
        accuracy: gradedRows.length
          ? Math.round((rows.filter((r) => r.grade === 'correct').length / gradedRows.length) * 100)
          : 0,
        avgLatencyMs: rows.length
          ? Math.round(rows.reduce((a, b) => a + b.latencyMs, 0) / rows.length)
          : 0
      };
    })
    .filter((t) => t.attempts > 0);

  const questionStats: QuestionStat[] = questions.map((q) => buildQuestionStat(q, responses));

  return {
    examId: exam.id,
    title: exam.title,
    subject: exam.subject,
    status: exam.status,
    participants: students.length,
    responses: responses.length,
    accuracy: graded.length ? Math.round((correct.length / graded.length) * 100) : 0,
    avgScore: board.length ? Number((totalPoints / board.length).toFixed(1)) : 0,
    maxPossible,
    avgLatencyMs: responses.length
      ? Math.round(responses.reduce((a, b) => a + b.latencyMs, 0) / responses.length)
      : 0,
    completionRate:
      students.length && questions.length
        ? Math.round((responses.length / (students.length * questions.length)) * 100)
        : 0,
    questionStats,
    typeStats,
    topPerformers: board.slice(0, 5),
    latencyBuckets: latencyBuckets(responses)
  };
}

export async function cachedAnalytics(examId: string): Promise<Analytics | null> {
  const key = cacheKeys.analytics(examId);
  const hit = await cache.get<Analytics>(key);
  if (hit) return hit;
  const fresh = analytics(examId);
  if (fresh) await cache.set(key, fresh, 6);
  return fresh;
}

export function examRow(exam: Exam, avgScore: number) {
  return {
    ...exam,
    pushedCount: exam.current ? exam.questionIds.indexOf(exam.current.questionId) + 1 : 0,
    participation: [...new Set(db.responsesByExam(exam.id).map((r) => r.studentId))].length,
    avgScore
  };
}

export { examCode };

/** Re-arm lock timers after a cold boot (seed / Mongo hydrate). */
export function rearmTimers(): void {
  for (const exam of store.exams) {
    if (exam.status !== 'live' || !exam.current) continue;
    if (exam.current.locked) continue;
    const timer = lockTimers.get(exam.id);
    if (timer) clearTimeout(timer);
    const remaining = exam.current.endsAt - Date.now();
    lockTimers.set(
      exam.id,
      setTimeout(
        () => {
          lockQuestion(exam);
        },
        Math.max(0, remaining)
      )
    );
  }
}
