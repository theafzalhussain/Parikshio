/**
 * Contact-form vocabulary, shared so the form offers exactly what the server
 * accepts.
 */

export const CONTACT_TOPICS = [
  { key: 'general', label: 'General question' },
  { key: 'feedback', label: 'Feedback' },
  { key: 'problem', label: 'Report a problem' },
  { key: 'faculty', label: 'Faculty access' },
  { key: 'onboarding', label: 'Bring Parikshio to my institute' }
] as const;

export type ContactTopic = (typeof CONTACT_TOPICS)[number]['key'];

export const CONTACT_ROLES = [
  { key: 'student', label: 'Student' },
  { key: 'faculty', label: 'Faculty' },
  { key: 'institute', label: 'Institute / school' },
  { key: 'other', label: 'Other' }
] as const;

export type ContactRole = (typeof CONTACT_ROLES)[number]['key'];

export const CONTACT_LIMITS = {
  name: 80,
  email: 160,
  org: 80,
  messageMin: 10,
  messageMax: 4000
} as const;

export function isContactTopic(value: unknown): value is ContactTopic {
  return CONTACT_TOPICS.some((t) => t.key === value);
}

export function isContactRole(value: unknown): value is ContactRole {
  return CONTACT_ROLES.some((r) => r.key === value);
}

export function contactTopicLabel(key: ContactTopic): string {
  return CONTACT_TOPICS.find((t) => t.key === key)?.label ?? 'Message';
}
