import crypto from 'node:crypto';
import { persist } from './mongo';
import { store, type StoredUser } from './store';

/**
 * Student IDs: one readable, permanent, unique ID per student account, e.g.
 * `PKS26-7K4M9Q`.
 *
 *   PKS   — Parikshio
 *   26    — the year the account was created
 *   7K4M9 — random, from an alphabet without look-alikes (no 0/O, 1/I/L)
 *   Q     — a check character, so a mistyped ID is caught instead of
 *           matching another student
 *
 * The internal account id (`stu_…`) stays the key everywhere; this ID is what
 * people read, say and write down. It is assigned at sign-up (email or Google),
 * when an account becomes a student, and once at boot for older accounts.
 * Every user is held in memory and the app runs as one process, so checking
 * against `store.users` is a complete uniqueness check.
 */

const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; // 31 characters
const BODY_LENGTH = 5;
export const STUDENT_CODE_PATTERN = /^PKS\d{2}-[2-9A-HJKMNP-Z]{6}$/;

/** Weighted sum mod 31 over the year digits and body: catches any single wrong or swapped character. */
function checkCharacter(year: string, body: string): string {
  const values = [...year].map((d) => Number(d)).concat([...body].map((c) => ALPHABET.indexOf(c)));
  const sum = values.reduce((acc, value, i) => acc + value * (i + 1), 0);
  return ALPHABET[sum % ALPHABET.length]!;
}

/** True for a well-formed ID whose check character matches. */
export function isValidStudentCode(code: unknown): code is string {
  if (typeof code !== 'string' || !STUDENT_CODE_PATTERN.test(code)) return false;
  const year = code.slice(3, 5);
  const body = code.slice(6, 6 + BODY_LENGTH);
  return code.slice(-1) === checkCharacter(year, body);
}

function yearOf(at: number): string {
  return String(new Date(Number.isFinite(at) ? at : Date.now()).getUTCFullYear() % 100).padStart(2, '0');
}

/** A new ID no other account has. */
export function newStudentCode(createdAt = Date.now()): string {
  const taken = new Set(store.users.map((u) => u.studentCode).filter(Boolean));
  const year = yearOf(createdAt);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    let body = '';
    for (let i = 0; i < BODY_LENGTH; i += 1) body += ALPHABET[crypto.randomInt(ALPHABET.length)];
    const code = `PKS${year}-${body}${checkCharacter(year, body)}`;
    if (!taken.has(code)) return code;
  }
  // 31^5 ≈ 28.6 million IDs per year: reaching this means something is badly wrong.
  throw new Error('Could not generate a unique student ID');
}

/** Gives a student account its ID if it has none (or a malformed one). Returns true when it changed. */
export function ensureStudentCode(user: StoredUser): boolean {
  if (user.role !== 'student' || isValidStudentCode(user.studentCode)) return false;
  user.studentCode = newStudentCode(user.createdAt);
  return true;
}

/**
 * Boot-time backfill: every student account gets an ID, and a duplicate (which
 * only a hand-edited database could produce) is replaced on the newer account.
 */
export function backfillStudentCodes(): number {
  let assigned = 0;
  const owners = new Map<string, StoredUser>();
  const students = store.users.filter((u) => u.role === 'student').sort((a, b) => a.createdAt - b.createdAt);
  for (const user of students) {
    const clash = user.studentCode ? owners.get(user.studentCode) : undefined;
    if (clash) user.studentCode = undefined;
    if (ensureStudentCode(user)) {
      persist('users', user as unknown as { id: string } & Record<string, unknown>);
      assigned += 1;
    }
    owners.set(user.studentCode!, user);
  }
  return assigned;
}

/** The ID of a student by internal account id, for staff views. */
export function studentCodeOf(userId: string): string | undefined {
  const user = store.users.find((u) => u.id === userId);
  return user?.role === 'student' ? user.studentCode : undefined;
}

/** IDs for a set of internal account ids, for one staff response. */
export function studentCodesFor(userIds: Iterable<string>): Record<string, string> {
  const wanted = new Set(userIds);
  const out: Record<string, string> = {};
  for (const user of store.users) {
    if (wanted.has(user.id) && user.role === 'student' && user.studentCode) out[user.id] = user.studentCode;
  }
  return out;
}
