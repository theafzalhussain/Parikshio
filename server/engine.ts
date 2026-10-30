import type {
  ActiveWindow,
  Analytics,
  AttemptStatus,
  Exam,
  ExamPublic,
  LeaderboardEntry,
  PublicUser,
  Question,
  QuestionAttempt,
  QuestionSetItem,
  QuestionSetOptions,
  QuestionStat,
  QuestionType,
  Response,
  ReviewItem,
  SetItemState,
  SetMonitor,
  StudentQuestion,
  StudentSetItem,
  StudentSetView
} from '../shared/types';
import { buildQuestionStat, gradeAnswer, gradeForAward, rankResponses } from '../shared/grade';
import { config } from './config';
import { cache, cacheKeys } from './cache';
import { persist, unpersist } from './mongo';
import { db, examCode, store, uid } from './store';
import { emitExam, emitStaff, examRoom, ioInstance } from './realtime';
import { broadcastGradeChange, forgetAiWork, requestAiEvaluation, wantsAutoAi } from './grading';
import { examSettings, resultSealed, studentsSeeLeaderboard } from './sessionRules';

const lockTimers = new Map<string, NodeJS.Timeout>();

/** Bounds shared with the API validators. */
export const MIN_TIMER_SECONDS = 5;
export const MAX_TIMER_SECONDS = 3_600;
export const SET_MAX_ITEMS = 100;

/**
 * Windows of questions that have already been pushed, kept so an answer replayed
 * from a student device's offline outbox can be validated against the question
 * it was actually answered in — by the time a reconnecting device is heard from,
 * `exam.current` has often moved on. In-memory like the lock timers: losing it
 * on restart only costs the extra allowance, never a live submission.
 */
const windowLedger = new Map<string, Map<string, { pushedAt: number; endsAt: number }>>();
const LEDGER_LIMIT = 300;

function rememberWindow(exam: Exam, questionId: string, pushedAt: number, endsAt: number): void {
  let windows = windowLedger.get(exam.id);
  if (!windows) {
    windows = new Map();
    windowLedger.set(exam.id, windows);
  }
  // A re-push of the same question replaces its window rather than stacking.
  windows.delete(questionId);
  windows.set(questionId, { pushedAt, endsAt });
  while (windows.size > LEDGER_LIMIT) {
    const oldest = windows.keys().next();
    if (oldest.done) break;
    windows.delete(oldest.value);
  }
}

function persistExam(exam: Exam): void {
  persist('exams', exam as unknown as { id: string } & Record<string, unknown>);
}

function persistAttempt(attempt: QuestionAttempt): void {
  persist('attempts', attempt as unknown as { id: string } & Record<string, unknown>);
}

/** A NaN or out-of-range timer would make a deadline that never (or instantly) passes. */
export function clampSeconds(value: unknown, fallback = 60): number {
  const requested = Number(value);
  const safe = Number.isFinite(requested) ? requested : fallback;
  return Math.max(MIN_TIMER_SECONDS, Math.min(MAX_TIMER_SECONDS, Math.trunc(safe)));
}

/**
 * Students only see the board when the session allows it. Staff sockets also
 * sit in the exam room, so they need their own copy only when the student
 * broadcast is suppressed (or a caller asks for it explicitly).
 */
function emitBoard(exam: Exam, toStaff = true): void {
  const entries = getLeaderboard(exam.id);
  const studentsSee = studentsSeeLeaderboard(exam);
  if (studentsSee) emitExam(exam.code, 'leaderboard:update', { examId: exam.id, entries });
  if (toStaff || !studentsSee) emitStaff(exam.code, 'leaderboard:update', { examId: exam.id, entries });
}

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

// ── self-paced attempts ───────────────────────────────────────

/**
 * Expiry is evaluated lazily: an open attempt whose deadline (plus the in-flight
 * grace) has passed is settled as expired the next time anything looks at it,
 * and the sweeper below does the same in the background for the control room.
 * Returns true when the attempt changed.
 */
function settleAttempt(attempt: QuestionAttempt, now: number): boolean {
  if (attempt.status !== 'open' || now <= attempt.deadline + config.graceMs) return false;
  attempt.status = 'expired';
  attempt.closedAt = attempt.deadline;
  persistAttempt(attempt);
  return true;
}

function settledAttempts(examId: string, setId: string, studentId: string, now: number): QuestionAttempt[] {
  const rows = db.attemptsOf(examId, setId, studentId);
  rows.forEach((attempt) => settleAttempt(attempt, now));
  return rows;
}

function answeredQuestionIds(examId: string, studentId: string): Set<string> {
  return new Set(
    db
      .responsesByExam(examId)
      .filter((r) => r.studentId === studentId)
      .map((r) => r.questionId)
  );
}

function buildStudentSet(exam: Exam, studentId: string): StudentSetView | null {
  const set = exam.set;
  if (!set) return null;
  const now = Date.now();
  const attempts = settledAttempts(exam.id, set.id, studentId, now);
  const answered = answeredQuestionIds(exam.id, studentId);
  let openQuestionId: string | null = null;

  const items: StudentSetItem[] = [];
  set.items.forEach((item, i) => {
    const question = db.questionById(item.questionId);
    if (!question) return;
    const attempt = attempts.find((a) => a.questionId === item.questionId);
    let state: SetItemState;
    if (answered.has(question.id) || attempt?.status === 'answered') state = 'answered';
    else if (attempt) state = attempt.status === 'open' ? 'open' : attempt.status;
    else state = set.closed ? 'closed' : 'available';
    if (state === 'open') openQuestionId = question.id;

    // Once a student has seen a question they may see its prompt again; the
    // options only travel while the timer runs, or to show their own answer.
    const seen = !!attempt || answered.has(question.id);
    items.push({
      questionId: question.id,
      index: i + 1,
      type: question.type,
      topic: question.topic,
      difficulty: question.difficulty,
      points: question.points,
      timerSeconds: item.timerSeconds,
      state,
      ...(set.revealPrompts || seen ? { prompt: question.prompt } : {}),
      ...(state === 'open' || state === 'answered'
        ? { question: { ...sanitizeQuestion(question), timerSeconds: item.timerSeconds } }
        : {}),
      ...(attempt ? { openedAt: attempt.openedAt, deadline: attempt.deadline } : {})
    });
  });

  return {
    id: set.id,
    pushedAt: set.pushedAt,
    closed: set.closed,
    revealPrompts: set.revealPrompts,
    autoAdvance: set.autoAdvance,
    allowSkip: set.allowSkip,
    items,
    openQuestionId
  };
}

/** What a correct answer looks like, in the same encoding as a student answer. */
function correctAnswerOf(question: Question): string {
  if (question.type === 'mcq' || question.type === 'truefalse') return String(question.correctOptionIndex ?? 0);
  return question.acceptedAnswers.slice(0, 3).join(' · ');
}

/**
 * Post-session review. Covers only questions this student actually met — ones
 * they answered or opened — so a reused bank question that was never delivered
 * does not leak through the results page.
 */
function buildReview(exam: Exam, studentId: string): ReviewItem[] {
  const reveal = examSettings(exam).revealAnswersAfterEnd;
  const mine = new Map(
    db
      .responsesByExam(exam.id)
      .filter((r) => r.studentId === studentId)
      .map((r) => [r.questionId, r] as const)
  );
  const opened = new Set(
    store.attempts.filter((a) => a.examId === exam.id && a.studentId === studentId).map((a) => a.questionId)
  );
  const rows: ReviewItem[] = [];
  exam.questionIds.forEach((id, i) => {
    if (!mine.has(id) && !opened.has(id)) return;
    const question = db.questionById(id);
    if (!question) return;
    const response = mine.get(id);
    rows.push({
      questionId: id,
      index: i + 1,
      type: question.type,
      prompt: question.prompt,
      options: question.options,
      points: question.points,
      myAnswer: response?.answer ?? null,
      grade: response?.grade ?? null,
      awarded: response?.awarded ?? 0,
      ...(reveal
        ? { correctAnswer: correctAnswerOf(question), ...(question.explanation ? { explanation: question.explanation } : {}) }
        : {})
    });
  });
  return rows;
}

export function buildExamPublic(exam: Exam, studentId?: string): ExamPublic {
  const myAnswers: ExamPublic['myAnswers'] = {};
  if (studentId) {
    for (const r of db.responsesByExam(exam.id).filter((r) => r.studentId === studentId)) {
      const sealed = resultSealed(exam, r.questionId);
      myAnswers[r.questionId] = {
        answer: r.answer,
        grade: sealed ? 'pending' : r.grade,
        awarded: sealed ? 0 : r.awarded
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
    set: studentId ? buildStudentSet(exam, studentId) : null,
    myAnswers,
    showLeaderboard: studentsSeeLeaderboard(exam),
    ...(exam.status === 'ended' && studentId ? { review: buildReview(exam, studentId) } : {}),
    endedAt: exam.endedAt
  };
}

/**
 * Every student in the room gets their own view (their timers, their answers),
 * so a set change is delivered per socket rather than as one broadcast.
 */
export async function refreshStudentViews(exam: Exam): Promise<void> {
  await broadcastStudentState(exam);
}

async function broadcastStudentState(exam: Exam): Promise<void> {
  const io = ioInstance();
  if (!io) return;
  const sockets = await io.in(examRoom(exam.code)).fetchSockets();
  const views = new Map<string, ExamPublic>();
  for (const socket of sockets) {
    const user = socket.data.user as PublicUser | undefined;
    if (!user || user.role !== 'student') continue;
    let view = views.get(user.id);
    if (!view) {
      view = buildExamPublic(exam, user.id);
      views.set(user.id, view);
    }
    socket.emit('exam:state', view);
  }
}

export function setMonitor(exam: Exam): SetMonitor | null {
  const set = exam.set;
  if (!set) return null;
  const now = Date.now();
  const attempts = db.attemptsBySet(exam.id, set.id);
  attempts.forEach((attempt) => settleAttempt(attempt, now));
  const count = (rows: QuestionAttempt[], ...statuses: AttemptStatus[]) =>
    rows.filter((a) => statuses.includes(a.status)).length;
  return {
    set,
    items: set.items.map((item) => {
      const rows = attempts.filter((a) => a.questionId === item.questionId);
      return {
        questionId: item.questionId,
        opened: rows.length,
        answered: count(rows, 'answered'),
        inProgress: count(rows, 'open'),
        missed: count(rows, 'expired', 'skipped')
      };
    }),
    inProgress: attempts
      .filter((a) => a.status === 'open')
      .map((a) => ({
        studentId: a.studentId,
        studentName: a.studentName,
        questionId: a.questionId,
        index: set.items.findIndex((item) => item.questionId === a.questionId) + 1,
        deadline: a.deadline
      }))
      .sort((a, b) => a.deadline - b.deadline),
    students: new Set(attempts.map((a) => a.studentId)).size
  };
}

/**
 * The control room's live set panel. A whole class opening questions at once
 * would otherwise mean one recompute and one message per click, so updates are
 * coalesced into at most one every 400 ms per session.
 */
const progressDue = new Map<string, NodeJS.Timeout>();
function emitSetProgress(exam: Exam): void {
  if (progressDue.has(exam.id)) return;
  progressDue.set(
    exam.id,
    setTimeout(() => {
      progressDue.delete(exam.id);
      emitStaff(exam.code, 'set:progress', { examId: exam.id, monitor: setMonitor(exam) });
    }, 400)
  );
}

/** Closes the session's set in place: nothing new can start, in-flight answers keep their grace. */
function closeSetInPlace(exam: Exam, now: number): void {
  const set = exam.set;
  if (!set || set.closed) return;
  set.closed = true;
  set.closedAt = now;
  for (const attempt of db.attemptsBySet(exam.id, set.id)) {
    if (attempt.status !== 'open') continue;
    attempt.deadline = Math.min(attempt.deadline, now);
    persistAttempt(attempt);
  }
}

export async function pushSet(
  exam: Exam,
  entries: { questionId: string; timerSeconds?: number }[],
  options: QuestionSetOptions
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (exam.status === 'ended') return { ok: false, error: 'This session has already ended' };
  if (!entries.length) return { ok: false, error: 'Pick at least one question to push' };
  if (entries.length > SET_MAX_ITEMS) return { ok: false, error: `A set can hold at most ${SET_MAX_ITEMS} questions` };

  const now = Date.now();
  const items: QuestionSetItem[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const question = db.questionById(String(entry.questionId));
    if (!question) return { ok: false, error: 'One of the selected questions no longer exists' };
    if (seen.has(question.id)) continue;
    seen.add(question.id);
    items.push({
      questionId: question.id,
      timerSeconds: clampSeconds(entry.timerSeconds ?? question.timerSeconds, question.timerSeconds),
      pushedAt: now
    });
  }

  // Questions picked straight from the bank join the session in push order.
  for (const item of items) {
    if (!exam.questionIds.includes(item.questionId)) exam.questionIds.push(item.questionId);
  }

  // One delivery mode at a time: a live single question closes, as does any
  // earlier set (its unanswered questions stay closed for everyone).
  if (exam.current && !exam.current.locked) lockQuestion(exam);
  exam.current = null;
  closeSetInPlace(exam, now);

  exam.set = {
    id: uid('set_'),
    pushedAt: now,
    items,
    closed: false,
    revealPrompts: !!options.revealPrompts,
    autoAdvance: !!options.autoAdvance,
    allowSkip: !!options.allowSkip
  };
  exam.status = 'live';
  persistExam(exam);
  await cache.delPrefix(cacheKeys.examPrefix(exam.id));

  emitExam(exam.code, 'time:sync', { serverTime: Date.now() });
  await broadcastStudentState(exam);
  emitSetProgress(exam);
  return { ok: true };
}

export async function closeSet(exam: Exam): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!exam.set || exam.set.closed) return { ok: false, error: 'There is no open question set to close' };
  closeSetInPlace(exam, Date.now());
  persistExam(exam);
  await cache.delPrefix(cacheKeys.examPrefix(exam.id));
  // Results unseal with the set, so students get their grades with this update.
  await broadcastStudentState(exam);
  emitBoard(exam);
  emitSetProgress(exam);
  return { ok: true };
}

/**
 * Gives one question of the open set back to the students who ran out of time
 * on it or skipped it. Answers already submitted stand, and anyone with the
 * question open right now keeps their running timer.
 */
export async function repushSetItem(
  exam: Exam,
  questionId: string,
  timerSeconds?: number
): Promise<{ ok: true; reopened: number } | { ok: false; error: string }> {
  const set = exam.set;
  if (!set || set.closed) {
    return { ok: false, error: 'This set is closed — push the question again as part of a new set' };
  }
  const item = set.items.find((row) => row.questionId === questionId);
  if (!item) return { ok: false, error: 'That question is not part of the open set' };

  const now = Date.now();
  if (timerSeconds !== undefined) item.timerSeconds = clampSeconds(timerSeconds, item.timerSeconds);
  item.pushedAt = now;

  const cleared = db.attemptsBySet(exam.id, set.id).filter((attempt) => {
    if (attempt.questionId !== questionId) return false;
    settleAttempt(attempt, now);
    return attempt.status === 'expired' || attempt.status === 'skipped';
  });
  const ids = new Set(cleared.map((a) => a.id));
  store.attempts = store.attempts.filter((a) => !ids.has(a.id));
  cleared.forEach((a) => unpersist('attempts', a.id));

  persistExam(exam);
  await cache.delPrefix(cacheKeys.examPrefix(exam.id));
  await broadcastStudentState(exam);
  emitSetProgress(exam);
  return { ok: true, reopened: cleared.length };
}

export type AttemptRejection =
  | 'exam-not-live'
  | 'no-open-set'
  | 'not-in-set'
  | 'already-answered'
  | 'time-up'
  | 'skipped'
  | 'another-open'
  | 'skip-disabled'
  | 'not-open';

type AttemptResult = { ok: true } | { ok: false; code: number; error: string; reason: AttemptRejection };

/**
 * Starts this student's timer on one set question. Idempotent while the timer
 * runs (a reload just resumes it), and one question at a time: the timer on a
 * question cannot be paused by wandering off to another.
 */
export function openSetQuestion(exam: Exam, student: PublicUser, questionId: string): AttemptResult {
  if (exam.status !== 'live')
    return { ok: false, code: 409, error: 'This exam is not live right now', reason: 'exam-not-live' };
  const set = exam.set;
  if (!set || set.closed)
    return { ok: false, code: 409, error: 'No question set is open right now', reason: 'no-open-set' };
  const item = set.items.find((row) => row.questionId === questionId);
  if (!item) return { ok: false, code: 404, error: 'That question is not part of this set', reason: 'not-in-set' };

  const now = Date.now();
  const mine = settledAttempts(exam.id, set.id, student.id, now);
  const existing = mine.find((a) => a.questionId === questionId);
  if (existing) {
    if (existing.status === 'open') return { ok: true };
    if (existing.status === 'answered')
      return { ok: false, code: 409, error: 'You already answered this question', reason: 'already-answered' };
    if (existing.status === 'skipped')
      return {
        ok: false,
        code: 409,
        error: 'You skipped this question. It opens again only if your teacher re-pushes it.',
        reason: 'skipped'
      };
    return {
      ok: false,
      code: 409,
      error: 'Time ran out on this question. It opens again only if your teacher re-pushes it.',
      reason: 'time-up'
    };
  }
  if (answeredQuestionIds(exam.id, student.id).has(questionId))
    return { ok: false, code: 409, error: 'You already answered this question', reason: 'already-answered' };

  // A deadline that has already passed only waits for in-flight answers; it
  // should not hold the student back from the next question.
  const running = mine.find((a) => a.status === 'open' && now <= a.deadline);
  if (running) {
    const index = set.items.findIndex((row) => row.questionId === running.questionId) + 1;
    return {
      ok: false,
      code: 409,
      error: `Finish question ${index} first — its timer is still running.`,
      reason: 'another-open'
    };
  }

  const attempt: QuestionAttempt = {
    id: uid('att_'),
    examId: exam.id,
    setId: set.id,
    questionId,
    studentId: student.id,
    studentName: student.name,
    openedAt: now,
    deadline: now + item.timerSeconds * 1000,
    status: 'open'
  };
  store.attempts.push(attempt);
  persistAttempt(attempt);
  emitSetProgress(exam);
  return { ok: true };
}

/** The student gives up on the question that is open; like a timeout, it stays closed unless re-pushed. */
export function skipSetQuestion(exam: Exam, student: PublicUser, questionId: string): AttemptResult {
  const set = exam.set;
  if (!set || set.closed)
    return { ok: false, code: 409, error: 'No question set is open right now', reason: 'no-open-set' };
  if (!set.allowSkip)
    return { ok: false, code: 403, error: 'Skipping is turned off for this set', reason: 'skip-disabled' };
  const now = Date.now();
  const attempt = settledAttempts(exam.id, set.id, student.id, now).find((a) => a.questionId === questionId);
  if (!attempt || attempt.status !== 'open')
    return { ok: false, code: 409, error: 'That question is not open', reason: 'not-open' };
  attempt.status = 'skipped';
  attempt.closedAt = now;
  persistAttempt(attempt);
  emitSetProgress(exam);
  return { ok: true };
}

/**
 * Background settle for the control room: marks attempts whose time ran out
 * and refreshes the staff view. Students do not need it — their own devices
 * count down against the same server-synced deadline.
 */
let sweeper: NodeJS.Timeout | null = null;
export function startAttemptSweeper(): void {
  if (sweeper) return;
  sweeper = setInterval(() => {
    const now = Date.now();
    const touched = new Set<string>();
    for (const attempt of store.attempts) {
      if (settleAttempt(attempt, now)) touched.add(attempt.examId);
    }
    touched.forEach((examId) => {
      const exam = db.examById(examId);
      if (exam) emitSetProgress(exam);
    });
  }, 3_000);
  sweeper.unref?.();
}

// ── leaderboard ───────────────────────────────────────────────

/**
 * Remembers that a student opened this session with its code, so it shows in
 * their lobby. Written once per student per session.
 */
export function noteStudentJoin(exam: Exam, studentId: string): void {
  const joined = exam.joinedBy ?? [];
  if (joined.includes(studentId)) return;
  exam.joinedBy = [...joined, studentId];
  persist('exams', exam as unknown as { id: string } & Record<string, unknown>);
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

// ── live (one question for everyone) ─────────────────────────

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
  // A live push replaces a self-paced set: everyone moves to the same question.
  const hadOpenSet = !!exam.set && !exam.set.closed;
  closeSetInPlace(exam, now);

  const seconds = clampSeconds(overrideSeconds ?? question.timerSeconds);
  const endsAt = now + seconds * 1000;

  exam.current = { questionId, pushedAt: now, endsAt, locked: false };
  exam.status = 'live';
  rememberWindow(exam, questionId, now, endsAt);
  persistExam(exam);
  await cache.delPrefix(cacheKeys.examPrefix(exam.id));

  const active = activeWindow(exam);
  if (active) {
    emitExam(exam.code, 'question:pushed', { examId: exam.id, active });
    emitExam(exam.code, 'time:sync', { serverTime: Date.now() });
  }
  if (hadOpenSet) {
    await broadcastStudentState(exam);
    emitSetProgress(exam);
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
  persistExam(exam);
  void cache.delPrefix(cacheKeys.examPrefix(exam.id));
  emitExam(exam.code, 'question:locked', { examId: exam.id, questionId: exam.current.questionId });
  emitBoard(exam);
  const timer = lockTimers.get(exam.id);
  if (timer) clearTimeout(timer);
  lockTimers.delete(exam.id);
}

export function endExam(exam: Exam): void {
  const now = Date.now();
  exam.status = 'ended';
  exam.endedAt = now;
  exam.current = null;
  closeSetInPlace(exam, now);
  const timer = lockTimers.get(exam.id);
  if (timer) clearTimeout(timer);
  lockTimers.delete(exam.id);
  // Nothing can be replayed into a closed session, so the window ledger goes too.
  windowLedger.delete(exam.id);
  persistExam(exam);
  void cache.delPrefix(cacheKeys.examPrefix(exam.id));
  emitExam(exam.code, 'exam:ended', { examId: exam.id });
  emitStaff(exam.code, 'exam:ended', { examId: exam.id });
}

export interface DeletedExamSummary {
  id: string;
  code: string;
  title: string;
  responses: number;
  attempts: number;
  students: number;
}

/**
 * Removes a session and everything recorded in it: answers, set timers, the
 * question timer, cached views and queued AI grading. Questions stay in the
 * bank. Anyone still in the room is told, so student screens leave the
 * session instead of waiting on a timer that will never fire.
 */
export function deleteExam(exam: Exam): DeletedExamSummary {
  const timer = lockTimers.get(exam.id);
  if (timer) clearTimeout(timer);
  lockTimers.delete(exam.id);
  windowLedger.delete(exam.id);

  const responses = store.responses.filter((r) => r.examId === exam.id);
  const attempts = store.attempts.filter((a) => a.examId === exam.id);
  const students = new Set(responses.map((r) => r.studentId)).size;

  store.responses = store.responses.filter((r) => r.examId !== exam.id);
  store.attempts = store.attempts.filter((a) => a.examId !== exam.id);
  store.exams = store.exams.filter((e) => e.id !== exam.id);
  forgetAiWork(new Set(responses.map((r) => r.id)));

  responses.forEach((r) => unpersist('responses', r.id));
  attempts.forEach((a) => unpersist('attempts', a.id));
  unpersist('exams', exam.id);

  // A paper published as this session can be published again.
  for (const paper of store.papers) {
    if (paper.examId !== exam.id) continue;
    // `undefined`, not `delete`: persist() turns undefined into $unset in MongoDB.
    paper.examId = undefined;
    persist('papers', paper as unknown as { id: string } & Record<string, unknown>);
  }

  void cache.delPrefix(cacheKeys.examPrefix(exam.id));
  emitExam(exam.code, 'exam:removed', { examId: exam.id });
  emitStaff(exam.code, 'exam:removed', { examId: exam.id });

  return {
    id: exam.id,
    code: exam.code,
    title: exam.title,
    responses: responses.length,
    attempts: attempts.length,
    students
  };
}

// ── submissions ───────────────────────────────────────────────

export type SubmitRejection =
  | 'exam-not-live'
  | 'no-active-question'
  | 'question-inactive'
  | 'not-opened'
  | 'expired'
  | 'question-missing'
  | 'duplicate';

export type SubmitResult =
  | { ok: true; response: Response }
  | { ok: false; code: number; error: string; reason: SubmitRejection };

export interface SubmitPayload {
  questionId: string;
  answer: string;
  /** The answer was held in the device's offline outbox and is being replayed. */
  offline?: boolean;
}

interface SubmissionWindow {
  pushedAt: number;
  endsAt: number;
  /** The answer arrived after the question's own deadline, rescued by the offline allowance. */
  replayed: boolean;
  /** Set when the answer belongs to a self-paced set question. */
  attempt?: QuestionAttempt;
}

function resolveWindow(
  exam: Exam,
  studentId: string,
  payload: SubmitPayload,
  now: number
): { ok: true; window: SubmissionWindow } | { ok: false; code: number; error: string; reason: SubmitRejection } {
  const offline = payload.offline === true;
  const allowance = offline ? config.offlineSyncGraceMs : 0;
  const current = exam.current;

  if (current && current.questionId === payload.questionId) {
    // The grace window exists for answers that were already travelling when the
    // timer hit zero. It used to be computed as `locked ? 0 : graceMs`, but the
    // lock timer fired exactly at `endsAt`, so by the time `now > endsAt` the flag
    // was always true and the allowance was never actually granted.
    if (now <= current.endsAt + config.graceMs + allowance) {
      return {
        ok: true,
        window: {
          pushedAt: current.pushedAt,
          endsAt: current.endsAt,
          replayed: offline && now > current.endsAt + config.graceMs
        }
      };
    }
    return {
      ok: false,
      code: 409,
      // A replay is late because the network was, so say that rather than
      // implying the student sat on the answer.
      error: offline
        ? 'This device reconnected after the question had already closed'
        : 'Time is up for this question',
      reason: 'expired'
    };
  }

  // Self-paced set: the window is this student's own, from opening to deadline.
  const set = exam.set;
  if (set && set.items.some((item) => item.questionId === payload.questionId)) {
    const attempt = db.attemptsOf(exam.id, set.id, studentId).find((a) => a.questionId === payload.questionId);
    if (!attempt) {
      return set.closed
        ? { ok: false, code: 409, error: 'This question set has closed', reason: 'question-inactive' }
        : { ok: false, code: 409, error: 'Open this question before answering it', reason: 'not-opened' };
    }
    if (attempt.status === 'answered')
      return { ok: false, code: 409, error: 'You already answered this question', reason: 'duplicate' };
    if (attempt.status === 'skipped')
      return { ok: false, code: 409, error: 'You skipped this question', reason: 'question-inactive' };
    // `expired` is accepted here too: the sweeper may have settled it while an
    // offline replay that was answered in time was still on its way.
    if (now <= attempt.deadline + config.graceMs + allowance) {
      return {
        ok: true,
        window: {
          pushedAt: attempt.openedAt,
          endsAt: attempt.deadline,
          replayed: offline && now > attempt.deadline + config.graceMs,
          attempt
        }
      };
    }
    return {
      ok: false,
      code: 409,
      error: offline
        ? 'This device reconnected after your time on this question ran out'
        : 'Time is up for this question',
      reason: 'expired'
    };
  }

  if (!offline) {
    if (!current) return { ok: false, code: 409, error: 'No question is live right now', reason: 'no-active-question' };
    return { ok: false, code: 409, error: 'That question is no longer active', reason: 'question-inactive' };
  }

  const past = windowLedger.get(exam.id)?.get(payload.questionId);
  if (!past) return { ok: false, code: 409, error: 'That question is no longer active', reason: 'question-inactive' };
  if (now > past.endsAt + config.graceMs + allowance) {
    return {
      ok: false,
      code: 409,
      error: 'This device reconnected after the question had already closed',
      reason: 'expired'
    };
  }
  return { ok: true, window: { pushedAt: past.pushedAt, endsAt: past.endsAt, replayed: true } };
}

export function submitAnswer(exam: Exam, student: PublicUser, payload: SubmitPayload): SubmitResult {
  if (exam.status !== 'live')
    return { ok: false, code: 409, error: 'This exam is not live right now', reason: 'exam-not-live' };

  const now = Date.now();
  const resolved = resolveWindow(exam, student.id, payload, now);
  if (!resolved.ok) return resolved;
  const { pushedAt, endsAt, replayed, attempt } = resolved.window;

  const question = db.questionById(payload.questionId);
  if (!question) return { ok: false, code: 404, error: 'Question not found', reason: 'question-missing' };

  const duplicate = db
    .responsesByExamQuestion(exam.id, question.id)
    .find((r) => r.studentId === student.id);
  if (duplicate)
    return { ok: false, code: 409, error: 'You already answered this question', reason: 'duplicate' };

  // Client clocks are untrusted; score latency using the server's receipt time.
  const answeredAt = Math.min(now, endsAt + config.graceMs);

  // Dual-mode grading: objective formats are settled by the answer key right
  // here; subjective ones are handed to the AI evaluator and start as pending.
  const useAi = wantsAutoAi(question, payload.answer);
  const { grade, awarded } = useAi ? { grade: 'pending' as const, awarded: 0 } : gradeAnswer(question, payload.answer);
  const response: Response = {
    id: uid('rsp_'),
    examId: exam.id,
    questionId: question.id,
    studentId: student.id,
    studentName: student.name,
    answer: payload.answer,
    submittedAt: answeredAt,
    // In a set, speed is measured from when this student opened the question.
    latencyMs: Math.max(0, answeredAt - pushedAt),
    grade,
    awarded,
    manual: false,
    ...(payload.offline === true ? { offline: true, syncedAt: now } : {}),
    ...(grade !== 'pending' ? { gradedBy: 'key' as const, gradedAt: now } : {})
  };
  store.responses.push(response);
  if (useAi) requestAiEvaluation(response, { silent: true });
  persist('responses', response as unknown as { id: string } & Record<string, unknown>);
  void cache.del(cacheKeys.leaderboard(exam.id), cacheKeys.analytics(exam.id));

  if (attempt) {
    attempt.status = 'answered';
    attempt.closedAt = now;
    persistAttempt(attempt);
    emitSetProgress(exam);
  }

  emitStaff(exam.code, 'response:new', {
    examId: exam.id,
    response,
    questionPrompt: question.prompt
  });
  // A replay lands after `lockQuestion` already published the final board for
  // that question, so staff need the corrected standings too.
  emitBoard(exam, replayed);

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
  response.gradedBy = 'manual';
  // Timestamped so an AI evaluation that was already in flight does not
  // overwrite this score when it lands.
  response.gradedAt = Date.now();
  // Any partial credit counts as graded; 'pending' would mean "still needs a
  // human", which is exactly what just happened.
  response.grade = gradeForAward(response.awarded);
  persist('responses', response as unknown as { id: string } & Record<string, unknown>);
  broadcastGradeChange(response, true);
  return response;
}

// ── analytics ─────────────────────────────────────────────────

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

/**
 * How far into the paper delivery has reached — the furthest question that has
 * been on a student screen (pushed live, part of a set, or answered at all, so
 * ended sessions keep their progress after `current` is cleared).
 */
export function deliveredCount(exam: Exam): number {
  const ids = new Set<string>(
    [exam.current?.questionId, ...(exam.set?.items.map((item) => item.questionId) ?? [])].filter(
      (id): id is string => !!id
    )
  );
  for (const r of db.responsesByExam(exam.id)) ids.add(r.questionId);
  let furthest = 0;
  ids.forEach((id) => {
    furthest = Math.max(furthest, exam.questionIds.indexOf(id) + 1);
  });
  return furthest;
}

export function examRow(exam: Exam, avgScore: number) {
  return {
    ...exam,
    pushedCount: deliveredCount(exam),
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
