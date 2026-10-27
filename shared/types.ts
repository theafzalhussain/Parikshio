// ─────────────────────────────────────────────────────────────
// Axiom Live — shared domain types (client + server)
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
  myAnswers: Record<string, { answer: string; grade: Grade; awarded: number }>;
  endedAt?: number;
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
}

// ── Socket contracts ───────────────────────────────────────────
export interface ServerToClientEvents {
  'exam:state': (payload: ExamPublic) => void;
  'question:pushed': (payload: { examId: string; active: ActiveWindow & { question: StudentQuestion } }) => void;
  'question:locked': (payload: { examId: string; questionId: string }) => void;
  'exam:ended': (payload: { examId: string }) => void;
  'leaderboard:update': (payload: { examId: string; entries: LeaderboardEntry[] }) => void;
  'response:new': (payload: { examId: string; response: Response; questionPrompt: string }) => void;
  'time:sync': (payload: { serverTime: number }) => void;
  'notice': (payload: { kind: 'info' | 'success' | 'warn'; message: string }) => void;
  'paper:imported': (payload: { paperId: string; name: string; questions: number }) => void;
}

export interface ClientToServerEvents {
  'join:exam': (payload: { examCode: string; role: Role }) => void;
  'time:sync:request': () => void;
}
