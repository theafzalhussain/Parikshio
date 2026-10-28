import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import type { Exam } from '../shared/types';
import { config } from './config';
import { db, store, type StoredUser } from './store';
import { persist } from './mongo';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const CLASSROOM_API_URL = 'https://classroom.googleapis.com/v1';
const OAUTH_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/classroom.courses.readonly',
  'https://www.googleapis.com/auth/classroom.rosters.readonly',
  'https://www.googleapis.com/auth/classroom.profile.emails',
  'https://www.googleapis.com/auth/classroom.coursework.students'
];
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const MAX_API_PAGES = 100;
const MAX_PAGE_SIZE = 100;

interface OAuthState {
  userId: string;
  returnTo: string;
  expiresAt: number;
}

interface GoogleTokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  error?: string;
  error_description?: string;
}

interface GoogleApiErrorBody {
  error?: { message?: string; status?: string };
}

export interface ClassroomCourse {
  id: string;
  name: string;
  section?: string;
  courseState?: string;
}

export interface ClassroomRosterStudent {
  classroomUserId: string;
  name: string;
  email: string;
}

export interface ClassroomSubmission {
  id: string;
  userId: string;
  state?: string;
}

const pendingOAuthStates = new Map<string, OAuthState>();
const inFlightPublications = new Map<string, Promise<ClassroomPublishResult>>();

export interface ClassroomPublishResult {
  status: 'published' | 'already-published';
  courseWorkId: string;
  matchedStudents: number;
  gradedStudents: number;
  skippedStudents: number;
  publishedAt: number;
}

function assertClassroomConfigured(): void {
  if (!config.googleClassroom.enabled) {
    throw new Error('Google Classroom OAuth is not configured on this server.');
  }
}

function encryptionKey(): Buffer {
  return createHmac('sha256', config.jwtSecret)
    .update('axiom:google-classroom:refresh-token:v1')
    .digest();
}

function encryptRefreshToken(token: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString('base64url')).join('.');
}

function decryptRefreshToken(encrypted: string): string {
  const [ivPart, tagPart, ciphertextPart, ...extra] = encrypted.split('.');
  if (!ivPart || !tagPart || !ciphertextPart || extra.length) {
    throw new Error('Stored Google Classroom credentials are invalid. Reconnect the account.');
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivPart, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextPart, 'base64url')),
      decipher.final()
    ]).toString('utf8');
  } catch {
    throw new Error('Stored Google Classroom credentials cannot be decrypted. Reconnect the account.');
  }
}

function consumeOAuthState(state: string): OAuthState | null {
  const record = pendingOAuthStates.get(state);
  pendingOAuthStates.delete(state);
  if (!record || record.expiresAt < Date.now()) return null;
  return record;
}

function pruneOAuthStates(): void {
  const now = Date.now();
  for (const [state, record] of pendingOAuthStates) {
    if (record.expiresAt < now) pendingOAuthStates.delete(state);
  }
}

export function classroomStatus(user: StoredUser) {
  return {
    configured: config.googleClassroom.enabled,
    connected: Boolean(user.googleClassroom?.encryptedRefreshToken),
    email: user.googleClassroom?.email ?? null,
    connectedAt: user.googleClassroom?.connectedAt ?? null
  };
}

export function createClassroomAuthorizationUrl(user: StoredUser, returnTo: string): string {
  assertClassroomConfigured();
  pruneOAuthStates();
  if (pendingOAuthStates.size >= 1000) throw new Error('Too many pending Google Classroom sign-ins. Try again shortly.');

  const state = randomBytes(32).toString('base64url');
  pendingOAuthStates.set(state, { userId: user.id, returnTo, expiresAt: Date.now() + OAUTH_STATE_TTL_MS });
  const url = new URL(GOOGLE_AUTH_URL);
  url.search = new URLSearchParams({
    client_id: config.googleClassroom.clientId,
    redirect_uri: config.googleClassroom.redirectUri,
    response_type: 'code',
    scope: OAUTH_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state
  }).toString();
  return url.toString();
}

async function postOAuthToken(form: URLSearchParams): Promise<GoogleTokenResponse> {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
    signal: AbortSignal.timeout(15_000)
  });
  const payload = (await response.json().catch(() => ({}))) as GoogleTokenResponse;
  if (!response.ok) {
    throw new Error(payload.error_description || payload.error || 'Google OAuth token exchange failed.');
  }
  return payload;
}

export async function finishClassroomAuthorization(state: string, code: string): Promise<OAuthState> {
  assertClassroomConfigured();
  const pending = consumeOAuthState(state);
  if (!pending) throw new Error('Google sign-in expired or state was already used. Start the connection again.');

  const token = await postOAuthToken(new URLSearchParams({
    code,
    client_id: config.googleClassroom.clientId,
    client_secret: config.googleClassroom.clientSecret,
    redirect_uri: config.googleClassroom.redirectUri,
    grant_type: 'authorization_code'
  }));
  if (!token.access_token) throw new Error('Google did not return an access token.');

  const profileResponse = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${token.access_token}` },
    signal: AbortSignal.timeout(10_000)
  });
  if (!profileResponse.ok) throw new Error('Could not verify the connected Google account.');
  const profile = (await profileResponse.json()) as { sub?: string; email?: string; email_verified?: boolean };
  if (!profile.sub || !profile.email || profile.email_verified !== true) {
    throw new Error('Google account email could not be verified.');
  }

  const user = db.userById(pending.userId);
  if (!user || user.role !== 'admin') throw new Error('The faculty account is no longer available.');
  const refreshToken = token.refresh_token ?? (user.googleClassroom?.encryptedRefreshToken
    ? decryptRefreshToken(user.googleClassroom.encryptedRefreshToken)
    : null);
  if (!refreshToken) {
    throw new Error('Google did not provide a refresh token. Reconnect and approve offline access.');
  }
  user.googleClassroom = {
    email: profile.email.toLowerCase(),
    googleUserId: profile.sub,
    encryptedRefreshToken: encryptRefreshToken(refreshToken),
    connectedAt: Date.now()
  };
  persist('users', user as unknown as { id: string } & Record<string, unknown>);
  return pending;
}

export function discardClassroomAuthorization(state: string): OAuthState | null {
  return consumeOAuthState(state);
}

export function disconnectClassroom(user: StoredUser): void {
  delete user.googleClassroom;
  persist('users', user as unknown as { id: string } & Record<string, unknown>);
}

async function accessTokenFor(user: StoredUser): Promise<string> {
  assertClassroomConfigured();
  const encrypted = user.googleClassroom?.encryptedRefreshToken;
  if (!encrypted) throw new Error('Connect a Google Classroom account first.');
  const token = await postOAuthToken(new URLSearchParams({
    client_id: config.googleClassroom.clientId,
    client_secret: config.googleClassroom.clientSecret,
    refresh_token: decryptRefreshToken(encrypted),
    grant_type: 'refresh_token'
  }));
  if (!token.access_token) throw new Error('Google did not return an access token.');
  return token.access_token;
}

async function classroomRequest<T>(
  user: StoredUser,
  path: string,
  options: { method?: 'GET' | 'POST' | 'PATCH'; body?: unknown } = {}
): Promise<T> {
  const token = await accessTokenFor(user);
  const response = await fetch(`${CLASSROOM_API_URL}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(20_000)
  });
  const payload = (await response.json().catch(() => ({}))) as T & GoogleApiErrorBody;
  if (!response.ok) {
    const message = payload.error?.message?.slice(0, 300) || `Google Classroom returned HTTP ${response.status}.`;
    throw new Error(message);
  }
  return payload;
}

async function paged<T>(
  user: StoredUser,
  path: string,
  collectionKey: string
): Promise<T[]> {
  const results: T[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_API_PAGES; page++) {
    const url = new URL(`${CLASSROOM_API_URL}${path}`);
    url.searchParams.set('pageSize', String(MAX_PAGE_SIZE));
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const response = await classroomRequest<Record<string, unknown>>(user, `${url.pathname.replace('/v1', '')}${url.search}`);
    const items = response[collectionKey];
    if (Array.isArray(items)) results.push(...items as T[]);
    pageToken = typeof response.nextPageToken === 'string' ? response.nextPageToken : undefined;
    if (!pageToken) return results;
  }
  throw new Error('Google Classroom returned too many pages to sync safely.');
}

export async function listClassroomCourses(user: StoredUser): Promise<ClassroomCourse[]> {
  const courses = await paged<ClassroomCourse>(
    user,
    '/courses?courseStates=ACTIVE',
    'courses'
  );
  return courses.filter((course) => course.id && course.name);
}

export async function listClassroomRoster(
  user: StoredUser,
  courseId: string
): Promise<ClassroomRosterStudent[]> {
  const students = await paged<{
    userId?: string;
    profile?: { name?: { fullName?: string }; emailAddress?: string };
  }>(user, `/courses/${encodeURIComponent(courseId)}/students`, 'students');
  return students
    .filter((student): student is typeof student & { userId: string } => Boolean(student.userId))
    .map((student) => ({
      classroomUserId: student.userId,
      name: student.profile?.name?.fullName?.trim() || 'Classroom student',
      email: student.profile?.emailAddress?.trim().toLowerCase() || ''
    }));
}

export async function getClassroomCourse(
  user: StoredUser,
  courseId: string
): Promise<ClassroomCourse | null> {
  const courses = await listClassroomCourses(user);
  return courses.find((course) => course.id === courseId) ?? null;
}

async function publishExamResultsOnce(exam: Exam): Promise<ClassroomPublishResult> {
  if (exam.status !== 'ended') throw new Error('End the exam before publishing Classroom results.');
  if (!exam.classroomCourseId) throw new Error('Link a Google Classroom course to this exam first.');
  const owner = db.userById(exam.adminId);
  if (!owner || owner.role !== 'admin' || !owner.googleClassroom?.encryptedRefreshToken) {
    throw new Error('The faculty account linked to this exam has not connected Google Classroom.');
  }
  if (exam.classroomPublishStatus === 'published' && exam.classroomCourseWorkId) {
    return {
      status: 'already-published',
      courseWorkId: exam.classroomCourseWorkId,
      matchedStudents: 0,
      gradedStudents: 0,
      skippedStudents: 0,
      publishedAt: exam.classroomPublishedAt ?? Date.now()
    };
  }

  const roster = await listClassroomRoster(owner, exam.classroomCourseId);
  const usersByEmail = new Map(
    store.users.filter((user) => user.role === 'student').map((user) => [user.email.toLowerCase(), user])
  );
  const matched = roster
    .map((student) => ({ student, user: usersByEmail.get(student.email) }))
    .filter((row): row is { student: ClassroomRosterStudent; user: StoredUser } => Boolean(row.user));
  const responsesByStudent = new Map<string, typeof store.responses>();
  for (const response of db.responsesByExam(exam.id)) {
    const rows = responsesByStudent.get(response.studentId) ?? [];
    rows.push(response);
    responsesByStudent.set(response.studentId, rows);
  }
  const graded = matched.filter(({ user }) => (responsesByStudent.get(user.id) ?? []).length > 0);
  if (graded.some(({ user }) => responsesByStudent.get(user.id)!.some((response) => response.grade === 'pending'))) {
    throw new Error('Some participating students still have answers awaiting grading. Retry the publish after grading finishes.');
  }
  if (!graded.length) throw new Error('No existing Axiom student accounts with exam results matched this Classroom roster.');

  const questions = exam.questionIds.map((id) => db.questionById(id)).filter((question) => question !== undefined);
  const maxPoints = questions.reduce((total, question) => total + question.points, 0);
  if (maxPoints <= 0) throw new Error('This exam has no valid points available to publish.');

  if (!exam.classroomCourseWorkId) {
    const work = await classroomRequest<{ id?: string }>(
      owner,
      `/courses/${encodeURIComponent(exam.classroomCourseId)}/courseWork`,
      {
        method: 'POST',
        body: {
          title: `${exam.title} — Axiom Live results`,
          description: `Final scores from the Axiom Live ${exam.subject} assessment.`,
          workType: 'ASSIGNMENT',
          state: 'PUBLISHED',
          maxPoints
        }
      }
    );
    if (!work.id) throw new Error('Google Classroom created coursework without returning its ID.');
    exam.classroomCourseWorkId = work.id;
    persist('exams', exam as unknown as { id: string } & Record<string, unknown>);
  }

  const submissions = await paged<ClassroomSubmission>(
    owner,
    `/courses/${encodeURIComponent(exam.classroomCourseId)}/courseWork/${encodeURIComponent(exam.classroomCourseWorkId)}/studentSubmissions`,
    'studentSubmissions'
  );
  const submissionByUserId = new Map(submissions.map((submission) => [submission.userId, submission]));
  let gradedStudents = 0;
  let skippedStudents = 0;
  for (const { student, user } of graded) {
    const submission = submissionByUserId.get(student.classroomUserId);
    if (!submission?.id) {
      skippedStudents++;
      continue;
    }
    const score = (responsesByStudent.get(user.id) ?? []).reduce((total, response) => total + response.awarded, 0);
    await classroomRequest(
      owner,
      `/courses/${encodeURIComponent(exam.classroomCourseId)}/courseWork/${encodeURIComponent(exam.classroomCourseWorkId)}/studentSubmissions/${encodeURIComponent(submission.id)}?updateMask=assignedGrade`,
      { method: 'PATCH', body: { assignedGrade: Math.min(maxPoints, Math.max(0, score)) } }
    );
    if (submission.state !== 'RETURNED') {
      await classroomRequest(
        owner,
        `/courses/${encodeURIComponent(exam.classroomCourseId)}/courseWork/${encodeURIComponent(exam.classroomCourseWorkId)}/studentSubmissions/${encodeURIComponent(submission.id)}:return`,
        { method: 'POST', body: {} }
      );
    }
    gradedStudents++;
  }

  if (!gradedStudents) throw new Error('No Classroom submissions were available for the matched students.');
  exam.classroomPublishStatus = 'published';
  exam.classroomPublishError = undefined;
  exam.classroomPublishedAt = Date.now();
  persist('exams', exam as unknown as { id: string } & Record<string, unknown>);
  return {
    status: 'published',
    courseWorkId: exam.classroomCourseWorkId,
    matchedStudents: matched.length,
    gradedStudents,
    skippedStudents,
    publishedAt: exam.classroomPublishedAt
  };
}

export function publishExamResults(exam: Exam): Promise<ClassroomPublishResult> {
  const pending = inFlightPublications.get(exam.id);
  if (pending) return pending;
  const publication = publishExamResultsOnce(exam).finally(() => inFlightPublications.delete(exam.id));
  inFlightPublications.set(exam.id, publication);
  return publication;
}
