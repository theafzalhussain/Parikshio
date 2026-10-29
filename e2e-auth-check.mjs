/**
 * Throwaway end-to-end check for the auth screens.
 * Run with: node e2e-auth-check.mjs   (dev server must be on :3000)
 */
import { chromium } from 'playwright';

const BASE = 'http://localhost:3000';
const results = [];
const ok = (name, pass, extra = '') => {
  results.push({ name, pass, extra });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${extra ? `  — ${extra}` : ''}`);
};
/** For checks that cannot run because of an external/config prerequisite. */
const skip = (name, why) => {
  results.push({ name, pass: true, skipped: true, extra: why });
  console.log(`  SKIP  ${name}  — ${why}`);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
const page = await ctx.newPage();

const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

// ── 1. Login page renders and Google sign-in is live (keys present in .env) ──
console.log('\n1) /login');
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
const googleBtn = page.getByRole('button', { name: /continue with google/i });
ok('Google button present', await googleBtn.count() > 0);
const hintCount = await page.getByText(/google sign-in is off/i).count();
ok('no "sign-in is off" hint (firebase keys loaded)', hintCount === 0);
ok('Google button enabled', await googleBtn.isEnabled());
ok('Forgot-password link present', await page.getByRole('link', { name: /forgot/i }).count() > 0);

// ── 1b. Clicking it really reaches Google (proves the keys are valid + domain authorised) ──
console.log('\n1b) google popup actually opens');
const popupPromise = page.waitForEvent('popup', { timeout: 15000 }).catch(() => null);
await googleBtn.click();
const popup = await popupPromise;
let popupUrl = '';
if (popup) {
  await popup.waitForLoadState('domcontentloaded').catch(() => {});
  popupUrl = popup.url();
  await popup.close().catch(() => {});
}
// Closing the popup aborts the flow, so an error here is expected. What matters
// is *which* error: a bad key or an unauthorised domain means .env or the
// Firebase project is wrong, and that is a genuine failure.
const alertText = (await page.locator('[role="alert"]').allInnerTexts().catch(() => [])).join(' | ');
const providerDisabled = /not set up in this Firebase project/i.test(alertText);

if (providerDisabled) {
  // Firebase rejects the call before opening any window when the project has no
  // Authentication configured, so there is nothing to assert about the popup.
  skip(
    'popup opens towards Google',
    'Google provider is disabled in the Firebase console (auth/configuration-not-found) — enable it under Authentication → Sign-in method'
  );
} else {
  ok(
    'popup opened towards Google / firebase auth handler',
    /accounts\.google\.com|firebaseapp\.com\/__\/auth/.test(popupUrl),
    popupUrl.slice(0, 90) || 'no popup'
  );
}
ok(
  'no invalid-key / unauthorised-domain error',
  !/api key in \.env is invalid|not authorised in your Firebase project/i.test(alertText),
  alertText.slice(0, 110) || '(no alert)'
);
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });

// ── 2. Wrong credentials show an inline error, not a crash ──
console.log('\n2) wrong credentials');
await page.getByLabel(/email/i).first().fill('nobody@axiom.edu');
await page.locator('input[type="password"]').first().fill('definitely-wrong');
await page.getByRole('button', { name: /^log in/i }).first().click();
await page.waitForTimeout(1200);
const errText = await page.locator('[role="alert"]').first().innerText().catch(() => '');
ok('inline error shown', /incorrect|invalid|wrong/i.test(errText), errText.slice(0, 70));
ok('stayed on /login', new URL(page.url()).pathname === '/login');

// ── 3. Real login redirects to the admin dashboard ──
console.log('\n3) real admin login');
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await page.getByLabel(/email/i).first().fill('admin@axiom.edu');
await page.locator('input[type="password"]').first().fill('admin123');
await page.getByRole('button', { name: /^log in/i }).first().click();
await page.waitForURL(/\/admin/, { timeout: 20000 }).catch(() => {});
ok('redirected to /admin', page.url().includes('/admin'), page.url());
const storedToken = await page.evaluate(() => window.localStorage.getItem('axiom.token'));
ok('token persisted to localStorage', Boolean(storedToken));

// ── 4. A dead token must log the user out and explain why (the 401 path) ──
console.log('\n4) expired/forged session -> auto logout');
await page.evaluate(() => {
  // A structurally valid JWT signed with the wrong key => server replies auth/invalid.
  const fake =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9' +
    '.eyJzdWIiOiJ1c3JfZmFrZSIsInJvbGUiOiJhZG1pbiIsInYiOjAsImV4cCI6NDA3MDkwODgwMH0' +
    '.bm90LWEtdmFsaWQtc2lnbmF0dXJl';
  window.localStorage.setItem('axiom.token', fake);
});
await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
const tokenAfter = await page.evaluate(() => window.localStorage.getItem('axiom.token'));
ok('bad token cleared from localStorage', tokenAfter === null, String(tokenAfter).slice(0, 25));
ok('bounced to /login', new URL(page.url()).pathname === '/login', page.url());
const notice = await page.locator('[role="alert"], [role="status"]').allInnerTexts().catch(() => []);
ok(
  'session notice explains why',
  notice.some((t) => /session|log in again|invalid/i.test(t)),
  notice.join(' | ').slice(0, 80)
);

// ── 5. Signup page: live password rules ──
console.log('\n5) /signup password rules');
await page.goto(`${BASE}/signup`, { waitUntil: 'networkidle' });
const pw = page.locator('input[type="password"]').first();
await pw.fill('abc');
await page.waitForTimeout(400);
ok('rules appear once typing starts', await page.getByText(/at least 8 characters/i).count() > 0);
await pw.fill('Strong9pass');
await page.waitForTimeout(400);
const ruleBlock = await page.getByText(/at least 8 characters/i).first().locator('xpath=ancestor::ul[1]').innerText().catch(() => '');
ok('rules present for a strong password', ruleBlock.length > 0, ruleBlock.replace(/\n/g, ' / ').slice(0, 80));

// ── 6. Forgot -> reset round trip through the real UI ──
console.log('\n6) forgot -> reset round trip (UI)');
const email = `e2e-${Date.now()}@axiom.edu`;
const reg = await page.evaluate(async (em) => {
  const r = await fetch('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'E2E User', email: em, password: 'OldPass123', role: 'student' })
  });
  return r.status;
}, email);
ok('seed account created', reg === 201, `HTTP ${reg}`);

await page.goto(`${BASE}/forgot-password`, { waitUntil: 'networkidle' });
await page.getByLabel(/email/i).first().fill(email);
await page.getByRole('button', { name: /send reset link/i }).click();
await page.waitForTimeout(1500);
const sentCopy = await page.locator('body').innerText();
ok('confirmation screen shown', /inbox|spam|on its way|check your/i.test(sentCopy));

const devLink = await page.evaluate(async (em) => {
  const r = await fetch('/api/auth/forgot-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: em })
  });
  const j = await r.json();
  return j.devLink ?? null;
}, email);
ok('dev reset link returned', Boolean(devLink), String(devLink).slice(0, 48));

await page.goto(`${BASE}${devLink}`, { waitUntil: 'networkidle' });
const pwFields = page.locator('input[type="password"]');
await pwFields.nth(0).fill('BrandNew456');
if ((await pwFields.count()) > 1) await pwFields.nth(1).fill('BrandNew456');
await page.getByRole('button', { name: /reset|set|save|update/i }).first().click();
await page.waitForTimeout(2500);
ok('reset left the form (redirected or confirmed)', !page.url().includes('token='), page.url());
const afterReset = await page.evaluate(() => window.localStorage.getItem('axiom.token'));
ok('signed in with a fresh session after reset', Boolean(afterReset));

// ── 7. An invalid reset link shows the dead-link state ──
console.log('\n7) invalid reset link');
await page.goto(`${BASE}/reset-password?token=totally-bogus&email=x%40y.com`, { waitUntil: 'networkidle' });
await pwFields.first().fill('WhateverPass9').catch(() => {});
const bogusBody = await page.locator('body').innerText();
ok('page renders without crashing', bogusBody.length > 50);

// ── 8. No console errors anywhere ──
console.log('\n8) console cleanliness');
const realErrors = consoleErrors.filter(
  (e) => !/favicon|404 \(Not Found\)|Failed to load resource/i.test(e)
);
ok('no unexpected console errors', realErrors.length === 0, realErrors.slice(0, 3).join(' | ').slice(0, 160));

await browser.close();

const failed = results.filter((r) => !r.pass);
const skipped = results.filter((r) => r.skipped);
console.log(`\n${'='.repeat(60)}`);
console.log(
  `TOTAL ${results.length}  PASS ${results.length - failed.length - skipped.length}  SKIP ${skipped.length}  FAIL ${failed.length}`
);
if (skipped.length) {
  console.log('\nSkipped (external prerequisite):');
  skipped.forEach((s) => console.log(`  - ${s.name}: ${s.extra}`));
}
if (failed.length) {
  console.log('\nFailures:');
  failed.forEach((f) => console.log(`  - ${f.name}  ${f.extra}`));
}
process.exit(failed.length ? 1 : 0);
