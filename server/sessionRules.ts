import type { Exam, ExamSettings, QuestionSetOptions } from '../shared/types';

/**
 * Small, dependency-free rules shared by the engine, grading and the API.
 * Kept apart from engine.ts because grading.ts needs them and engine.ts
 * already imports grading.ts.
 */

export const DEFAULT_SET_OPTIONS: QuestionSetOptions = {
  revealPrompts: true,
  autoAdvance: true,
  allowSkip: true
};

export const DEFAULT_SETTINGS: ExamSettings = {
  showLeaderboard: true,
  revealAnswersAfterEnd: false,
  setDefaults: DEFAULT_SET_OPTIONS
};

/** Settings with defaults filled in — sessions created before settings existed have none. */
export function examSettings(exam: Exam): ExamSettings {
  const s = exam.settings;
  return {
    showLeaderboard: s?.showLeaderboard ?? DEFAULT_SETTINGS.showLeaderboard,
    revealAnswersAfterEnd: s?.revealAnswersAfterEnd ?? DEFAULT_SETTINGS.revealAnswersAfterEnd,
    setDefaults: { ...DEFAULT_SET_OPTIONS, ...(s?.setDefaults ?? {}) }
  };
}

export function studentsSeeLeaderboard(exam: Exam): boolean {
  return examSettings(exam).showLeaderboard;
}

/** The question belongs to the session's set and that set is still open. */
export function inOpenSet(exam: Exam, questionId: string): boolean {
  return !!exam.set && !exam.set.closed && exam.set.items.some((item) => item.questionId === questionId);
}

/**
 * A student's grade stays hidden while classmates can still answer the same
 * question: during a live push until it locks, and in a set until it closes.
 */
export function resultSealed(exam: Exam, questionId: string): boolean {
  if (exam.current?.questionId === questionId && !exam.current.locked) return true;
  return inOpenSet(exam, questionId);
}
