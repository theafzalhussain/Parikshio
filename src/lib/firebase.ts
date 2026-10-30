'use client';

import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  getAuth,
  signInWithPopup,
  signOut,
  type Auth
} from 'firebase/auth';
import { GoogleSignInError, firebaseConfig, firebaseConfigured } from './firebaseConfig';

/**
 * Firebase is used for one thing only: the Google sign-in popup.
 *
 * The popup returns an ID token which we hand to our own backend
 * (`POST /api/auth/google`). The backend verifies it against Google's public
 * certificates and mints a normal Parikshio session — so Firebase never becomes a
 * second source of truth for who a user is.
 *
 * Every value below is a public client identifier (that is how Firebase web
 * apps work); the real protection is the server-side token verification.
 */
let app: FirebaseApp | null = null;

function getFirebaseApp(): FirebaseApp {
  if (!firebaseConfigured) {
    throw new Error(
      'Google sign-in is not configured. Add NEXT_PUBLIC_FIREBASE_API_KEY, NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN and NEXT_PUBLIC_FIREBASE_PROJECT_ID to .env and restart.'
    );
  }
  if (app) return app;
  app = getApps().length ? getApps()[0]! : initializeApp(firebaseConfig);
  return app;
}

function getFirebaseAuth(): Auth {
  return getAuth(getFirebaseApp());
}

/** Human-readable messages for the Firebase error codes users actually hit. */
function describe(code: string, fallback: string): string {
  switch (code) {
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'Google sign-in was cancelled.';
    case 'auth/popup-blocked':
      return 'Your browser blocked the Google popup. Allow popups for this site and try again.';
    case 'auth/network-request-failed':
      return 'Network problem reaching Google. Check your connection and try again.';
    case 'auth/unauthorized-domain':
      return 'This domain is not authorised in your Firebase project. Add it under Authentication → Settings → Authorized domains.';
    case 'auth/operation-not-allowed':
      return 'Google sign-in is not enabled in your Firebase project. Turn it on under Authentication → Sign-in method.';
    case 'auth/configuration-not-found':
      // Firebase returns this when Authentication was never initialised for the
      // project, or the Google provider is still switched off.
      return 'Google sign-in is not set up in this Firebase project yet. Open Firebase console → Authentication → Sign-in method and enable Google.';
    case 'auth/invalid-api-key':
    case 'auth/api-key-not-valid.-please-pass-a-valid-api-key.':
      return 'The Firebase API key in .env is invalid.';
    default:
      return fallback;
  }
}

/**
 * Opens the Google popup and returns a freshly minted Firebase ID token.
 * We immediately sign out of Firebase afterwards: the token has already been
 * exchanged for a Parikshio session, so keeping Firebase state around would only
 * create two competing notions of "logged in".
 */
export async function getGoogleIdToken(): Promise<string> {
  const auth = getFirebaseAuth();
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });

  try {
    const credential = await signInWithPopup(auth, provider);
    const idToken = await credential.user.getIdToken(true);
    await signOut(auth).catch(() => undefined);
    return idToken;
  } catch (err) {
    const code = (err as { code?: string }).code ?? 'auth/unknown';
    // Surfacing the raw code in the console (never in the UI) is the only way to
    // diagnose a misconfigured Firebase project from a user's bug report.
    console.warn('[google-signin] failed:', code);
    throw new GoogleSignInError(code, describe(code, 'Google sign-in failed. Please try again.'));
  }
}
