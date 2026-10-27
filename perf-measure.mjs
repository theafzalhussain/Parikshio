/**
 * Field-ish performance snapshot for the main routes.
 * Run with: node perf-measure.mjs [label]   (server must be on :3000)
 *
 * Reports LCP, CLS, FCP, long-task total (a TBT proxy), transferred JS weight
 * and the number of animations still running after load.
 */
import { chromium } from 'playwright';

const BASE = 'http://localhost:3000';
const LABEL = process.argv[2] ?? 'run';

const ROUTES = [
  { path: '/', name: 'landing' },
  { path: '/login', name: 'login' },
  { path: '/signup', name: 'signup' }
];

const browser = await chromium.launch();
const rows = [];

for (const route of ROUTES) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 820 } });
  const page = await ctx.newPage();

  const bytes = { js: 0, css: 0, font: 0, other: 0 };
  page.on('response', async (res) => {
    try {
      const url = res.url();
      if (!url.startsWith(BASE)) return;
      const len = Number(res.headers()['content-length'] ?? 0);
      const size = len || (await res.body().catch(() => Buffer.alloc(0))).length;
      if (/\.js(\?|$)/.test(url)) bytes.js += size;
      else if (/\.css(\?|$)/.test(url)) bytes.css += size;
      else if (/\.(woff2?|ttf|otf)(\?|$)/.test(url)) bytes.font += size;
      else bytes.other += size;
    } catch {
      /* ignore */
    }
  });

  // Install the observers before any page script runs.
  await page.addInitScript(() => {
    window.__perf = { lcp: 0, cls: 0, longTasks: 0, longTaskCount: 0 };
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) window.__perf.lcp = e.startTime;
    }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if (!e.hadRecentInput) window.__perf.cls += e.value;
    }).observe({ type: 'layout-shift', buffered: true });
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        window.__perf.longTasks += e.duration;
        window.__perf.longTaskCount += 1;
      }
    }).observe({ type: 'longtask', buffered: true });
  });

  await page.goto(`${BASE}${route.path}`, { waitUntil: 'load' });
  await page.waitForTimeout(3500); // let LCP settle and late shifts land

  const metrics = await page.evaluate(() => {
    const fcp = performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? 0;
    const nav = performance.getEntriesByType('navigation')[0];
    return {
      ...window.__perf,
      fcp,
      domContentLoaded: nav?.domContentLoadedEventEnd ?? 0,
      // Animations still running once the page is idle keep the compositor busy.
      runningAnimations: document.getAnimations().filter((a) => a.playState === 'running').length
    };
  });

  rows.push({
    route: route.name,
    lcp: Math.round(metrics.lcp),
    fcp: Math.round(metrics.fcp),
    cls: Number(metrics.cls.toFixed(4)),
    longTaskMs: Math.round(metrics.longTasks),
    longTasks: metrics.longTaskCount,
    jsKB: Math.round(bytes.js / 1024),
    fontKB: Math.round(bytes.font / 1024),
    anims: metrics.runningAnimations
  });

  await ctx.close();
}

await browser.close();

console.log(`\n=== perf snapshot [${LABEL}] ===`);
console.log(
  ['route', 'LCP ms', 'FCP ms', 'CLS', 'longTask ms', '#LT', 'JS KB', 'font KB', 'running anims']
    .map((h) => h.padEnd(13))
    .join('')
);
for (const r of rows) {
  console.log(
    [r.route, r.lcp, r.fcp, r.cls, r.longTaskMs, r.longTasks, r.jsKB, r.fontKB, r.anims]
      .map((v) => String(v).padEnd(13))
      .join('')
  );
}
console.log();
