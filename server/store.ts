import crypto from 'node:crypto';
import type { Exam, Paper, PublicUser, Question, QuestionAttempt, Response, Role } from '../shared/types';
import type { AuditEntry } from './security';

export interface StoredUser extends PublicUser {
  /** Empty string for accounts that only sign in with Google. */
  passwordHash: string;
  createdAt: number;
  /** Set when the account was created through / linked to Google sign-in. */
  googleId?: string;
  avatarUrl?: string;
  emailVerified?: boolean;
  /**
   * Bumped on password change so previously issued JWTs stop working.
   * Tokens carry the version they were minted with.
   */
  tokenVersion?: number;
  lastLoginAt?: number;
  /** Set by the owner console. A suspended account cannot log in or use a session. */
  suspended?: boolean;
  suspendedAt?: number;
  /** Faculty accounts created from the owner console before the person first logged in. */
  invitedAt?: number;
  invitedBy?: string;
  googleClassroom?: {
    email: string;
    googleUserId: string;
    encryptedRefreshToken: string;
    connectedAt: number;
  };
}

/** A pending password-reset request. Only the token hash is persisted. */
export interface PasswordReset {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: number;
  usedAt?: number;
  requestedIp: string;
  createdAt: number;
}

/** A message sent through the public contact / feedback form. */
export interface ContactMessage {
  id: string;
  topic: string;
  role: string;
  name: string;
  email: string;
  org: string;
  message: string;
  /** 1–5, only for feedback. */
  rating: number | null;
  /** Set when the sender was signed in. */
  userId: string | null;
  userRole: Role | null;
  createdAt: number;
  /** The email notification to the team inbox went out. */
  delivered: boolean;
  /** The "we received your message" email went to the sender. */
  confirmationSent: boolean;
  /** Owner console triage. Absent means "new". */
  status?: ContactStatus;
  /** Private note from the owner; never shown to the sender. */
  note?: string;
  resolvedAt?: number;
  /** Faculty access requests only: what the owner decided. */
  facultyDecision?: 'approved' | 'declined';
  /** The faculty account the request was granted to. */
  grantedUserId?: string;
}

export type ContactStatus = 'new' | 'done' | 'archived';

/** One signed-in owner console session. The token carries only its id. */
export interface OwnerSession {
  id: string;
  email: string;
  createdAt: number;
  expiresAt: number;
  lastSeenAt: number;
  ip: string;
  userAgent: string;
  revokedAt?: number;
}

export interface Store {
  users: StoredUser[];
  questions: Question[];
  exams: Exam[];
  responses: Response[];
  /** Per-student timers on self-paced set questions. */
  attempts: QuestionAttempt[];
  papers: Paper[];
  passwordResets: PasswordReset[];
  contactMessages: ContactMessage[];
  auditLogs: AuditEntry[];
  ownerSessions: OwnerSession[];
  /** emitted leaderboard cache busting / diagnostics */
  bootedAt: number;
}

export const store: Store = {
  users: [],
  questions: [],
  exams: [],
  responses: [],
  attempts: [],
  papers: [],
  passwordResets: [],
  contactMessages: [],
  auditLogs: [],
  ownerSessions: [],
  bootedAt: Date.now()
};

export function uid(prefix = ''): string {
  return `${prefix}${crypto.randomBytes(9).toString('hex')}`;
}

export function examCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i++) out += alphabet[crypto.randomInt(alphabet.length)];
  return out;
}

export const db = {
  userByEmail(email: string) {
    return store.users.find((u) => u.email.toLowerCase() === email.toLowerCase());
  },
  userById(id: string) {
    return store.users.find((u) => u.id === id);
  },
  userByGoogleId(googleId: string) {
    return store.users.find((u) => u.googleId === googleId);
  },
  resetByTokenHash(tokenHash: string) {
    return store.passwordResets.find((r) => r.tokenHash === tokenHash);
  },
  resetsForUser(userId: string) {
    return store.passwordResets.filter((r) => r.userId === userId);
  },
  papers() {
    return [...store.papers].sort((a, b) => b.uploadedAt - a.uploadedAt);
  },
  paperById(id: string) {
    return store.papers.find((p) => p.id === id);
  },
  questionsByPaper(paperId: string) {
    return store.questions
      .filter((q) => q.sourcePaperId === paperId)
      .sort((a, b) => (a.sourceIndex ?? 0) - (b.sourceIndex ?? 0));
  },
  questions(filter?: { type?: string; search?: string; topic?: string; paper?: string }) {
    if (filter?.paper) {
      const rows = db.questionsByPaper(filter.paper);
      return filter.search
        ? rows.filter(
            (q) => q.prompt.toLowerCase().includes(filter.search!.toLowerCase()) || q.topic.toLowerCase().includes(filter.search!.toLowerCase())
          )
        : rows;
    }
    let rows = [...store.questions].sort((a, b) => b.createdAt - a.createdAt);
    if (filter?.type) rows = rows.filter((q) => q.type === filter.type);
    if (filter?.topic) rows = rows.filter((q) => q.topic === filter.topic);
    if (filter?.search) {
      const s = filter.search.toLowerCase();
      rows = rows.filter(
        (q) => q.prompt.toLowerCase().includes(s) || q.topic.toLowerCase().includes(s)
      );
    }
    return rows;
  },
  questionById(id: string) {
    return store.questions.find((q) => q.id === id);
  },
  exams() {
    return [...store.exams].sort((a, b) => b.createdAt - a.createdAt);
  },
  examById(id: string) {
    return store.exams.find((e) => e.id === id);
  },
  examByCode(code: string) {
    return store.exams.find((e) => e.code.toUpperCase() === code.toUpperCase());
  },
  responsesByExam(examId: string) {
    return store.responses.filter((r) => r.examId === examId);
  },
  responsesByExamQuestion(examId: string, questionId: string) {
    return store.responses.filter((r) => r.examId === examId && r.questionId === questionId);
  },
  responsesByStudent(studentId: string) {
    return store.responses.filter((r) => r.studentId === studentId);
  },
  responseById(id: string) {
    return store.responses.find((r) => r.id === id);
  },
  attemptsBySet(examId: string, setId: string) {
    return store.attempts.filter((a) => a.examId === examId && a.setId === setId);
  },
  attemptsOf(examId: string, setId: string, studentId: string) {
    return store.attempts.filter((a) => a.examId === examId && a.setId === setId && a.studentId === studentId);
  }
};

export function studentsOf(examId: string): string[] {
  return [...new Set(store.responses.filter((r) => r.examId === examId).map((r) => r.studentId))];
}

export function roleGuard(user: PublicUser | undefined, role: Role): boolean {
  return !!user && user.role === role;
}
