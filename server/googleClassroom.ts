import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
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

/**
 * A Classroom failure the teacher can act on (connect first, reconnect, enable
 * the API…). `status` is what the API answers with, so the message reaches the
 * screen instead of a generic "something went wrong".
 */
export class ClassroomError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = 'ClassroomError';
    this.status = status;
    this.code = code;
  }
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

/** Nonces of states already used, so a state works once (kept until it would expire anyway). */
const usedStateNonces = new Map<string, number>();
const inFlightPublications = new Map<string, Promise<ClassroomPublishResult>>();
/** Short-lived access tokens, so a publish to 60 students does not refresh 120 times. */
const accessTokens = new Map<string, { token: string; expiresAt: number }>();

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
    throw new ClassroomError('Google Classroom OAuth is not configured on this server.', 503, 'classroom/not-configured');
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
    throw new ClassroomError('Stored Google Classroom credentials are invalid. Reconnect the account.', 409, 'classroom/reconnect');
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivPart, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextPart, 'base64url')),
      decipher.final()
    ]).toString('utf8');
  } catch {
    // Happens after JWT_SECRET changes: the stored token was encrypted with the old key.
    throw new ClassroomError('Stored Google Classroom credentials cannot be decrypted. Reconnect the account.', 409, 'classroom/reconnect');
  }
}

/**
 * OAuth `state` is signed (HMAC over the JWT secret) rather than kept in
 * memory: Render restarts and redeploys between "Connect" and Google's
 * callback no longer lose it. It carries no secret, expires in 10 minutes and
 * works once per server process.
 */
function stateKey(): Buffer {
  return createHmac('sha256', config.jwtSecret).update('axiom:google-classroom:oauth-state:v1').digest();
}

function signState(record: OAuthState): string {
  const body = Buffer.from(
    JSON.stringify({ u: record.userId, r: record.returnTo, e: record.expiresAt, n: randomBytes(16).toString('base64url') })
  ).toString('base64url');
  const mac = createHmac('sha256', stateKey()).update(body).digest('base64url');
  return `${body}.${mac}`;
}

function consumeOAuthState(state: string): OAuthState | null {
  const [body, mac, ...extra] = String(state ?? '').split('.');
  if (!body || !mac || extra.length || state.length > 2_000) return null;
  const expected = createHmac('sha256', stateKey()).update(body).digest();
  const given = Buffer.from(mac, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let parsed: { u?: unknown; r?: unknown; e?: unknown; n?: unknown };
  try {
    parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  const { u, r, e, n } = parsed;
  if (typeof u !== 'string' || typeof r !== 'string' || typeof e !== 'number' || typeof n !== 'string') return null;
  const now = Date.now();
  if (e < now || usedStateNonces.has(n)) return null;
  // Only ever return to a path inside this app.
  if (!r.startsWith('/admin/') || r.startsWith('//')) return null;
  usedStateNonces.set(n, e);
  return { userId: u, returnTo: r, expiresAt: e };
}

function pruneOAuthStates(): void {
  const now = Date.now();
  for (const [nonce, expiresAt] of usedStateNonces) {
    if (expiresAt < now) usedStateNonces.delete(nonce);
  }
}

export function classroomStatus(user: StoredUser) {
  return {
    configured: config.googleClassroom.enabled,
    connected: Boolean(user.googleClassroom?.encryptedRefreshToken),
    email: user.googleClassroom?.email ?? null,
    connectedAt: user.googleClassroom?.connectedAt ?? null,
    /** The exact callback URL that must be listed in the Google Cloud OAuth client. */
    redirectUri: config.googleClassroom.enabled ? config.googleClassroom.redirectUri : null
  };
}

export function createClassroomAuthorizationUrl(user: StoredUser, returnTo: string): string {
  assertClassroomConfigured();
  pruneOAuthStates();
  if (usedStateNonces.size >= 10_000) throw new Error('Too many pending Google Classroom sign-ins. Try again shortly.');

  const state = signState({ userId: user.id, returnTo, expiresAt: Date.now() + OAUTH_STATE_TTL_MS });
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
    const code = payload.error ?? `http_${response.status}`;
    if (code === 'invalid_grant' && form.get('grant_type') === 'refresh_token') {
      // Revoked, password changed, or the OAuth app is still in "Testing" (tokens die after 7 days).
      throw new ClassroomError(
        'Google Classroom access has expired or was revoked. Disconnect and connect the account again.',
        409,
        'classroom/reconnect'
      );
    }
    if (code === 'redirect_uri_mismatch') {
      throw new ClassroomError(
        `Google rejected the callback URL. Add ${config.googleClassroom.redirectUri} to the OAuth client's authorized redirect URIs.`,
        502,
        'classroom/redirect-uri'
      );
    }
    throw new ClassroomError(payload.error_description || payload.error || 'Google OAuth token exchange failed.', 502, 'classroom/oauth-failed');
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
  // The token from this exchange is fresh: the first course list needs no refresh.
  accessTokens.set(tokenCacheKey(user), { token: token.access_token, expiresAt: Date.now() + accessTokenLifetimeMs(token) });
  return pending;
}

export function discardClassroomAuthorization(state: string): OAuthState | null {
  return consumeOAuthState(state);
}

export function disconnectClassroom(user: StoredUser): void {
  accessTokens.delete(tokenCacheKey(user));
  // `undefined`, not `delete`: persist() turns undefined into $unset, so the
  // stored refresh token is really removed from MongoDB and does not come back
  // after the next restart.
  user.googleClassroom = undefined;
  persist('users', user as unknown as { id: string } & Record<string, unknown>);
}

/** Cache key that changes when the account is reconnected (new refresh token). */
function tokenCacheKey(user: StoredUser): string {
  return `${user.id}:${(user.googleClassroom?.encryptedRefreshToken ?? '').slice(-24)}`;
}

function accessTokenLifetimeMs(token: GoogleTokenResponse): number {
  const seconds = Number(token.expires_in);
  // A minute of margin so a token never expires in the middle of a publish.
  return Math.max(60, (Number.isFinite(seconds) && seconds > 0 ? seconds : 3600) - 60) * 1000;
}

async function accessTokenFor(user: StoredUser, forceRefresh = false): Promise<string> {
  assertClassroomConfigured();
  const encrypted = user.googleClassroom?.encryptedRefreshToken;
  if (!encrypted) throw new ClassroomError('Connect a Google Classroom account first.', 409, 'classroom/not-connected');
  const key = tokenCacheKey(user);
  const cached = accessTokens.get(key);
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) return cached.token;
  const token = await postOAuthToken(new URLSearchParams({
    client_id: config.googleClassroom.clientId,
    client_secret: config.googleClassroom.clientSecret,
    refresh_token: decryptRefreshToken(encrypted),
    grant_type: 'refresh_token'
  }));
  if (!token.access_token) throw new ClassroomError('Google did not return an access token.', 502, 'classroom/oauth-failed');
  accessTokens.set(key, { token: token.access_token, expiresAt: Date.now() + accessTokenLifetimeMs(token) });
  return token.access_token;
}

async function classroomRequest<T>(
  user: StoredUser,
  path: string,
  options: { method?: 'GET' | 'POST' | 'PATCH'; body?: unknown } = {}
): Promise<T> {
  const send = async (token: string) =>
    fetch(`${CLASSROOM_API_URL}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(options.body ? { 'Content-Type': 'application/json' } : {})
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(20_000)
    });
  let response = await send(await accessTokenFor(user));
  // A cached token Google no longer accepts: refresh once and retry.
  if (response.status === 401) response = await send(await accessTokenFor(user, true));
  const payload = (await response.json().catch(() => ({}))) as T & GoogleApiErrorBody;
  if (!response.ok) {
    const status = payload.error?.status ?? '';
    const disabled = response.status === 403 && /SERVICE_DISABLED|accessNotConfigured/i.test(`${status} ${payload.error?.message ?? ''}`);
    const message = disabled
      ? 'The Google Classroom API is not enabled for this Google Cloud project. Enable it in Google Cloud Console → APIs & Services.'
      : payload.error?.message?.slice(0, 300) || `Google Classroom returned HTTP ${response.status}.`;
    throw new ClassroomError(message, 502, disabled ? 'classroom/api-disabled' : 'classroom/google-error');
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
  throw new ClassroomError('Google Classroom returned too many pages to sync safely.', 502, 'classroom/too-large');
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
  if (exam.status !== 'ended') throw new ClassroomError('End the exam before publishing Classroom results.', 409, 'classroom/not-ready');
  if (!exam.classroomCourseId) throw new ClassroomError('Link a Google Classroom course to this exam first.', 409, 'classroom/no-course');
  const owner = db.userById(exam.adminId);
  if (!owner || owner.role !== 'admin' || !owner.googleClassroom?.encryptedRefreshToken) {
    throw new ClassroomError('The faculty account linked to this exam has not connected Google Classroom.', 409, 'classroom/not-connected');
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
    throw new ClassroomError('Some participating students still have answers awaiting grading. Retry the publish after grading finishes.', 409, 'classroom/grading-pending');
  }
  if (!graded.length) throw new ClassroomError('No existing Parikshio student accounts with exam results matched this Classroom roster.', 409, 'classroom/no-match');

  const questions = exam.questionIds.map((id) => db.questionById(id)).filter((question) => question !== undefined);
  const maxPoints = questions.reduce((total, question) => total + question.points, 0);
  if (maxPoints <= 0) throw new ClassroomError('This exam has no valid points available to publish.', 409, 'classroom/no-points');

  if (!exam.classroomCourseWorkId) {
    const work = await classroomRequest<{ id?: string }>(
      owner,
      `/courses/${encodeURIComponent(exam.classroomCourseId)}/courseWork`,
      {
        method: 'POST',
        body: {
          title: `${exam.title} — Parikshio results`,
          description: `Final scores from the Parikshio ${exam.subject} assessment.`,
          workType: 'ASSIGNMENT',
          state: 'PUBLISHED',
          maxPoints
        }
      }
    );
    if (!work.id) throw new ClassroomError('Google Classroom created coursework without returning its ID.', 502, 'classroom/google-error');
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

  if (!gradedStudents) throw new ClassroomError('No Classroom submissions were available for the matched students.', 409, 'classroom/no-submissions');
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
