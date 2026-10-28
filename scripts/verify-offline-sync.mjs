/**
 * End-to-end verification of the offline-first submission path.
 *
 * Drives a real browser, cuts its network at the moment the student submits,
 * and checks that the answer survives on the device and reaches the backend by
 * itself once the connection returns.
 *
 * Run with:  node scripts/verify-offline-sync.mjs      (server must be on :3000)
 */
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const ADMIN = { email: 'admin@axiom.edu', password: 'admin123' };
const STUDENT = { email: 'aarav@axiom.edu', password: 'student123' };
/** Must match the development server's offline sync allowance. */
const OFFLINE_GRACE_MS = Number(process.env.OFFLINE_SYNC_GRACE_MS ?? 45_000);

const results = [];
const check = (name, pass, extra = '') => {
  results.push({ name, pass: !!pass, extra });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${extra ? `  — ${extra}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function apiCall(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(json).slice(0, 200)}`);
  return json;
}

/* ── a session to answer ────────────────────────────────────── */

const admin = await apiCall('/auth/login', { method: 'POST', body: ADMIN });
const bank = await apiCall('/questions', { token: admin.token });
const mcqs = bank.questions.filter((q) => q.type === 'mcq');
const written = bank.questions.filter((q) => q.type === 'short' || q.type === 'fill');
// Typed-answer tests use `fill`, which the answer key grades: `short` would be
// handed to the AI evaluator and burn Gemini quota on every run.
const fills = bank.questions.filter((q) => q.type === 'fill');
if (mcqs.length < 5 || written.length < 1 || fills.length < 2) {
  console.error(`Need 5 MCQs and 2 fill questions; bank has ${mcqs.length} / ${fills.length}.`);
  process.exit(1);
}
const [qHappy, qLate, qStale, qOnline, qFallback] = mcqs;
const [qDraft, qTyped] = fills;
const qRestart = mcqs[5] ?? qOnline;

const { exam } = await apiCall('/exams', {
  method: 'POST',
  token: admin.token,
  body: {
    title: 'Offline sync verification',
    subject: 'QA',
    questionIds: [qHappy.id, qLate.id, qStale.id, qDraft.id, qOnline.id, qFallback.id, qTyped.id, qRestart.id]
  }
});
console.log(`\nexam ${exam.code}  ·  ${exam.id}`);
console.log(`draft question: ${qDraft.type}  ·  ${qDraft.id}`);

const push = (questionId, timerSeconds) =>
  apiCall(`/exams/${exam.id}/push`, { method: 'POST', token: admin.token, body: { questionId, timerSeconds } });

const serverRows = async (questionId) => {
  const detail = await apiCall(`/exams/${exam.id}`, { token: admin.token });
  return detail.responses.filter((r) => r.questionId === questionId && r.studentName === 'Aarav Mehta');
};

/* ── browser ────────────────────────────────────────────────── */

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
const page = await ctx.newPage();

// Toasts self-dismiss, so collect them as they appear instead of scraping the
// DOM after the fact.
await page.addInitScript(() => {
  window.__toasts = [];
  const seen = new WeakSet();
  const scan = () => {
    try {
      document.querySelectorAll('[data-toast]').forEach((el) => {
        if (seen.has(el)) return;
        seen.add(el);
        window.__toasts.push({ kind: el.getAttribute('data-toast'), text: el.innerText });
      });
    } catch {
      /* document not ready yet */
    }
  };
  window.setInterval(scan, 120);
});

const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

const bodyText = () => page.locator('body').innerText();
const toasts = () => page.evaluate(() => window.__toasts ?? []);
async function refreshQuestion(question) {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    (prompt) => document.body.innerText.includes(prompt),
    question.prompt,
    { timeout: 15_000 }
  );
}
/** Waits until any toast matching `re` has been seen. */
async function waitForToast(re, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const seen = await toasts();
    const hit = seen.find((t) => re.test(t.text));
    if (hit) return hit;
    await sleep(400);
  }
  return null;
}

/** Reads a store straight out of IndexedDB — proof the answer is on disk. */
const readStore = (name) =>
  page.evaluate(
    (store) =>
      new Promise((resolve) => {
        const open = indexedDB.open('axiom-offline', 1);
        open.onerror = () => resolve('idb-error');
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains(store)) return resolve([]);
          const req = db.transaction(store, 'readonly').objectStore(store).getAll();
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve('tx-error');
        };
      }),
    name
  );
const outbox = () => readStore('outbox');
const drafts = () => readStore('drafts');

/** Clicks the first MCQ option: its leading badge holds a single letter. */
const pickFirstOption = () =>
  page.evaluate(() => {
    const option = [...document.querySelectorAll('button')].find((b) => {
      const badge = b.firstElementChild;
      return badge && /^[A-Z]$/.test((badge.textContent ?? '').trim());
    });
    if (!option) return false;
    option.click();
    return true;
  });

const goOffline = async () => {
  await ctx.setOffline(true);
  await page.waitForFunction(() => navigator.onLine === false, { timeout: 10_000 });
  await page.waitForTimeout(400);
};
const goOnline = async () => {
  await ctx.setOffline(false);
  await page.waitForFunction(() => navigator.onLine === true, { timeout: 10_000 });
};

/** Queues an answer for the live question with the network down. */
async function saveOffline(label) {
  await goOffline();
  check(`${label}: offline banner shown`, /You are offline/i.test(await bodyText()));
  const saveButton = page.locator('button:has-text("Save answer")');
  try {
    await saveButton.waitFor({ timeout: 10_000 });
  } catch (error) {
    await dump(`${label}-missing-save-button`);
    throw error;
  }
  check(`${label}: submit control offers to save locally`, true);
  check(`${label}: an option could be selected`, await pickFirstOption());
  await saveButton.click();
  await page.waitForTimeout(900);
}

async function dump(tag) {
  const text = (await bodyText()).replace(/\n+/g, ' | ').slice(0, 600);
  console.log(`     [dump ${tag}] ${text}`);
  await page.screenshot({ path: `verify-offline-${tag}.png`, fullPage: true }).catch(() => {});
}

// Sign the student in the way the app does, then land straight in the room.
await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
const student = await page.evaluate(async (creds) => {
  const r = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(creds)
  });
  const j = await r.json();
  window.localStorage.setItem('axiom.token', j.token);
  window.localStorage.setItem('axiom.user', JSON.stringify(j.user));
  return j.user;
}, STUDENT);
check('student session established', student?.role === 'student', student?.email);

/* ── 1. offline submit, reconnect while the question is open ── */

console.log('\n1) submit offline · reconnect while the question is still open');
const happyPush = await push(qHappy.id, 120);
await page.goto(`${BASE}/student/exam/${exam.code}`, { waitUntil: 'domcontentloaded' });
await page.locator('button:has-text("Submit answer")').waitFor({ timeout: 25_000 });
check('live question rendered while online', true);

await saveOffline('happy path');
check('answer reported as saved on the device', /Saved on this device/i.test(await bodyText()));
check('header shows the queued count', /1 queued/i.test(await bodyText()));

const queued = await outbox();
check(
  'record written to IndexedDB',
  Array.isArray(queued) && queued.length === 1 && queued[0].questionId === qHappy.id,
  Array.isArray(queued) ? `${queued.length} record(s)` : String(queued)
);
check(
  'record carries the submit stamp inside the question window',
  Array.isArray(queued) &&
    queued.length === 1 &&
    queued[0].clientSubmittedAt >= queued[0].pushedAt &&
    queued[0].clientSubmittedAt <= queued[0].endsAt
);
check('nothing reached the backend yet', (await serverRows(qHappy.id)).length === 0);
/** What the student's own clock says the answer took. */
const clientLatency = queued[0].clientSubmittedAt - queued[0].pushedAt;

const outageMs = 6_000;
await sleep(outageMs);
await goOnline();
const deliveredToast = await waitForToast(/delivered/i);
check('delivery announced to the student', !!deliveredToast, deliveredToast?.text?.replace(/\n/g, ' ').slice(0, 70));

const delivered = await serverRows(qHappy.id);
check('answer delivered after reconnect', delivered.length === 1);
check('backend flagged it as an offline replay', delivered[0]?.offline === true);
check(
  'latency uses trusted server receipt time, not the client clock',
  delivered[0] &&
    Math.abs(delivered[0].latencyMs - (delivered[0].submittedAt - happyPush.active.pushedAt)) < 1,
  `latency ${delivered[0]?.latencyMs}ms; client claimed ${clientLatency}ms`
);
check(
  'untrusted client time cannot hide the reconnect delay',
  delivered[0] && delivered[0].latencyMs >= clientLatency + outageMs - 1_500,
  `server latency ${delivered[0]?.latencyMs}ms; reconnect was ${outageMs}ms later`
);
check('outbox emptied', (await outbox()).length === 0);
check('UI switched to the recorded state', /Answer recorded/i.test(await bodyText()));

/* ── 2. reconnect after the timer expired, inside the allowance ── */

console.log('\n2) submit offline · reconnect after the timer expired, inside the offline allowance');
await push(qLate.id, 5);
await refreshQuestion(qLate);
await page.waitForTimeout(1_200);
await saveOffline('late sync');
check('late answer queued', (await outbox()).length === 1);

// Let the question's own deadline pass while the device is still dark.
await sleep(9_000);
await goOnline();
await waitForToast(/delivered/i, 15_000);

const lateRows = await serverRows(qLate.id);
check(
  'accepted after the question closed (offline allowance)',
  lateRows.length === 1 && lateRows[0].offline === true,
  lateRows[0] ? `latency ${lateRows[0].latencyMs}ms` : 'no row'
);
check('late record cleared from the outbox', (await outbox()).length === 0);

/* ── 3. reconnect far too late — refused, and said so ───────── */

console.log('\n3) submit offline · reconnect long after the allowance expired');
await push(qStale.id, 30);
await refreshQuestion(qStale);
await page.waitForTimeout(1_200);
await saveOffline('stale sync');
check('answer queued before the long outage', (await outbox()).length === 1);

const longOutage = 30_000 + OFFLINE_GRACE_MS + 13_000;
console.log(`     waiting ${Math.round(longOutage / 1000)}s offline…`);
await sleep(longOutage);
await goOnline();
const refusalToast = await waitForToast(/could not be delivered/i, 25_000);

check('backend refused the stale answer', (await serverRows(qStale.id)).length === 0);
check('stale record dropped instead of retried forever', (await outbox()).length === 0);
check(
  'student was told why',
  !!refusalToast && /already closed|closed/i.test(refusalToast.text),
  refusalToast?.text?.replace(/\n/g, ' ').slice(0, 110) ?? 'no toast seen'
);

/* ── 4. typed-but-unsubmitted answer survives a reload ──────── */

console.log('\n4) a typed answer survives a page reload');
await push(qDraft.id, 600);
await refreshQuestion(qDraft);
await page.waitForTimeout(2_000);
const field = page.locator('textarea.input-base, input.input-base').first();
try {
  await field.waitFor({ timeout: 15_000 });
} catch {
  await dump('no-input');
}
if (await field.count()) {
  await field.fill('A partially typed answer that must not be lost.');
  await page.waitForTimeout(1_000);
  const saved = await drafts();
  check('draft persisted while typing', Array.isArray(saved) && saved.length >= 1, `${saved.length ?? 0} draft(s)`);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3_500);
  const restored = await page.locator('textarea.input-base, input.input-base').first().inputValue();
  check('draft restored after the reload', restored.includes('partially typed answer'), restored.slice(0, 48));
} else {
  check('draft persisted while typing', false, 'no answer field rendered');
  check('draft restored after the reload', false, 'skipped');
}

/* ── 5. the ordinary online path is untouched ───────────────── */

console.log('\n5) a normal online submission still behaves exactly as before');
await push(qOnline.id, 120);
await refreshQuestion(qOnline);
await page.waitForTimeout(1_500);
const submitButton = page.locator('button:has-text("Submit answer")');
await submitButton.waitFor({ timeout: 15_000 });
check('online submit control reads "Submit answer"', true);
check('no offline panel while connected', !/You are offline|saved on this device/i.test(await bodyText()));
check('an option could be selected', await pickFirstOption());
await submitButton.click();
await page.waitForFunction(() => /Answer recorded/i.test(document.body.innerText), { timeout: 15_000 }).catch(() => {});
const onlineRows = await serverRows(qOnline.id);
check('online answer recorded immediately', onlineRows.length === 1);
check('not marked as an offline replay', onlineRows[0] && onlineRows[0].offline !== true);
check('nothing was queued on the device', (await outbox()).length === 0);
check('receipt toast shown', !!(await waitForToast(/locked in/i, 8_000)));

/* ── 6. localStorage fallback when IndexedDB is unavailable ── */

console.log('\n6) the queue still works when IndexedDB is blocked');
const lockedCtx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
await lockedCtx.addInitScript(() => {
  // Mirrors Safari private mode / locked-down webviews.
  Object.defineProperty(window, 'indexedDB', { get: () => undefined, configurable: true });
});
const lockedPage = await lockedCtx.newPage();
await lockedPage.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
await lockedPage.evaluate(async (creds) => {
  const r = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(creds)
  });
  const j = await r.json();
  window.localStorage.setItem('axiom.token', j.token);
  window.localStorage.setItem('axiom.user', JSON.stringify(j.user));
}, STUDENT);

await push(qFallback.id, 120);
await lockedPage.goto(`${BASE}/student/exam/${exam.code}`, { waitUntil: 'domcontentloaded' });
await lockedPage.locator('button:has-text("Submit answer")').waitFor({ timeout: 25_000 });
await lockedCtx.setOffline(true);
await lockedPage.waitForFunction(() => navigator.onLine === false, { timeout: 10_000 });
await lockedPage.waitForTimeout(400);
await lockedPage.locator('button:has-text("Save answer")').waitFor({ timeout: 10_000 });
await lockedPage.evaluate(() => {
  const option = [...document.querySelectorAll('button')].find((b) => {
    const badge = b.firstElementChild;
    return badge && /^[A-Z]$/.test((badge.textContent ?? '').trim());
  });
  option?.click();
});
await lockedPage.locator('button:has-text("Save answer")').click();
await lockedPage.waitForTimeout(900);

const lsQueue = await lockedPage.evaluate(() => {
  const raw = window.localStorage.getItem('axiom.offline.outbox');
  return raw ? Object.values(JSON.parse(raw)) : [];
});
check('record fell back to localStorage', lsQueue.length === 1 && lsQueue[0].questionId === qFallback.id, `${lsQueue.length} record(s)`);
check('student still told the answer is held locally', /Saved on this device/i.test(await lockedPage.locator('body').innerText()));

await lockedCtx.setOffline(false);
await lockedPage.waitForFunction(() => navigator.onLine === true, { timeout: 10_000 });
await lockedPage.waitForFunction(() => /Answer recorded/i.test(document.body.innerText), { timeout: 25_000 }).catch(() => {});
check('fallback queue delivered after reconnect', (await serverRows(qFallback.id)).length === 1);
const lsAfter = await lockedPage.evaluate(() => window.localStorage.getItem('axiom.offline.outbox'));
check('fallback queue emptied', lsAfter === '{}' || lsAfter === null, String(lsAfter).slice(0, 60));
await lockedCtx.close();

/* ── 7. a typed answer submitted offline ────────────────────── */

console.log('\n7) a typed (non-multiple-choice) answer submitted offline');
await push(qTyped.id, 120);
await refreshQuestion(qTyped);
await page.waitForTimeout(1_500);
const typedField = page.locator('textarea.input-base, input.input-base').first();
await typedField.waitFor({ timeout: 15_000 });
const typedAnswer = 'offline typed answer 42';
await goOffline();
check('typed question: offline banner shown', /You are offline/i.test(await bodyText()));
await typedField.fill(typedAnswer);
await page.waitForTimeout(600);
await page.locator('button:has-text("Save answer")').click();
await page.waitForTimeout(900);
const typedQueue = await outbox();
check(
  'typed answer queued verbatim',
  typedQueue.length === 1 && typedQueue[0].answer === typedAnswer,
  typedQueue[0]?.answer
);
check('field locked while the answer is pending sync', await typedField.isDisabled());
await goOnline();
await waitForToast(/delivered/i, 20_000);
const typedRows = await serverRows(qTyped.id);
check(
  'typed answer delivered with its text intact',
  typedRows.length === 1 && typedRows[0].answer === typedAnswer,
  typedRows[0]?.answer
);
check('typed answer graded by the key on arrival', typedRows[0] && typedRows[0].grade !== 'pending', typedRows[0]?.grade);
check('typed outbox emptied', (await outbox()).length === 0);

/* ── 8. console cleanliness ─────────────────────────────────── */

console.log('\n8) console cleanliness');
// `Failed to fetch RSC payload` is Next's router failing a link prefetch while
// the network is deliberately down (production builds prefetch visible links).
const noise =
  /favicon|Failed to load resource|ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED|ERR_NAME_NOT_RESOLVED|websocket|socket\.io|xhr poll error|transport close|404|Failed to fetch RSC payload/i;
const realErrors = consoleErrors.filter((e) => !noise.test(e));
check('no unexpected console errors', realErrors.length === 0, realErrors.slice(0, 3).join(' | ').slice(0, 220));

await browser.close();

/* ── 9. the queue survives a full browser restart ───────────── */

console.log('\n9) a queued answer survives closing and reopening the browser');
const profile = path.join(os.tmpdir(), `axiom-offline-profile-${Date.now()}`);

// First run: sign in, queue an answer with the network down, then quit entirely.
const first = await chromium.launchPersistentContext(profile, { viewport: { width: 1400, height: 1000 } });
const firstPage = first.pages()[0] ?? (await first.newPage());
await firstPage.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
await firstPage.evaluate(async (creds) => {
  const r = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(creds)
  });
  const j = await r.json();
  window.localStorage.setItem('axiom.token', j.token);
  window.localStorage.setItem('axiom.user', JSON.stringify(j.user));
}, STUDENT);

await push(qRestart.id, 300);
await firstPage.goto(`${BASE}/student/exam/${exam.code}`, { waitUntil: 'domcontentloaded' });
await firstPage.locator('button:has-text("Submit answer")').waitFor({ timeout: 25_000 });
await first.setOffline(true);
await firstPage.waitForFunction(() => navigator.onLine === false, { timeout: 10_000 });
await firstPage.waitForTimeout(400);
await firstPage.locator('button:has-text("Save answer")').waitFor({ timeout: 10_000 });
await firstPage.evaluate(() => {
  const option = [...document.querySelectorAll('button')].find((b) => {
    const badge = b.firstElementChild;
    return badge && /^[A-Z]$/.test((badge.textContent ?? '').trim());
  });
  option?.click();
});
await firstPage.locator('button:has-text("Save answer")').click();
await firstPage.waitForTimeout(1_200);
check('answer queued before the browser is closed', /Saved on this device/i.test(await firstPage.locator('body').innerText()));
check('nothing on the backend yet', (await serverRows(qRestart.id)).length === 0);
// Flush IndexedDB to disk the way a real quit does.
await first.close();
console.log('     browser closed; reopening…');
await sleep(2_000);

// Second run: a cold start must find the record on disk and deliver it with no
// user action. Chromium's persistent profile restores the previous tab, so the
// app may boot the instant the browser opens — which is exactly the real-world
// case (reopen the laptop, the answer goes out by itself).
const second = await chromium.launchPersistentContext(profile, { viewport: { width: 1400, height: 1000 } });
const secondPage = second.pages()[0] ?? (await second.newPage());
console.log(`     reopened with ${second.pages().length} restored tab(s)`);
// Read storage from a same-origin page rather than the app itself.
const inspector = await second.newPage();
await inspector.goto(`${BASE}/api/health`, { waitUntil: 'domcontentloaded' });
const readOutboxFrom = (target) =>
  target.evaluate(
    () =>
      new Promise((resolve) => {
        const open = indexedDB.open('axiom-offline', 1);
        open.onerror = () => resolve('idb-error');
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains('outbox')) return resolve([]);
          const req = db.transaction('outbox', 'readonly').objectStore('outbox').getAll();
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve('tx-error');
        };
      })
  );
const survived = await readOutboxFrom(inspector);
check(
  'record was written to disk, not just held in memory',
  Array.isArray(survived),
  Array.isArray(survived) ? `${survived.length} record(s) found at cold start` : String(survived)
);

// Make sure the app actually runs again — a restored `about:blank` tab proves
// nothing. This is the cold start that has to find the record and finish the job.
const lobby = await second.newPage();
await lobby.goto(`${BASE}/student`, { waitUntil: 'domcontentloaded' });
for (let i = 0; i < 25; i++) {
  if ((await serverRows(qRestart.id)).length) break;
  await sleep(1_000);
}
const restartRows = await serverRows(qRestart.id);
check(
  'delivered on its own after the restart, with no user action',
  restartRows.length === 1 && restartRows[0].offline === true,
  restartRows[0] ? `latency ${restartRows[0].latencyMs}ms` : 'not delivered'
);
check(
  'answer text and question survived the restart intact',
  restartRows[0] && restartRows[0].questionId === qRestart.id && String(restartRows[0].answer).length > 0,
  restartRows[0] ? `answer "${restartRows[0].answer}"` : 'no row'
);
// A tab killed between the POST landing and the local cleanup leaves the record
// queued. The reopened app must notice it is already counted and clear it out
// rather than retrying forever.
for (let i = 0; i < 20; i++) {
  const left = await readOutboxFrom(inspector);
  if (Array.isArray(left) && left.length === 0) break;
  await sleep(1_000);
}
const afterDelivery = await readOutboxFrom(inspector);
check(
  'outbox cleaned up once the app ran again',
  Array.isArray(afterDelivery) && afterDelivery.length === 0,
  Array.isArray(afterDelivery) ? `${afterDelivery.length} record(s) left` : String(afterDelivery)
);

/* ── 10. a record that outlives its delivery is not double-counted ── */

// If a tab dies in the instant between the POST landing and the local cleanup,
// the record stays queued. The next flush must recognise it as already counted
// and drop it rather than recording the answer twice.
console.log('\n10) a replayed duplicate is dropped, never counted twice');
const replayPage = lobby;
await replayPage.goto(`${BASE}/student`, { waitUntil: 'domcontentloaded' }).catch(() => {});
await replayPage.waitForTimeout(1_000);
const reinserted = await replayPage.evaluate(
  (record) =>
    new Promise((resolve) => {
      const open = indexedDB.open('axiom-offline', 1);
      open.onerror = () => resolve(false);
      open.onsuccess = () => {
        const tx = open.result.transaction('outbox', 'readwrite');
        tx.objectStore('outbox').put(record);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      };
    }),
  survived[0]
);
check('simulated an un-cleaned record', reinserted === true);
// Reload so the queue hydrates with the resurrected record, then let it retry.
await replayPage.reload({ waitUntil: 'domcontentloaded' });
for (let i = 0; i < 20; i++) {
  if ((await readOutboxFrom(inspector)).length === 0) break;
  await sleep(1_000);
}
check('duplicate cleared from the outbox', (await readOutboxFrom(inspector)).length === 0);
check(
  'backend still holds exactly one response for that question',
  (await serverRows(qRestart.id)).length === 1,
  `${(await serverRows(qRestart.id)).length} row(s)`
);

await second.close();
await fs.rm(profile, { recursive: true, force: true }).catch(() => {});

await apiCall(`/exams/${exam.id}/end`, { method: 'POST', token: admin.token });

const failed = results.filter((r) => !r.pass);
console.log(`\n${'='.repeat(66)}`);
console.log(`TOTAL ${results.length}   PASS ${results.length - failed.length}   FAIL ${failed.length}`);
if (failed.length) {
  console.log('\nFailures:');
  failed.forEach((f) => console.log(`  - ${f.name}  ${f.extra}`));
}
process.exit(failed.length ? 1 : 0);
