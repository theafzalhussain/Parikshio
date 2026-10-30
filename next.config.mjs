/**
 * Production builds get their own output directory.
 *
 * Both `next dev` and `next build` default to `.next`. Because this app runs
 * behind a custom Express server, starting the dev server while a production
 * build is being served silently replaces that build's output — the prod
 * process then 500s on its own CSS and chunks and React never hydrates.
 *
 * Dev deliberately keeps the default `.next` (pointing the dev bundler at a
 * custom directory breaks its on-demand `_document` compilation), so only the
 * production path moves.
 *
 * Exception: a managed frontend host (e.g. Vercel) runs only `next build` and
 * then looks for the default `.next` directory. There is no co-located dev
 * server to clash with there, so `USE_DEFAULT_DIST_DIR=1` keeps the default
 * `.next` and lets the host's output detection work.
 */
const useDefaultDistDir = process.env.USE_DEFAULT_DIST_DIR === '1' || process.env.VERCEL === '1';
const distDir = !useDefaultDistDir && process.env.NODE_ENV === 'production' ? '.next-prod' : '.next';

/**
 * Where pages may connect. The API (and its websocket) may live on another
 * host; Google sign-in runs through Firebase. Nothing else is allowed, so even
 * injected script could not send a session token anywhere else.
 */
function originOf(value) {
  try {
    return value ? new URL(value).origin : '';
  } catch {
    return '';
  }
}
const apiOrigin = originOf((process.env.NEXT_PUBLIC_API_URL ?? '').trim());
const apiSocket = apiOrigin ? apiOrigin.replace(/^http/, 'ws') : '';
const firebaseAuthDomain = (process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? '').trim();
const firebaseFrame = firebaseAuthDomain ? `https://${firebaseAuthDomain}` : '';
const isDev = process.env.NODE_ENV !== 'production';

const contentSecurityPolicy = [
  "default-src 'self'",
  // Next.js inlines its boot data; dev mode also needs eval for fast refresh.
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''} https://apis.google.com`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  [
    "connect-src 'self'",
    apiOrigin,
    apiSocket,
    'https://identitytoolkit.googleapis.com',
    'https://securetoken.googleapis.com',
    'https://www.googleapis.com',
    isDev ? 'ws: wss:' : ''
  ]
    .filter(Boolean)
    .join(' '),
  ['frame-src', firebaseFrame || "'none'", firebaseFrame ? 'https://accounts.google.com' : ''].filter(Boolean).join(' '),
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  isDev ? '' : 'upgrade-insecure-requests'
]
  .filter(Boolean)
  .join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: contentSecurityPolicy },
  // Pages can never be framed by another site (clickjacking).
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // The Google sign-in popup still reports back to the page that opened it.
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()'
  },
  ...(isDev ? [] : [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' }])
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir,
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
  poweredByHeader: false,
  experimental: {
    // Keep server-side packages out of the client bundle
    serverComponentsExternalPackages: ['mongoose', 'ioredis', 'bcryptjs']
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  }
};

export default nextConfig;
