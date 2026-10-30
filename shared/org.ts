/**
 * The "Institute / school / class" a person gives when they create an account
 * or write in. Shared so the forms and the server agree on what is accepted,
 * and so the owner console groups "VDC", "vdc " and "V.D.C" style variants of
 * the same organisation together.
 */

export const ORG_LIMITS = { min: 2, max: 80 } as const;

/** The message shown when the field is missing or too short. */
export const ORG_REQUIRED_MESSAGE = 'Enter your institute, college, school or class';

/** Collapses whitespace and trims; what gets stored. */
export function cleanOrg(value: unknown): string {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f\u200B-\u200D\u2060\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, ORG_LIMITS.max);
}

/** Null when the value is acceptable, otherwise the reason it is not. */
export function orgProblem(value: unknown): string | null {
  const org = cleanOrg(value);
  if (org.length < ORG_LIMITS.min) return ORG_REQUIRED_MESSAGE;
  // At least one letter or digit: "--" or "..." is not an organisation.
  if (!/[\p{L}\p{N}]/u.test(org)) return ORG_REQUIRED_MESSAGE;
  return null;
}

/**
 * Grouping key: case, spacing and punctuation do not matter, so "VDC",
 * "Vdc" and "V.D.C." land in one group. Empty for a missing organisation.
 */
export function orgKey(value: unknown): string {
  return cleanOrg(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]+/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Query value the owner console uses for accounts with no organisation. */
export const ORG_NONE = '__none__';
