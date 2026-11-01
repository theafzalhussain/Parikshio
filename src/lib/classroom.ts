/**
 * What to tell faculty after Google sends them back from the Classroom
 * connection (`?classroom=connected|denied|error&reason=…`). The reason is a
 * short code set by the server, never Google's raw text.
 */
export function classroomResultMessage(
  result: string,
  reason: string | null
): { kind: 'success' | 'warn' | 'error'; title: string; body?: string } | null {
  if (result === 'connected') return { kind: 'success', title: 'Google Classroom connected' };
  if (result === 'denied') return { kind: 'warn', title: 'Google Classroom connection was cancelled' };
  if (result !== 'error') return null;
  const body =
    reason === 'expired'
      ? 'The Google sign-in took longer than 10 minutes or was already used. Start the connection again.'
      : reason === 'no-refresh-token'
        ? 'Google did not grant offline access. Remove Parikshio under your Google account → Security → Third-party access, then connect again.'
        : reason === 'redirect'
          ? 'Google rejected the callback URL. Add the URL shown under "Connect Google Classroom" to the OAuth client in Google Cloud Console.'
          : 'Check the Google Cloud OAuth setup (authorized redirect URI, test users, Classroom API enabled) and try again.';
  return { kind: 'error', title: 'Google Classroom connection failed', body };
}
