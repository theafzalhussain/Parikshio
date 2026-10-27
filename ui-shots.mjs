/**
 * Visual + a11y sweep. Captures screenshots and asserts the things that are
 * easy to break when restyling: accessible names on controls, a reachable skip
 * link, working dialogs, and no console errors.
 *
 * Run with: node ui-shots.mjs [outDir]
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const BASE = 'http://localhost:3000';
const OUT = process.argv[2] ?? 'docs/ui-review';
await mkdir(OUT, { recursive: true });

const results = [];
const ok = (name, pass, extra = '') => {
  results.push({ name, pass, extra });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${extra ? `  — ${extra}` : ''}`);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const consoleErrors = [];
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

async function shoot(path, file, full = false) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/${file}.png`, fullPage: full });
  return page;
}

// ── typography actually applied ──
console.log('\n1) webfonts applied');
await shoot('/', 'landing', true);
const fonts = await page.evaluate(() => {
  const body = getComputedStyle(document.body).fontFamily;
  const accent = document.querySelector('.font-display');
  return { body, accent: accent ? getComputedStyle(accent).fontFamily : '(none)' };
});
ok('body uses the Inter variable', /__Inter|Inter/.test(fonts.body), fonts.body.slice(0, 60));
ok('accent uses the serif display face', /Instrument|serif/i.test(fonts.accent), fonts.accent.slice(0, 60));
const loaded = await page.evaluate(() => document.fonts.size > 0 && document.fonts.status === 'loaded');
ok('font set finished loading', loaded);

// ── skip link ──
console.log('\n2) skip link');
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await page.keyboard.press('Tab');
// The link slides in over 200ms; measuring immediately catches it mid-transition.
await page.waitForTimeout(500);
const skip = await page.evaluate(() => {
  const el = document.activeElement;
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return {
    text: el.textContent?.trim(),
    href: el.getAttribute('href'),
    top: Math.round(r.top),
    visible: r.top >= 0 && r.height > 0 && getComputedStyle(el).opacity === '1'
  };
});
ok('first Tab lands on the skip link', /skip to main/i.test(skip?.text ?? ''), skip?.text ?? 'nothing focused');
ok('skip link becomes visible on focus', skip?.visible === true, JSON.stringify(skip));
ok('skip target exists', (await page.locator('#main').count()) > 0);
await page.screenshot({ path: `${OUT}/skip-link-focused.png`, clip: { x: 0, y: 0, width: 520, height: 140 } });

// ── every form control has an accessible name ──
console.log('\n3) accessible names on auth forms');
for (const path of ['/login', '/signup', '/forgot-password']) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
  const unnamed = await page.evaluate(() => {
    const bad = [];
    document.querySelectorAll('input, select, textarea').forEach((el) => {
      if (el.type === 'hidden') return;
      const byLabel = el.id ? document.querySelector(`label[for="${el.id}"]`) : null;
      const name =
        el.getAttribute('aria-label') ||
        (el.getAttribute('aria-labelledby') &&
          document.getElementById(el.getAttribute('aria-labelledby'))?.textContent) ||
        byLabel?.textContent ||
        el.closest('label')?.textContent;
      if (!name || !name.trim()) bad.push(el.getAttribute('name') || el.type || el.tagName);
    });
    return bad;
  });
  ok(`${path}: all controls named`, unnamed.length === 0, unnamed.join(', '));
}

// ── clicking the label focuses the field ──
console.log('\n4) label click focuses its field');
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await page.getByText('Email address', { exact: true }).click();
const focusedId = await page.evaluate(() => document.activeElement?.id ?? '');
ok('label click moved focus into the input', focusedId === 'login-email', focusedId || '(none)');

// ── toast: announced, dismissible ──
console.log('\n5) toast behaviour');
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await page.fill('#login-email', 'admin@axiom.edu');
await page.locator('input[type="password"]').first().fill('admin123');
await page.getByRole('button', { name: /^sign in/i }).first().click();
// Assert the toast before the redirect settles: on a cold dev server compiling
// /admin can outlast the toast's own lifetime, which would look like a failure.
// Target the toast precisely: `[role=alert]` alone also matches the inline form
// banner on the login page.
const toast = page.locator('[data-toast]').last();
await toast.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
const toastCount = await toast.count();
ok('a toast appeared after login', toastCount > 0);
if (toastCount > 0) {
  const role = await toast.getAttribute('role');
  ok('toast is a live region', role === 'status' || role === 'alert', `role=${role}`);
  const closeBtn = toast.getByRole('button', { name: /dismiss/i });
  const hasClose = (await closeBtn.count()) > 0;
  ok('toast has a dismiss button', hasClose);
  if (hasClose) {
    await closeBtn.click();
    await page.waitForTimeout(400);
    ok('dismiss actually removes it', (await page.locator('[data-toast]').count()) === 0);
  }
}
await page.waitForURL(/\/admin/, { timeout: 40000 }).catch(() => {});
await page.waitForLoadState('networkidle').catch(() => {});
ok('landed on the admin console', page.url().includes('/admin'), page.url());
await page.screenshot({ path: `${OUT}/admin-overview.png`, fullPage: true });

// ── mobile drawer is a real dialog ──
console.log('\n6) mobile nav drawer');
await page.setViewportSize({ width: 430, height: 880 });
await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle' });
const menuBtn = page.getByRole('button', { name: /open navigation/i });
await menuBtn.waitFor({ state: 'visible', timeout: 30000 });
await menuBtn.click();
await page.waitForTimeout(500);
const drawer = page.getByRole('dialog', { name: /main navigation/i });
ok('drawer exposes role=dialog', (await drawer.count()) > 0);
const bodyLocked = await page.evaluate(() => getComputedStyle(document.body).overflow);
ok('page behind is scroll-locked', bodyLocked === 'hidden', bodyLocked);
const focusInside = await page.evaluate(() => {
  const d = document.querySelector('[role="dialog"]');
  return d ? d.contains(document.activeElement) : false;
});
ok('focus moved inside the drawer', focusInside);
await page.screenshot({ path: `${OUT}/mobile-drawer.png` });
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
ok('Escape closes the drawer', (await page.getByRole('dialog', { name: /main navigation/i }).count()) === 0);
const restored = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '');
ok('focus returned to the menu button', /open navigation/i.test(restored), restored || '(none)');
const unlocked = await page.evaluate(() => getComputedStyle(document.body).overflow);
ok('scroll lock released', unlocked !== 'hidden', unlocked);

await page.setViewportSize({ width: 1440, height: 900 });
await shoot('/student', 'student-lobby', true).catch(() => {});

console.log('\n7) console cleanliness');
const real = consoleErrors.filter((e) => !/favicon|404 \(Not Found\)|Failed to load resource/i.test(e));
ok('no console errors', real.length === 0, real.slice(0, 2).join(' | ').slice(0, 160));

await browser.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${'='.repeat(60)}`);
console.log(`TOTAL ${results.length}  PASS ${results.length - failed.length}  FAIL ${failed.length}`);
if (failed.length) {
  console.log('\nFailures:');
  failed.forEach((f) => console.log(`  - ${f.name}  ${f.extra}`));
}
console.log(`\nscreenshots → ${OUT}/`);
process.exit(failed.length ? 1 : 0);
