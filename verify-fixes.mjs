/**
 * Throwaway verification of the backend hardening.
 * Run with: node verify-fixes.mjs   (dev server must be on :3000)
 */
import { io } from 'socket.io-client';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const results = [];
const ok = (name, pass, extra = '') => {
  results.push({ name, pass, extra });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${extra ? `  — ${extra}` : ''}`);
};

async function req(method, path, { body, token } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON body */
  }
  return { status: res.status, json, text };
}

const admin = await req('POST', '/api/auth/login', {
  body: { email: 'admin@axiom.edu', password: 'admin123' }
});
const AT = admin.json.token;
const student = await req('POST', '/api/auth/login', {
  body: { email: 'aarav@axiom.edu', password: 'student123' }
});
const ST = student.json.token;
console.log(`admin+student logged in (${admin.status}/${student.status})`);

// ── 0. Public signup cannot grant faculty privileges ──
console.log('\n0) public registration cannot create an admin');
const adminSignup = await req('POST', '/api/auth/register', {
  body: {
    name: 'Untrusted Faculty',
    email: `admin-escalation-${Date.now()}@example.test`,
    password: 'SafePass123',
    role: 'admin'
  }
});
ok('admin role request rejected', adminSignup.status === 403, `HTTP ${adminSignup.status}`);

// ── 1. PATCH no longer wipes the fields it was not given ──
console.log('\n1) partial PATCH keeps the answer key');
const made = await req('POST', '/api/questions', {
  token: AT,
  body: { type: 'mcq', prompt: 'Verify: capital of France?', options: ['Lyon', 'Paris'], correctOptionIndex: 1, points: 2, timerSeconds: 30 }
});
const qid = made.json.question.id;
const patched = await req('PATCH', `/api/questions/${qid}`, { token: AT, body: { points: 5 } });
const q = patched.json.question ?? {};
ok('prompt survived', q.prompt === 'Verify: capital of France?', String(q.prompt));
ok('options survived', Array.isArray(q.options) && q.options.length === 2, JSON.stringify(q.options));
ok('answer key survived', q.correctOptionIndex === 1, String(q.correctOptionIndex));
ok('type survived', q.type === 'mcq', String(q.type));
ok('points actually changed', q.points === 5, String(q.points));

// ── 2. Non-numeric / out-of-range question fields are rejected ──
console.log('\n2) numeric validation');
const bad = [
  ['points="abc"', { type: 'mcq', prompt: 'x', options: ['a', 'b'], correctOptionIndex: 0, points: 'abc', timerSeconds: 30 }],
  ['timerSeconds="xyz"', { type: 'mcq', prompt: 'x', options: ['a', 'b'], correctOptionIndex: 0, points: 1, timerSeconds: 'xyz' }],
  ['correctOptionIndex=-1', { type: 'mcq', prompt: 'x', options: ['a', 'b'], correctOptionIndex: -1, points: 1, timerSeconds: 30 }],
  ['correctOptionIndex=1.5', { type: 'mcq', prompt: 'x', options: ['a', 'b'], correctOptionIndex: 1.5, points: 1, timerSeconds: 30 }],
  ['truefalse index=5', { type: 'truefalse', prompt: 'x', correctOptionIndex: 5, points: 1, timerSeconds: 30 }],
  ['points=0', { type: 'mcq', prompt: 'x', options: ['a', 'b'], correctOptionIndex: 0, points: 0, timerSeconds: 30 }],
  ['timer=4s', { type: 'mcq', prompt: 'x', options: ['a', 'b'], correctOptionIndex: 0, points: 1, timerSeconds: 4 }]
];
for (const [label, body] of bad) {
  const r = await req('POST', '/api/questions', { token: AT, body });
  ok(`rejected ${label}`, r.status === 400, `HTTP ${r.status} ${r.json?.error ?? ''}`.slice(0, 70));
}
const good = await req('POST', '/api/questions', {
  token: AT,
  body: { type: 'truefalse', prompt: 'Verify: water boils at 100C at sea level', correctOptionIndex: 0, points: 1, timerSeconds: 30 }
});
ok('valid question still accepted', good.status === 201, `HTTP ${good.status}`);

// ── 3. Admin-only leaderboard route ──
console.log('\n3) leaderboard route is admin-only');
const exams = (await req('GET', '/api/exams', { token: AT })).json.exams;
const exId = exams[0].id;
const asStudent = await req('GET', `/api/exams/${exId}/leaderboard`, { token: ST });
ok('student gets 403', asStudent.status === 403, `HTTP ${asStudent.status}`);
const asAdmin = await req('GET', `/api/exams/${exId}/leaderboard`, { token: AT });
ok('admin still gets 200', asAdmin.status === 200, `HTTP ${asAdmin.status}`);

// ── 4. Session token is no longer accepted from the query string ──
console.log('\n4) query-string session token rejected');
const viaQuery = await req('GET', `/api/auth/me?token=${encodeURIComponent(AT)}`);
ok('?token= gives 401', viaQuery.status === 401, `HTTP ${viaQuery.status}`);
const viaHeader = await req('GET', '/api/auth/me', { token: AT });
ok('Authorization header still works', viaHeader.status === 200, `HTTP ${viaHeader.status}`);

// ── 5. Manual grade validation ──
console.log('\n5) manual grade validation');
// Find an exam that actually has responses to grade.
let anyResponse = null;
for (const ex of exams) {
  const detail = (await req('GET', `/api/exams/${ex.id}`, { token: AT })).json;
  const found = detail?.responses?.find((r) => (detail.questions ?? []).some((q) => q?.id === r.questionId));
  if (found) {
    anyResponse = found;
    break;
  }
}
if (anyResponse) {
  const nan = await req('POST', `/api/responses/${anyResponse.id}/grade`, { token: AT, body: { awarded: 'abc' } });
  ok('rejects awarded="abc"', nan.status === 400, `HTTP ${nan.status}`);
  const over = await req('POST', `/api/responses/${anyResponse.id}/grade`, { token: AT, body: { awarded: 999 } });
  ok('rejects more than the question is worth', over.status === 400, `HTTP ${over.status} ${over.json?.error ?? ''}`.slice(0, 60));
} else {
  ok('responses available to grade', false, 'no response found to test against');
}

// ── 6. Audit limit cap ──
console.log('\n6) audit limit cap');
const auditNaN = await req('GET', '/api/admin/audit?limit=abc', { token: AT });
const auditBig = await req('GET', '/api/admin/audit?limit=99999', { token: AT });
ok('limit=abc falls back to 100', (auditNaN.json?.entries?.length ?? 0) <= 100, String(auditNaN.json?.entries?.length));
ok('limit=99999 capped at 500', (auditBig.json?.entries?.length ?? 0) <= 500, String(auditBig.json?.entries?.length));

// ── 7. Push timer validation ──
console.log('\n7) push timer validation');
const newExam = (await req('POST', '/api/exams', {
  token: AT,
  body: { title: 'QA harness — safe to delete', subject: 'QA', questionIds: [qid] }
})).json.exam;
ok('harness exam created', Boolean(newExam?.id), String(newExam?.code));
await req('POST', `/api/exams/${newExam.id}/questions`, { token: AT, body: { questionId: qid } });
const badPush = await req('POST', `/api/exams/${newExam.id}/push`, { token: AT, body: { questionId: qid, timerSeconds: 'abc' } });
ok('rejects timerSeconds="abc"', badPush.status === 400, `HTTP ${badPush.status}`);

// ── 8. A student cannot join the staff room by claiming role:'admin' ──
console.log('\n8) socket role escalation closed');
const studentSocket = io(BASE, { auth: { token: ST }, transports: ['websocket'] });
const staffLeak = [];
studentSocket.on('response:new', (p) => staffLeak.push(p));
await new Promise((resolve, reject) => {
  studentSocket.on('connect', resolve);
  studentSocket.on('connect_error', reject);
  setTimeout(() => reject(new Error('socket connect timeout')), 10000);
});
studentSocket.emit('join:exam', { examCode: newExam.code, role: 'admin' });
await new Promise((r) => setTimeout(r, 800));

// Push a 6-second question, then answer it as that same student.
const pushed = await req('POST', `/api/exams/${newExam.id}/push`, { token: AT, body: { questionId: qid, timerSeconds: 6 } });
ok('question pushed', pushed.status === 200, `HTTP ${pushed.status}`);
studentSocket.emit('join:exam', { examCode: newExam.code, role: 'student' });
const adminSocket = io(BASE, { auth: { token: AT }, transports: ['websocket'] });
const tabHiddenEvents = [];
adminSocket.on('student:tab-hidden', (event) => tabHiddenEvents.push(event));
await new Promise((resolve, reject) => {
  if (adminSocket.connected) return resolve();
  adminSocket.on('connect', resolve);
  adminSocket.on('connect_error', reject);
  setTimeout(() => reject(new Error('admin socket connect timeout')), 10000);
});
adminSocket.emit('join:exam', { examCode: newExam.code, role: 'admin' });
await new Promise((r) => setTimeout(r, 300));
studentSocket.emit('student:tab-hidden', { examCode: newExam.code, studentId: 'spoofed-id' });
await new Promise((r) => setTimeout(r, 300));
ok(
  'tab-hidden alert includes authenticated student identity',
  tabHiddenEvents.length === 1 && tabHiddenEvents[0].studentId === student.json.user.id,
  `${tabHiddenEvents.length} event(s); ID ${tabHiddenEvents[0]?.studentId ?? 'missing'}`
);
ok('tab-hidden alert carries the correct exam', tabHiddenEvents[0]?.examId === newExam.id);
adminSocket.emit('student:tab-hidden', { examCode: newExam.code });
await new Promise((r) => setTimeout(r, 300));
ok('admin cannot forge a student tab-hidden event', tabHiddenEvents.length === 1, `${tabHiddenEvents.length} event(s)`);
adminSocket.disconnect();
const pushedAt = Date.now();
const submitted = await req('POST', '/api/student/answers', { token: ST, body: { examId: newExam.id, questionId: qid, answer: '1' } });
ok('student answer accepted', submitted.status === 200, `HTTP ${submitted.status} ${submitted.json?.error ?? ''}`);
ok('own grade masked while question is open', submitted.json?.response?.grade === 'pending', String(submitted.json?.response?.grade));
await new Promise((r) => setTimeout(r, 1200));
ok(
  'student received no staff response:new events',
  staffLeak.length === 0,
  `${staffLeak.length} leaked event(s)`
);

// ── 9. The grace window is actually honoured ──
console.log('\n9) grace window honoured at the buzzer');
// Use the server's own deadline from the push response — the local `pushedAt`
// above is captured several socket round-trips later, so it under-reports the
// window and makes a submit inside grace look late.
const endsAt = pushed.json?.active?.endsAt ?? pushedAt + 6000;
const waitMs = endsAt + 400 - Date.now(); // 400ms past the deadline, inside the 1500ms grace
if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
const student2 = await req('POST', '/api/auth/register', {
  body: { name: 'Grace Tester', email: `grace-${Date.now()}@axiom.edu`, password: 'GracePass1', role: 'student', org: 'Axiom Institute' }
});
const lateSubmit = await req('POST', '/api/student/answers', {
  token: student2.json.token,
  body: { examId: newExam.id, questionId: qid, answer: '1' }
});
const overshoot = Date.now() - endsAt;
ok(
  `submission ${overshoot}ms past the deadline still accepted`,
  lateSubmit.status === 200,
  `HTTP ${lateSubmit.status} ${lateSubmit.json?.error ?? ''}`
);

// Well past the grace window it must be refused.
await new Promise((r) => setTimeout(r, 2000));
const student3 = await req('POST', '/api/auth/register', {
  body: { name: 'Too Late', email: `late-${Date.now()}@axiom.edu`, password: 'LatePass1', role: 'student', org: 'Axiom Institute' }
});
const tooLate = await req('POST', '/api/student/answers', {
  token: student3.json.token,
  body: { examId: newExam.id, questionId: qid, answer: '1' }
});
ok('submission well past grace refused', tooLate.status === 409, `HTTP ${tooLate.status} ${tooLate.json?.error ?? ''}`.slice(0, 70));

// ── 10. Pushing while a question is live locks the old one instead of abandoning it ──
console.log('\n10) push closes the outgoing question');
const q2 = (await req('POST', '/api/questions', {
  token: AT,
  body: { type: 'truefalse', prompt: 'Verify: second question', correctOptionIndex: 0, points: 1, timerSeconds: 60 }
})).json.question;
await req('POST', `/api/exams/${newExam.id}/questions`, { token: AT, body: { questionId: q2.id } });
await req('POST', `/api/exams/${newExam.id}/push`, { token: AT, body: { questionId: qid, timerSeconds: 600 } });
await req('POST', `/api/exams/${newExam.id}/push`, { token: AT, body: { questionId: q2.id, timerSeconds: 60 } });
const state = (await req('GET', `/api/exams/${newExam.id}`, { token: AT })).json;
ok('current question is the newest one', state?.exam?.current?.questionId === q2.id, String(state?.exam?.current?.questionId));
const clockTester = await req('POST', '/api/auth/register', {
  body: { name: 'Clock Tester', email: `clock-${Date.now()}@axiom.edu`, password: 'ClockPass1', role: 'student' }
});
const spoofedTimeSubmit = await req('POST', '/api/student/answers', {
  token: clockTester.json.token,
  body: {
    examId: newExam.id,
    questionId: q2.id,
    answer: '0',
    offline: true,
    clientSubmittedAt: state.exam.current.pushedAt - 60_000
  }
});
ok(
  'offline client timestamp cannot improve latency score',
  spoofedTimeSubmit.status === 200 &&
    spoofedTimeSubmit.json?.response?.latencyMs ===
      spoofedTimeSubmit.json?.response?.submittedAt - state.exam.current.pushedAt,
  `HTTP ${spoofedTimeSubmit.status}, latency ${spoofedTimeSubmit.json?.response?.latencyMs ?? 'n/a'}ms`
);

// ── 11. A finished exam cannot be reopened by pushing ──
console.log('\n11) ended exam rejects a push');
await req('POST', `/api/exams/${newExam.id}/end`, { token: AT });
const afterEnd = await req('POST', `/api/exams/${newExam.id}/push`, { token: AT, body: { questionId: qid, timerSeconds: 30 } });
ok('push after end refused', afterEnd.status === 400, `HTTP ${afterEnd.status} ${afterEnd.json?.error ?? ''}`.slice(0, 60));
const ended = (await req('GET', `/api/exams/${newExam.id}`, { token: AT })).json;
ok('exam stayed ended', ended?.exam?.status === 'ended', String(ended?.exam?.status));

studentSocket.close();

// ── cleanup ──
// The questions can go, but there is no DELETE /exams/:id in the API, so the
// harness exam stays behind (ended, and named so it is obvious).
for (const id of [qid, q2.id, good.json?.question?.id].filter(Boolean)) {
  const del = await req('DELETE', `/api/questions/${id}`, { token: AT });
  if (del.status !== 200) console.log(`  (left question ${id} behind: HTTP ${del.status})`);
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${'='.repeat(60)}`);
console.log(`TOTAL ${results.length}  PASS ${results.length - failed.length}  FAIL ${failed.length}`);
if (failed.length) {
  console.log('\nFailures:');
  failed.forEach((f) => console.log(`  - ${f.name}  ${f.extra}`));
}
process.exit(failed.length ? 1 : 0);
