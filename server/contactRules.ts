/**
 * Rules for the contact form that are worth testing on their own.
 */

/** At most this many "we received your message" emails per address per 24 hours. */
export const CONTACT_CONFIRMATIONS_PER_DAY = 3;

const DAY_MS = 24 * 60 * 60_000;

/**
 * Whether the sender gets their own copy of this message. Capped per address
 * and day, so the form cannot be used to flood somebody else's inbox with mail
 * from Parikshio. The team notification is never capped.
 */
export function shouldSendContactCopy(
  recent: { email: string; confirmationSent: boolean; createdAt: number }[],
  email: string,
  now: number
): boolean {
  const sentToday = recent.filter((m) => m.email === email && m.confirmationSent && m.createdAt > now - DAY_MS).length;
  return sentToday < CONTACT_CONFIRMATIONS_PER_DAY;
}

/** Short, human-quotable id for a message, e.g. "PKS-6171515F". */
export function contactReference(id: string): string {
  return `PKS-${id.replace(/^msg_/, '').slice(0, 8).toUpperCase()}`;
}
