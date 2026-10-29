/**
 * Shapes returned by the owner console API (`/api/owner/*`), shared by the
 * server and the hidden /hq pages so both sides agree on every field.
 */
import type { ExamStatus, Grade, Role } from './types';

export type OwnerContactStatus = 'new' | 'done' | 'archived';
export type FacultyDecision = 'approved' | 'declined';

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface OwnerSignIn {
  token: string;
  email: string;
  expiresAt: number;
}

export interface OwnerMe {
  email: string;
  sessionId: string;
  expiresAt: number;
}

export interface OwnerSessionRow {
  id: string;
  email: string;
  createdAt: number;
  expiresAt: number;
  lastSeenAt: number;
  ip: string;
  userAgent: string;
  current: boolean;
}

export interface OwnerUserRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  org: string;
  createdAt: number;
  lastLoginAt: number | null;
  /** Signs in with Google. */
  google: boolean;
  /** Has an email + password login. */
  hasPassword: boolean;
  emailVerified: boolean;
  suspended: boolean;
  /** Faculty created from the console who have not chosen a password or used Google yet. */
  invitePending: boolean;
  /** Students: answers given, sessions taken part in, points earned. */
  answers: number;
  sessionsJoined: number;
  points: number;
  /** Faculty: sessions created, questions written. */
  sessionsCreated: number;
  questionsAuthored: number;
}

export interface OwnerAuditRow {
  id: string;
  action: string;
  actorId: string | null;
  actorName: string;
  detail: string;
  ip: string;
  at: number;
}

export interface OwnerUserDetail extends OwnerUserRow {
  recentAnswers: {
    id: string;
    examTitle: string;
    examCode: string;
    submittedAt: number;
    grade: Grade;
    awarded: number;
  }[];
  exams: { id: string; code: string; title: string; status: ExamStatus; createdAt: number; responses: number }[];
  activity: OwnerAuditRow[];
}

export interface OwnerUsersPage extends Paged<OwnerUserRow> {
  counts: { all: number; students: number; faculty: number; suspended: number; invited: number };
}

export interface OwnerMessage {
  id: string;
  reference: string;
  topic: string;
  topicLabel: string;
  role: string;
  roleLabel: string;
  name: string;
  email: string;
  org: string;
  message: string;
  rating: number | null;
  createdAt: number;
  /** The team email went out / the sender got their copy. */
  delivered: boolean;
  confirmationSent: boolean;
  status: OwnerContactStatus;
  note: string;
  resolvedAt: number | null;
  facultyDecision: FacultyDecision | null;
  grantedUserId: string | null;
  /** The Parikshio account that uses this email, if any. */
  account: { id: string; name: string; role: Role; suspended: boolean } | null;
  /** The sender was logged in when they wrote. */
  sentWhileLoggedInAs: { id: string; role: Role } | null;
}

export interface OwnerMessagesPage extends Paged<OwnerMessage> {
  counts: { all: number; new: number; done: number; archived: number };
}

export interface OwnerRequestsPage extends Paged<OwnerMessage> {
  counts: { pending: number; approved: number; declined: number };
}

export interface OwnerExamRow {
  id: string;
  code: string;
  title: string;
  subject: string;
  status: ExamStatus;
  adminId: string;
  adminName: string;
  createdAt: number;
  endedAt: number | null;
  questions: number;
  participants: number;
  responses: number;
}

export interface OwnerExamsPage extends Paged<OwnerExamRow> {
  counts: { all: number; live: number; draft: number; ended: number };
}

export interface OwnerOverview {
  users: {
    total: number;
    students: number;
    faculty: number;
    suspended: number;
    newThisWeek: number;
    activeThisWeek: number;
  };
  exams: { total: number; live: number; draft: number; ended: number };
  content: { questions: number; papers: number; responses: number; responsesToday: number };
  messages: { total: number; new: number; facultyPending: number };
  recentUsers: OwnerUserRow[];
  recentMessages: OwnerMessage[];
  recentActivity: OwnerAuditRow[];
  health: { mongo: boolean; email: boolean; ai: boolean };
}

export interface OwnerSystem {
  environment: string;
  uptimeSeconds: number;
  bootedAt: number;
  commit: string | null;
  mongo: 'connected' | 'ephemeral';
  redis: string;
  email: { enabled: boolean; senderName: string; senderEmail: string; inbox: string };
  ai: { enabled: boolean; models: string[] };
  googleSignIn: boolean;
  classroom: boolean;
  appUrl: string;
  allowedOrigins: string[];
  ownerEmails: string[];
}

export interface GrantResult {
  user: OwnerUserRow;
  /** A new account was made (and an invite sent). */
  created: boolean;
  /** The person already had faculty access. */
  alreadyFaculty: boolean;
  emailSent: boolean;
  /** Development without email only: the link the email would have carried. */
  devLink?: string;
}

/** What one console screen can ask the server to change on an account. */
export interface OwnerUserPatch {
  name?: string;
  org?: string;
  email?: string;
  role?: Role;
  suspended?: boolean;
}
