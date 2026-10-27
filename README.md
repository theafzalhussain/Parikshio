# ⬢ Axiom Live — real-time educational testing platform

A production-shaped implementation of the brief: **RBAC (Admin / Student), question bank across 5 formats, per-question timers, real-time pushing, timestamped answers, speed-aware ranking, automated grading and institute analytics.**

Stack: **Next.js 14 + TypeScript + Tailwind CSS** · **Node.js + Express** · **MongoDB** · **Redis** · **Socket.io**

---

## 1. Run it

```bash
npm install
npm run dev          # http://localhost:3000
```

That is enough — the server boots with a seeded demo: 19 hand-written + 7 paper-imported questions, 3 sessions, 8 students and a live session in progress.

### Demo logins

| Role | Email | Password |
| --- | --- | --- |
| Admin (faculty) | `admin@axiom.edu` | `admin123` |
| Admin (2nd faculty) | `faculty@axiom.edu` | `admin123` |
| Student | `aarav@axiom.edu` | `student123` |
| Student | any of `zoya@ / rohan@ / ananya@ / kabir@ / diya@ / ishaan@ / vivaan@axiom.edu` | `student123` |

Live session join code: **`QM4LIVE`** (Quantum Foundations) · **`DSA2026`** (Data Structures) · `APTSETA` (ended, for results view).

### Optional infrastructure

```bash
cp .env.example .env
docker compose up -d            # MongoDB + Redis
# then in .env
MONGODB_URI=mongodb://127.0.0.1:27017/axiom_live
REDIS_URL=redis://127.0.0.1:6379
```

Without these the platform runs in **ephemeral engine mode** (in-memory store + in-memory cache) with identical behaviour — handy for demos, CI and sandboxes.

### Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Express + Socket.io + Next dev server (one process, one port) |
| `npm run build` / `npm start` | Production build & run |
| `npm run typecheck` | Strict TypeScript check across client, server and shared code |

---

## 2. Where the requirements live

| Requirement | Implementation |
| --- | --- |
| RBAC for Admin / Student | `server/auth.ts` — JWT + `requireRole()` on every route; socket handshake auth + per-role rooms in `server/index.ts` |
| Question bank, 5 formats | `src/app/admin/questions/page.tsx`, `POST/PATCH/DELETE /api/questions`, type-aware validation |
| MCQ, true/false, fill-in-the-blank, short, long | `QuestionType` in `shared/types.ts`; renderers per type on the student device |
| Manual timer per question | `timerSeconds` stored per question; overridable at push time in the control room (`POST /api/exams/:id/push`) |
| Real-time question pushing | `pushQuestion()` → Socket.io `question:pushed` to the exam room |
| Real-time notifications | Toasts on `question:pushed`, 10-second warning, lock and end events |
| Synchronised live timer | Server-authoritative `endsAt`; `time:sync` broadcast every 10 s → client offset correction (`useServerClock`) |
| Intuitive answer inputs | Option buttons (MCQ/T-F), single-line input (fill), textarea (short/long) |
| Real-time capture + timestamp + ranking | `submitAnswer()` stores `submittedAt` + `latencyMs`; `rankResponses()` ranks by points → correct count → average latency |
| Automated grading (objective) | `gradeAnswer()` in `shared/grade.ts` — index match for MCQ/T-F, normalised + typo-tolerant matching for fill/short |
| Manual review for long answers | Responses without keys land as `pending`; one-tap scoring in the control room (`POST /api/responses/:id/grade`) |
| Institute analytics | `analytics()` + `/admin/analytics/[id]` — accuracy, completion, avg score, per-question diagnostics, option distribution, latency histogram, format strength, CSV export |
| **Paper upload → question extraction** | `POST /api/papers/upload` (PDF / DOCX / image / text) → `server/files.ts` (pdfjs line rebuild, mammoth, Tesseract OCR) → `server/extract.ts` (parser) → every question stored with `sourcePaperId` |
| **Per-question controls in the panel** | Each row carries inline **timer**, **Push**, **Edit**, **Delete** — on the paper workbench (`/admin/papers/[id]`) and in the question bank |
| Redis caching | `server/cache.ts` — leaderboard + analytics cached with TTL, prefix invalidation on every mutation |
| MongoDB | `server/mongo.ts` — write-through mirror + hydrate on boot |

---

## 3. Upload your own question paper (PDF · Word · photo)

**Admin → Question papers** (`/admin/papers`)

1. **Drop a file** — `.pdf`, `.docx`, `.png/.jpg` (scans/photos, OCR runs automatically), `.txt/.md`, or use the **Paste text** tab. Max 20 MB.
2. The server reads the text, then the parser detects:
   * numbered questions (`1.` / `1)` / `Q1.` / `Q.1`), multi-line prompts and wrapped sentences
   * options on separate lines (`A) … B) …`) **or** inline (`A) x B) y C) z`), plus roman numerals
   * **marks** (`[4 marks]`, `(4)`, `4 marks`) → question points, and a timer estimate from type + marks (editable)
   * **blanks** (`______`) → fill-in-the-blank, `true/false` wording → true/false, `derive/explain` + marks → long answer
   * **answer keys** — inline `Ans: B` **or** one global `Answer Key: 1-B, 2-C, 3-True, 4-HAVING` block
3. Every question is imported into your panel with `sourcePaperId`, `sourcePaperName` and `sourceIndex` (paper order), plus a **confidence** score and parser notes.
4. Open the **paper workbench**: all questions of that paper in order, each with **timer field · Push · Edit · Delete**, a **bulk timer** applier, "key missing" warnings and a **Publish session** button that creates one exam containing the whole paper.
5. Push any question straight from the paper, the workbench or the question bank — the target session is picked in the push dialog and the timer can be overridden per push.

Try it with the seeded paper *"Unit Test 2 — Cell Biology"* (7 questions, keys merged) or the **Load example** button on the Paste-text tab.

**Parsing tips that make extraction near-perfect:** number every question, keep each option on its own line, put marks in brackets, and keep the key either after each question or in one `Answer Key:` block at the end.

### Paper endpoints

```
POST   /api/papers/upload          multipart file → questions (imports automatically)
POST   /api/papers/text            { name, subject, text } → questions
GET    /api/papers                 library with question counts + session link
GET    /api/papers/:id             paper + its questions (paper order) + exam
DELETE /api/papers/:id             removes paper + its questions (blocked if a session uses it)
POST   /api/papers/:id/exam        publish the whole paper as one session (idempotent)
GET    /api/questions?paper=<id>   bank filtered to one paper
POST   /api/exams/:id/questions    attach an existing question to a session (used by the push dialog)
```

---

## 4. Architecture

```
Browser (Next.js App Router, RSC + client components)
   │  fetch /api/*  (JWT bearer)          │  WebSocket (Socket.io)
   ▼                                      ▼
Express  ──────────────  shared domain  ──────────────  Socket.io rooms
   │                        (types, grading)              exam:<CODE>
   ├── in-memory hot path (O(1) during a live exam)        exam:<CODE>:staff
   ├── Redis  → leaderboard / analytics cache, invalidated on write
   └── MongoDB → durable mirror, hydrated back on boot
```

Design decisions worth knowing:

* **One process, one port.** `server/index.ts` mounts Express and hands the rest to Next's request handler, so the API, the socket server and the UI share `:3000` (no CORS, no proxy hop).
* **Server owns the clock.** The deadline is `endsAt` computed on the server; devices only render `endsAt - serverNow`. `time:sync` every 10 s plus a 1.5 s grace window removes drift and network-jitter edge cases.
* **Answer keys never leave the server.** `sanitizeQuestion()` strips `correctOptionIndex` / `acceptedAnswers` before anything is emitted to a student socket or API response.
* **Grades unlock at lock time.** While a question is live a student sees `pending`; the real grade is exposed once the question locks, so a slow student cannot copy a verdict.
* **Cache is a speed layer, not a source of truth.** Every mutation calls `cache.delPrefix('axiom:exam:<id>:')`; a Redis outage degrades to recomputation, never to stale results.

### REST surface (abridged)

```
POST   /api/auth/login | /register | GET /api/auth/me | /api/auth/demo
GET    /api/admin/overview
GET    /api/questions            POST /api/questions
PATCH  /api/questions/:id        DELETE /api/questions/:id
GET    /api/exams                POST /api/exams
GET    /api/exams/:id            POST /api/exams/:id/push | /lock | /end
GET    /api/exams/:id/analytics  GET /api/exams/:id/leaderboard
POST   /api/responses/:id/grade
GET    /api/student/exams | /student/history
POST   /api/student/join         POST /api/student/answers
GET    /api/student/exams/:id | /student/exams/by-code/:code
GET    /api/health
```

### Socket contracts (`shared/types.ts`)

Server → client: `exam:state`, `question:pushed`, `question:locked`, `exam:ended`, `leaderboard:update`, `response:new` (staff only), `time:sync`, `notice`
Client → server: `join:exam`, `time:sync:request`

---

## 5. Try the real-time loop in 60 seconds

0. Sign in as **admin** → *Question papers* → upload a PDF/Word/photo of your own paper (or hit **Load example**) — all its questions appear in the panel with timer + push + edit.
1. Sign in as **admin** → *Question bank* → add a question (any format, set its timer).
2. *Live sessions* → open **QM4LIVE** → adjust a timer in the queue → **Push**.
3. In a second browser (incognito) sign in as **aarav@axiom.edu** → lobby → **QM4LIVE**.
4. Answer as the timer runs: the admin feed updates instantly with latency + grade; the leaderboard re-ranks by accuracy then speed.
5. Push a **long answer** question — it lands in the review queue; score it from the feed and watch the leaderboard change.
6. Open **Analytics** for the same session: per-question accuracy, option distribution, latency histogram, CSV export.

---

## 6. Production notes

* Set `JWT_SECRET`, `MONGODB_URI`, `REDIS_URL`; run `npm run build && npm start`.
* Horizontal scale: run N app instances behind a load balancer with a **Socket.io Redis adapter** (`@socket.io/redis-adapter`) so rooms span instances — the cache layer already speaks Redis.
* The in-memory hot path is single-process by design (seed data + live exam state). For multi-instance deployments move `store` reads to Mongo/Redis behind the same `db.*` interface — the call sites are already isolated in `server/store.ts`.
* Hardening checklist: rate-limit `/api/auth/*`, add refresh tokens, audit-log `push`/`grade` actions, and lock CORS to your institute domain.

---

## 7. Project map

```
server/         config, auth, store, mongo, cache, engine (push/lock/submit/analytics), api, seed, socket
                extract.ts  → question-paper parser (blocks, options, marks, keys, types)
                files.ts    → PDF (pdfjs, pdf-parse fallback) · DOCX (mammoth) · OCR (tesseract.js)
shared/         types.ts (domain + socket contracts), grade.ts (grading, ranking, stats)
src/app/        /  /login  /admin  /admin/questions  /admin/exams  /admin/exams/[id]
                /admin/papers  /admin/papers/[id]  /admin/analytics  /admin/analytics/[id]
                /student  /student/exam/[code]
src/components/ AdminShell, StudentShell, Leaderboard, ui/*, charts/*, landing/*
src/lib/        api client, auth provider, socket hooks (status, server clock, animation)
```

Question papers: upload PDF / Word / photo in *Question papers*; the parser (`server/extract.ts`) rebuilds questions, options, marks and answer keys, and every imported item keeps a link back to its paper (`/admin/papers/[id]`) with timer · push · edit · delete per question.

UI notes: single dark "control-room" system — ink `#05060A` base, aurora violet for admin actions, lime for the live/success path, ember for expiry, tabular numerals for every metric, gradient hairlines instead of borders, and reduced-motion respected. Fonts are system stacks so the build has **zero external requests** (works fully offline / in sandboxed previews).
