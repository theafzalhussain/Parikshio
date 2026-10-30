/**
 * The light half of Google sign-in: whether it is configured, and its error
 * type. Pages import this freely. The Firebase SDK itself (`./firebase`) is
 * loaded only when someone actually starts a Google sign-in, so it never weighs
 * down the first load of any page.
 */

export const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? '',
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? '',
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? '',
  // Not required by Firebase Auth, but keeping it in sync with the console
  // config avoids surprises if another Firebase product is added later.
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? ''
};

/** True when the three NEXT_PUBLIC_FIREBASE_* values are present in .env. */
export const firebaseConfigured = Boolean(
  firebaseConfig.apiKey && firebaseConfig.authDomain && firebaseConfig.projectId
);

export class GoogleSignInError extends Error {
  code: string;
  /** Cancellations are expected — the UI stays silent for these. */
  cancelled: boolean;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.cancelled = code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request';
  }
}

/** Starts downloading the Google sign-in code in the background (log-in and sign-up pages). */
export function preloadGoogleSignIn(): void {
  if (!firebaseConfigured || typeof window === 'undefined') return;
  void import('./firebase').catch(() => undefined);
}

/** Opens the Google popup (loading the SDK on first use) and returns a Firebase ID token. */
export async function getGoogleIdToken(): Promise<string> {
  let sdk: typeof import('./firebase');
  try {
    sdk = await import('./firebase');
  } catch {
    throw new GoogleSignInError(
      'auth/network-request-failed',
      'Could not load Google sign-in. Check your connection and try again.'
    );
  }
  return sdk.getGoogleIdToken();
}
