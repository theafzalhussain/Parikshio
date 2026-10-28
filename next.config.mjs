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
const useDefaultDistDir = process.env.USE_DEFAULT_DIST_DIR === '1';
const distDir = !useDefaultDistDir && process.env.NODE_ENV === 'production' ? '.next-prod' : '.next';

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
  }
};

export default nextConfig;
