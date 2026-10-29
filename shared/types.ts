// ─────────────────────────────────────────────────────────────
// Parikshio — shared domain types (client + server)
// ─────────────────────────────────────────────────────────────

export type Role = 'admin' | 'student';
export type QuestionType = 'mcq' | 'truefalse' | 'fill' | 'short' | 'long';
export type Difficulty = 'easy' | 'medium' | 'hard';
export type ExamStatus = 'draft' | 'live' | 'ended';
export type Grade = 'correct' | 'incorrect' | 'pending';

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  org: string;
  /** Profile photo — populated when the account signed in with Google. */
  avatarUrl?: string;
}

export interface Question {
  id: string;
  type: QuestionType;
  prompt: string;
  topic: string;
  difficulty: Difficulty;
  /** MCQ / True-False options (True-False uses ['True','False']) */
  options: string[];
  /** Index into options for objective-single-choice questions */
  correctOptionIndex: number | null;
  /** Accepted normalised text answers (fill / short / long) */
  acceptedAnswers: string[];
  points: number;
  timerSeconds: number;
  explanation: string;
  createdBy: string;
  createdAt: number;
  /** present when the question was imported from an uploaded paper */
  sourcePaperId?: string;
  sourcePaperName?: string;
  sourceIndex?: number;
}

export type QuestionInput = Omit<
  Question,
  'id' | 'createdBy' | 'createdAt' | 'sourcePaperId' | 'sourcePaperName' | 'sourceIndex'
>;

/** An uploaded question paper (PDF / DOCX / image / pasted text). */
export type PaperKind = 'pdf' | 'docx' | 'image' | 'text';

export interface Paper {
  id: string;
  name: string;
  fileName: string;
  kind: PaperKind;
  sizeBytes: number;
  uploadedBy: string;
  uploadedByName: string;
  uploadedAt: number;
  meta: { title: string | null; timeLimit: string | null; maxMarks: string | null };
  stats: {
    detected: number;
    withOptions: number;
    withAnswers: number;
    averageConfidence: number;
  };
  warnings: string[];
  /** first slice of extracted text, kept for transparency/debugging */
  previewText: string;
  textLength: number;
  ocrUsed: boolean;
  questionIds: string[];
  examId?: string;
}

/** Question as seen by a student — correct answers stripped. */
export interface StudentQuestion {
  id: string;
  type: QuestionType;
  prompt: string;
  topic: string;
  difficulty: Difficulty;
  options: string[];
  points: number;
  timerSeconds: number;
}

export interface ActiveWindow {
  questionId: string;
  index: number;
  total: number;
  pushedAt: number;
  /** Absolute epoch ms at which the question locks (server authoritative) */
  endsAt: number;
  locked: boolean;
}

// ── Self-paced sets (bulk push) ────────────────────────────────

/** Options an admin picks when pushing several questions at once. */
export interface QuestionSetOptions {
  /** Students can read each prompt in the list before they start its timer. */
  revealPrompts: boolean;
  /** Offer the next question automatically after a submit, skip or timeout. */
  autoAdvance: boolean;
  /** Students may give up on an open question before its timer runs out. */
  allowSkip: boolean;
}

/** One question inside a set, with the allowance chosen at push time. */
export interface QuestionSetItem {
  questionId: string;
  timerSeconds: number;
  /** When the item was pushed, or last re-opened for students who missed it. */
  pushedAt: number;
}

/**
 * A batch of questions pushed together. Every student sees the whole list and
 * picks the order; each question's timer starts only when that student opens it.
 */
export interface QuestionSet extends QuestionSetOptions {
  id: string;
  pushedAt: number;
  items: QuestionSetItem[];
  closed: boolean;
  closedAt?: number;
}

export type AttemptStatus = 'open' | 'answered' | 'expired' | 'skipped';

/** One student's own timer on one question of a set (server authoritative). */
export interface QuestionAttempt {
  id: string;
  examId: string;
  setId: string;
  questionId: string;
  studentId: string;
  studentName: string;
  openedAt: number;
  deadline: number;
  status: AttemptStatus;
  closedAt?: number;
}

/** Per-session switches an admin can change from the control room. */
export interface ExamSettings {
  /** Students see the live leaderboard. */
  showLeaderboard: boolean;
  /** Once the session ends, students can see the answer key and explanations. */
  revealAnswersAfterEnd: boolean;
  /** Pre-selected options in the bulk push dialog. */
  setDefaults: QuestionSetOptions;
}

export type SetItemState = 'available' | 'open' | 'answered' | 'expired' | 'skipped' | 'closed';

/** A set item as one student sees it. */
export interface StudentSetItem {
  questionId: string;
  /** 1-based position inside the set. */
  index: number;
  type: QuestionType;
  topic: string;
  difficulty: Difficulty;
  points: number;
  timerSeconds: number;
  state: SetItemState;
  /** Present when prompts are revealed up front, or once this student has opened it. */
  prompt?: string;
  /** The full question (with options) while this student's timer is running. */
  question?: StudentQuestion;
  openedAt?: number;
  deadline?: number;
}

export interface StudentSetView extends QuestionSetOptions {
  id: string;
  pushedAt: number;
  closed: boolean;
  items: StudentSetItem[];
  /** The question this student currently has open, if any. */
  openQuestionId: string | null;
}

/** Post-session review row for one question. */
export interface ReviewItem {
  questionId: string;
  index: number;
  type: QuestionType;
  prompt: string;
  options: string[];
  points: number;
  myAnswer: string | null;
  grade: Grade | null;
  awarded: number;
  /** Only when the session reveals its answer key after it ends. */
  correctAnswer?: string;
  explanation?: string;
}

/** Admin-side live view of a set. */
export interface SetMonitor {
  set: QuestionSet;
  items: { questionId: string; opened: number; answered: number; inProgress: number; missed: number }[];
  inProgress: { studentId: string; studentName: string; questionId: string; index: number; deadline: number }[];
  /** Distinct students who have opened at least one question. */
  students: number;
}

export interface Exam {
  id: string;
  code: string;
  title: string;
  subject: string;
  adminId: string;
  adminName: string;
  status: ExamStatus;
  questionIds: string[];
  createdAt: number;
  endedAt?: number;
  current: {
    questionId: string;
    pushedAt: number;
    endsAt: number;
    locked: boolean;
  } | null;
  /** The most recent self-paced set, open or closed. Absent on older sessions. */
  set?: QuestionSet | null;
  /** Absent on sessions created before settings existed — read via `examSettings()`. */
  settings?: ExamSettings;
  classroomCourseId?: string;
  classroomCourseName?: string;
  classroomCourseWorkId?: string;
  classroomPublishStatus?: 'published' | 'failed';
  classroomPublishError?: string;
  classroomPublishedAt?: number;
}

/** Student-facing view of an exam */
export interface ExamPublic {
  id: string;
  code: string;
  title: string;
  subject: string;
  status: ExamStatus;
  totalQuestions: number;
  active: (ActiveWindow & { question: StudentQuestion }) | null;
  /** The latest self-paced set, from this student's point of view. */
  set: StudentSetView | null;
  myAnswers: Record<string, { answer: string; grade: Grade; awarded: number }>;
  /** Whether this session shows the leaderboard to students. */
  showLeaderboard: boolean;
  /** Question-by-question review, only once the session has ended. */
  review?: ReviewItem[];
  endedAt?: number;
}

/**
 * Which engine produced a response's current score.
 * - `key`    → deterministic answer-key match (MCQ, True/False, Fill in the blank)
 * - `ai`     → AI evaluator (Short / Long answers)
 * - `manual` → a faculty member scored or overrode it
 */
export type GradingMode = 'key' | 'ai' | 'manual';

export type AiEvalStatus = 'queued' | 'running' | 'done' | 'failed';

/** Result (or progress) of an AI evaluation attached to a subjective response. */
export interface AiEvaluation {
  status: AiEvalStatus;
  /** Model that produced the result, or the last one tried when it failed. */
  model?: string;
  /** Points the evaluator awarded — already clamped to [0, maxPoints] on the server. */
  score?: number;
  maxPoints: number;
  verdict?: 'correct' | 'partial' | 'incorrect';
  /** Teacher-facing explanation of the score. */
  feedback?: string;
  strengths?: string[];
  improvements?: string[];
  /** 0–1: how sure the evaluator is that a careful examiner would agree. */
  confidence?: number;
  /** Low confidence or a suspected prompt-injection attempt — a human should look. */
  needsReview?: boolean;
  error?: string;
  attempts: number;
  requestedAt: number;
  completedAt?: number;
  latencyMs?: number;
}

export interface Response {
  id: string;
  examId: string;
  questionId: string;
  studentId: string;
  studentName: string;
  answer: string;
  submittedAt: number;
  latencyMs: number;
  grade: Grade;
  awarded: number;
  manual: boolean;
  /**
   * The student's device held this answer in its offline outbox and replayed it
   * after reconnecting. `submittedAt` is then the moment they pressed submit;
   * `syncedAt` is the moment the server actually received it.
   */
  offline?: boolean;
  syncedAt?: number;
  /** How the current grade was produced. Absent on rows that are still pending. */
  gradedBy?: GradingMode;
  /** Epoch ms of the most recent grade change (key, AI or manual). */
  gradedAt?: number;
  /** AI evaluation for short / long answers. Never sent to student devices. */
  ai?: AiEvaluation;
}

/** Admin-facing snapshot of the dual-mode grading engine. */
export interface GradingStatus {
  ai: {
    enabled: boolean;
    autoGrade: boolean;
    provider: 'gemini';
    /** Configured model chain, in the order it is tried. */
    models: string[];
    /** Models temporarily skipped after an overload / timeout / rate limit. */
    cooling: string[];
    /** Every model is out of quota for a long while (daily limit) — grade by hand or retry later. */
    quotaExhausted: boolean;
    queued: number;
    running: number;
    lastError: string | null;
  };
  /** Engine that grades each question format on submission. */
  modes: Record<QuestionType, GradingMode | 'pending'>;
}

export interface LeaderboardEntry {
  rank: number;
  studentId: string;
  name: string;
  points: number;
  answered: number;
  correct: number;
  pending: number;
  avgLatencyMs: number;
  streak: number;
}

export interface QuestionStat {
  questionId: string;
  prompt: string;
  type: QuestionType;
  points: number;
  attempts: number;
  correct: number;
  pending: number;
  accuracy: number;
  avgLatencyMs: number;
  avgAwarded: number;
  optionDistribution: number[] | null;
}

export interface Analytics {
  examId: string;
  title: string;
  subject: string;
  status: ExamStatus;
  participants: number;
  responses: number;
  accuracy: number;
  avgScore: number;
  maxPossible: number;
  avgLatencyMs: number;
  completionRate: number;
  questionStats: QuestionStat[];
  typeStats: { type: QuestionType; attempts: number; accuracy: number; avgLatencyMs: number }[];
  topPerformers: LeaderboardEntry[];
  latencyBuckets: { label: string; count: number }[];
}

export interface AdminExamRow extends Exam {
  pushedCount: number;
  participation: number;
  avgScore: number;
  /** Answers recorded in the session — shown before a delete. */
  responseCount: number;
  /** Settings with defaults filled in, so the list can open the edit dialog directly. */
  settings: ExamSettings;
}

export interface StudentTabHiddenEvent {
  examId: string;
  examCode: string;
  studentId: string;
  studentName: string;
  hiddenAt: number;
}

// ── Socket contracts ───────────────────────────────────────────
export interface ServerToClientEvents {
  'exam:state': (payload: ExamPublic) => void;
  'question:pushed': (payload: { examId: string; active: ActiveWindow & { question: StudentQuestion } }) => void;
  'question:locked': (payload: { examId: string; questionId: string }) => void;
  'exam:ended': (payload: { examId: string }) => void;
  /** Faculty deleted the session; students leave the room. */
  'exam:removed': (payload: { examId: string }) => void;
  'leaderboard:update': (payload: { examId: string; entries: LeaderboardEntry[] }) => void;
  'response:new': (payload: { examId: string; response: Response; questionPrompt: string }) => void;
  /** Staff only — a response's grade or AI evaluation state changed. */
  'response:graded': (payload: { examId: string; response: Response }) => void;
  /** Sent to one student when a late (AI / manual) grade lands on a closed question. */
  'answer:graded': (payload: { examId: string; questionId: string; grade: Grade; awarded: number }) => void;
  /** Staff only — a student hid the live exam tab. */
  'student:tab-hidden': (payload: StudentTabHiddenEvent) => void;
  /** Staff only — someone opened, answered, skipped or ran out of time on a set question. */
  'set:progress': (payload: { examId: string; monitor: SetMonitor | null }) => void;
  'time:sync': (payload: { serverTime: number }) => void;
  'notice': (payload: { kind: 'info' | 'success' | 'warn'; message: string }) => void;
  'paper:imported': (payload: { paperId: string; name: string; questions: number }) => void;
}

export interface ClientToServerEvents {
  'join:exam': (payload: { examCode: string; role: Role }) => void;
  'student:tab-hidden': (payload: { examCode: string }) => void;
  'time:sync:request': () => void;
}
