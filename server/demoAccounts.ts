export const DEMO_ACCOUNT_EMAILS = {
  admin: 'admin@axiom.edu',
  faculty: 'faculty@axiom.edu',
  aarav: 'aarav@axiom.edu',
  zoya: 'zoya@axiom.edu',
  rohan: 'rohan@axiom.edu',
  ananya: 'ananya@axiom.edu',
  kabir: 'kabir@axiom.edu',
  diya: 'diya@axiom.edu',
  ishaan: 'ishaan@axiom.edu',
  vivaan: 'vivaan@axiom.edu'
} as const;

const demoAccountEmails = new Set<string>(Object.values(DEMO_ACCOUNT_EMAILS));

export function isDemoAccountEmail(email: string): boolean {
  return demoAccountEmails.has(email.trim().toLowerCase());
}
