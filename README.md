# ⬢ Parikshio

> Live exams for universities, schools and coaching institutes: author
> questions, run timed live sessions, capture answers as they arrive, and turn
> them into actionable analytics.

**Parikshio** ([parikshio.tech](https://parikshio.tech)) is a production-shaped
educational testing platform for faculty and students. It combines an admin
control room with a focused student experience and a server-authoritative
real-time assessment engine. The name comes from परीक्षा (*pariksha*), the
Hindi word for an examination.

Stack: **Next.js 14 + TypeScript + Tailwind CSS** · **Node.js + Express** · **MongoDB** · **Redis** · **Socket.io**

> **Naming note:** a few internal identifiers keep the project's original
> codename on purpose: the npm package name, browser storage keys (`axiom.token`,
> `axiom.user`, IndexedDB `axiom-offline`), the Redis prefix `axiom:*`, Mongoose
> model names, the Render service `axiom-api` and the `@axiom.edu` demo
> accounts. Renaming them would sign every user out, orphan stored data or
> break the deploy, and none of them is visible to users.

## Contents

- [Run it](#1-run-it)
- [What it includes](#2-what-it-includes)
- [Upload a question paper](#3-upload-your-own-question-paper-pdf--word--photo)
- [Architecture](#4-architecture)
- [Try the real-time loop](#5-try-the-real-time-loop-in-60-seconds)
- [Production notes](#6-production-notes)
- [Project map](#7-project-map)

---

## 1. Run it

```bash
npm install
npm run dev          # http://localhost:3000
```

That is enough — in development, the server boots with a seeded demo: 19 hand-written + 7 paper-imported questions, 3 sessions, 8 students and a live session in progress. Production never seeds demo accounts or assessment data.

### Demo logins

These accounts are development-only and are not created in production. Production login, Google linking, and public signup also reject these reserved demo email addresses, including when a database was seeded by an older development deployment.

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

## 2. What it includes

The current implementation covers the complete author → deliver → grade →
analyse workflow:

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
| Automated grading (objective) | `gradeAnswer()` in `shared/grade.ts` — index match for MCQ/T-F, normalised + typo-tolerant matching for fill |
| **AI grading (subjective)** | `server/grading.ts` + `server/gemini.ts` — Short/Long answers are queued on submission, batched per question (10 answers per Gemini request, each scored independently), scored against the model answer / key points (partial credit, feedback, confidence), and pushed to the control room over `response:graded`. Rate limits are waited out; a used-up daily quota is reported to the teacher instead of failing silently |
| Manual review / override | Any score can be overridden in the control room (`POST /api/responses/:id/grade`); low-confidence or manipulative AI results are flagged for review |
| Institute analytics | `analytics()` + `/admin/analytics/[id]` — accuracy, completion, avg score, per-question diagnostics, option distribution, latency histogram, format strength, CSV export |
| **Paper upload → question extraction** | `POST /api/papers/upload` (PDF / DOCX / image / text) → `server/files.ts` (pdfjs line rebuild, mammoth, Tesseract OCR) → `server/extract.ts` (parser) → every question stored with `sourcePaperId` |
| **Per-question controls in the panel** | Each row carries inline **timer**, **Push**, **Edit**, **Delete** — on the paper workbench (`/admin/papers/[id]`) and in the question bank |
| **Bulk push · self-paced sets** | Tick several questions (control room, question bank or paper workbench) → **Push together** with one shared timer or one per question (`POST /api/exams/:id/push-set`). Every student sees the list and picks the order; a question's timer starts only when that student opens it (`POST /api/student/sets/open`), one at a time. On submit or timeout the next open question is offered (optional auto-start). A timed-out or skipped question stays closed for that student until faculty re-opens it (`POST /api/exams/:id/set/repush`); faculty can close the whole set (`POST /api/exams/:id/set/close`). Per-student deadlines live in `store.attempts` (mirrored to MongoDB) and are enforced in `submitAnswer()` |
| Bulk question management | `POST /api/questions/bulk-update` (timer / points / difficulty / topic for many questions, each re-validated) and `POST /api/questions/bulk-delete` (questions attached to a session are kept and reported); `POST /api/exams/:id/questions/remove` detaches questions that have no answers yet |
| Session settings | `PATCH /api/exams/:id` — rename, show/hide the student leaderboard, reveal the answer key + explanations after the session ends, default options for question sets. **Edit** opens the same dialog from Live sessions, Analytics and the control room |
| Delete sessions | `DELETE /api/exams/:id` and `POST /api/exams/bulk-delete { ids }` remove a session with its answers, set timers, cached views and queued AI grading (questions stay in the bank; a paper published as that session can be published again). Students in the room get `exam:removed` and return to their lobby. Live sessions and Analytics both have per-card delete and multi-select bulk delete, with a confirmation that lists the answers being removed |
| Student review & insights | After a session ends each student gets a question-by-question review (answer key only when faculty allows it); `GET /api/student/insights` powers accuracy by format and topic, strongest / weakest topic and best streak in the lobby |
| Redis caching | `server/cache.ts` — leaderboard + analytics cached with TTL, prefix invalidation on every mutation |
| MongoDB | `server/mongo.ts` — write-through mirror + hydrate on boot |
| Google Classroom | Teacher OAuth, roster-to-account email matching, exam course mapping and score publishing from the admin control room |
| Role-based log in | `/login` and `/signup` each carry a **Student · Faculty & admin** switch (`?role=faculty` opens the faculty tab, `?next=/student/...` returns the user to where they were). Students sign up themselves; the faculty tab explains that faculty accounts are created on request, and Google sign-in on that tab never creates an account (`mode: 'signin'` → 404 `auth/no-account`) |
| Contact & feedback | `/contact` (`?topic=general · feedback · problem · faculty · onboarding`) → `POST /api/contact`. Each message is emailed to `CONTACT_INBOX_EMAIL` (default `support@parikshio.tech`) through Brevo with the sender as reply-to, the sender gets a "we received your message" email with a copy and a reference (`PKS-…`, reply-to the team inbox, at most 3 per address per day), and the message is stored in the `contact_messages` collection with `delivered` / `confirmationSent` flags. Throttled per IP (10 / 15 min) and per email (3 / 15 min); a hidden honeypot field drops bots |
| Branded email | `server/email.ts` — the password reset, the team notification and the sender's confirmation share one table-based, inline-styled frame (midnight header, gold "P" monogram, no remote images) with a plain-text part. Sent from `BREVO_SENDER_EMAIL` (`support@parikshio.tech`); `emailFromEnv()` in `server/config.ts` also accepts values pasted as `=support@…`, `"support@…"` or `Name <support@…>` and logs a warning. The address shown on the site and in every `mailto:` link is `CONTACT_EMAIL` in `src/lib/site.ts` |
| Student dashboard | Level, progress ring, badges and best streak are worked out in the browser from the student's real answers (`src/lib/progress.ts`, `GET /api/student/history` + `/insights`); no extra database fields. 3D depth, tilt and count-up are CSS transforms (`src/components/student/Motion3D.tsx`), pause when off-screen and are switched off for `prefers-reduced-motion` |
| Public pages | Home, contact, `/privacy`, `/terms`; `robots.txt`, `sitemap.xml`, web manifest, favicon, Apple touch icon and Open Graph image come from `src/app` file conventions |

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
PATCH  /api/exams/:id            DELETE /api/exams/:id      POST /api/exams/bulk-delete
GET    /api/exams/:id/analytics  GET /api/exams/:id/leaderboard
POST   /api/responses/:id/grade
GET    /api/grading/status                 dual-mode engine + AI queue state       (admin)
POST   /api/grading/evaluate               AI dry run: { questionId | question, answer } (admin)
POST   /api/responses/:id/ai-grade         (re-)run AI evaluation for one response  (admin)
POST   /api/exams/:id/ai-grade             { scope: 'pending' | 'all' } bulk AI      (admin)
GET    /api/student/exams | /student/history
POST   /api/student/join         POST /api/student/answers
GET    /api/student/exams/:id | /student/exams/by-code/:code
POST   /api/contact              { topic, role, name, email, org?, message, rating? } → 201 (public, throttled)
GET    /api/health
```

### Socket contracts (`shared/types.ts`)

Server → client: `exam:state`, `question:pushed`, `question:locked`, `exam:ended`, `exam:removed`, `leaderboard:update`, `response:new` (staff only), `student:tab-hidden` (staff only), `time:sync`, `notice`
Client → server: `join:exam`, `student:tab-hidden`, `time:sync:request`

---

## 5. Try the real-time loop in 60 seconds

0. Log in as **admin** → *Question papers* → upload a PDF/Word/photo of your own paper (or hit **Load example**) — all its questions appear in the panel with timer + push + edit.
1. Log in as **admin** → *Question bank* → add a question (any format, set its timer).
2. *Live sessions* → open **QM4LIVE** → adjust a timer in the queue → **Push**.
3. In a second browser (incognito) log in as **aarav@axiom.edu** → lobby → **QM4LIVE**.
4. Answer as the timer runs: the admin feed updates instantly with latency + grade; the leaderboard re-ranks by accuracy then speed.
5. Push a **long answer** question — it lands in the review queue; score it from the feed and watch the leaderboard change.
6. Open **Analytics** for the same session: per-question accuracy, option distribution, latency histogram, CSV export.

During a live session, the Student interface discloses that hiding the exam tab sends a real-time alert to the session's Admin control room. The alert's student ID is derived from the authenticated Socket.io session; this is a visibility signal, not proof of misconduct or a substitute for in-person proctoring.

### Google Classroom integration

1. In Google Cloud Console, enable the **Google Classroom API**, configure the OAuth consent screen, and create an OAuth 2.0 **Web application** client.
2. Add the exact redirect URI `https://<your-app-origin>/api/classroom/oauth/callback` (local development: `http://localhost:3000/api/classroom/oauth/callback`) to that client.
3. Configure `GOOGLE_CLASSROOM_CLIENT_ID` and `GOOGLE_CLASSROOM_CLIENT_SECRET` in the server environment. Never expose the client secret in browser code or commit it.
4. Open an exam's Admin control room, connect the faculty Google account, select and link the corresponding course, and use **Sync roster** to review email matches. Only existing Parikshio student accounts are matched; Classroom roster sync does not create accounts.
5. Once linked, ending the exam automatically creates one Classroom coursework item and posts the total scores of matched students who participated in the exam. If publication fails, the control room displays the failure and offers a retry. The coursework item is created as part of the one-time publish flow; changing a course after publication is blocked to prevent duplicate assignments.

Google's OAuth consent configuration and Classroom access policies determine which courses and roster details are available. Live publication requires a correctly configured teacher account and course; local automated tests cannot verify an external Google account.

---

## 6. Production notes

* Set `JWT_SECRET`, `APP_URL` (the public HTTPS origin), `MONGODB_URI`, and `REDIS_URL`; run `npm run build && npm start`. Production refuses to boot without a valid `APP_URL`.
* Split hosting (Vercel UI + Render API) is supported. Set `NEXT_PUBLIC_API_URL` in Vercel to the Render service URL, and set `ALLOWED_ORIGINS` in Render to the Vercel origin(s). The Render service must remain a Web Service because Socket.io requires a long-lived Node process; do not deploy the API as a serverless function.
* Render Web Service commands: build `npm ci && npm run build`, start `npm start`, health check `/healthz`. Set the service root directory to this project directory if the repository contains multiple apps.
* Vercel project settings: framework **Next.js**, root directory this project directory, and the normal Next.js build command. Vercel serves the UI; the custom Express server in `server/index.ts` runs only on Render.

### Deploy checklist (Render API + Vercel UI)

The repository includes [`render.yaml`](./render.yaml) and [`vercel.json`](./vercel.json).
After the one-time provider setup below, both hosts deploy automatically on every push
to `main`; no deploy command or manual upload is needed.

#### One-time provider setup

1. **Render:** create a Blueprint from this repository and select `render.yaml`.
   Keep the service as a **Web Service**, complete the `sync: false` environment
   values in the Render dashboard, and enable **Auto-Deploy: Yes** for the `main`
   branch. Render will use the health check at `/healthz`.
2. **Vercel:** import the same GitHub repository as a Next.js project, set the
   root directory to this project directory, and select the `main` production
   branch. Vercel's Git integration then creates a production deployment for
   every push to `main` and preview deployments for pull requests/other branches.
3. Add `NEXT_PUBLIC_API_URL` and the public Firebase values to the Vercel
   project. Add the Render URL to `ALLOWED_ORIGINS` on Render. Include both the
   Vercel production URL and any preview URL that needs to call the API.
4. On Vercel, redeploy once after saving environment variables because
   `NEXT_PUBLIC_*` values are embedded at build time. Do not copy server secrets
   to Vercel.

**Do not set `NODE_ENV` as a Render environment variable.** npm omits `devDependencies` whenever `NODE_ENV=production` is already in the environment, which strips `tailwindcss`, `autoprefixer` and `typescript` and makes `next build` fail in seconds. The `start` script sets production itself (`cross-env NODE_ENV=production`), and `next build` sets it internally, so the build still writes to `.next-prod` and the server still runs in production mode. (Alternatively, keep the variable and change the build command to `npm ci --include=dev && npm run build`.)

| Render — Web Service | Value |
| --- | --- |
| `APP_URL` | the public HTTPS origin, e.g. `https://your-app.onrender.com` — HTTPS is required in production |
| `ALLOWED_ORIGINS` | every Vercel origin that must reach the API, comma-separated (production + preview) |
| `JWT_SECRET` · `MONGODB_URI` · `REDIS_URL` | session signing key and backing stores |
| `GEMINI_API_KEY` | AI grading; leave unset to fall back to answer-key / manual review |
| `GOOGLE_CLASSROOM_CLIENT_ID` · `GOOGLE_CLASSROOM_CLIENT_SECRET` | keep the secret on Render only |
| `FIREBASE_PROJECT_ID`, `BREVO_*`, `SESSION_TTL` | Google sign-in verification, reset and contact email, session lifetime. `BREVO_SENDER_EMAIL` must be a verified sender in Brevo, or on a domain authenticated in Brevo; otherwise Brevo accepts the request and then drops the email ("sender … is not valid") |
| `CONTACT_INBOX_EMAIL` | optional; where contact-form messages are emailed (default `support@parikshio.tech`) |

| Vercel — frontend only | Value |
| --- | --- |
| `USE_DEFAULT_DIST_DIR` | optional; the config automatically uses `.next` when it detects Vercel |
| `NEXT_PUBLIC_API_URL` | the Render service URL |
| `NEXT_PUBLIC_FIREBASE_*` | the four public Firebase web-app values |
| `NEXT_PUBLIC_SITE_URL` | optional; canonical origin for metadata, sitemap and share images (default `https://parikshio.tech`) |

Never put a server secret (`JWT_SECRET`, `MONGODB_URI`, `REDIS_URL`, `GEMINI_API_KEY`, `BREVO_API_KEY`, `GOOGLE_CLASSROOM_CLIENT_SECRET`) in the Vercel project: the UI never reads them.

`NEXT_PUBLIC_*` values are inlined at build time, so adding or changing one only takes effect after a fresh deploy. Also authorise each deployed origin for sign-in: Firebase console → Authentication → Settings → Authorized domains, and register `https://<render-host>/api/classroom/oauth/callback` as an OAuth redirect URI in Google Cloud.

* For Google Classroom in split hosting, keep `APP_URL` on Render equal to the Render backend URL and register `https://<render-host>/api/classroom/oauth/callback` in Google Cloud. Keep `GOOGLE_CLASSROOM_CLIENT_SECRET` on Render only.
* Public signup creates student accounts only. Faculty/admin accounts must be provisioned through a trusted operational process; the public signup and Google signup endpoints cannot grant admin access. There is no in-app approval yet; until there is, grant a request by hand:
  1. The teacher creates an ordinary account at `/signup` (student tab) with their work email, or already has one.
  2. MongoDB Atlas → Browse Collections → your database → `users` → filter `{ "email": "teacher@college.edu" }` → change `role` from `"student"` to `"admin"` → Update. Change nothing else.
  3. Restart the Render service straight away. Users are read from MongoDB only at boot, and a log-in before the restart writes the old role back.
  4. Reply to the request email: log in at `/login?role=faculty` with the same email (password or Google).
* Production does not seed demo users or sample assessments. Provision the first faculty account and any required initial data through a trusted operational process.
* Offline answers are stored on the device and sync when connectivity returns, but production accepts them only while the question is open (plus the existing short in-flight grace); client-reported answer times are never trusted for scoring.
* If deployed behind a reverse proxy, set `TRUSTED_PROXIES` to its exact IP address or CIDR range(s). Leave it blank when there is no trusted proxy; forwarded IP headers are ignored by default.
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
src/app/        /  /login  /signup  /forgot-password  /reset-password  /contact  /privacy  /terms
                /admin  /admin/questions  /admin/exams  /admin/exams/[id]
                /admin/papers  /admin/papers/[id]  /admin/analytics  /admin/analytics/[id]
                /student  /student/exam/[code]
                favicon.ico · apple-icon.png · opengraph-image.png · manifest.ts · robots.ts · sitemap.ts
src/components/ AdminShell, StudentShell, Logo, Leaderboard, ui/*, charts/*, landing/*, site/* (footer, contact, legal), auth/*
src/lib/        api client, auth provider, socket hooks (status, server clock, animation), site.ts (brand + contact details)
public/         icons/ (web app icons) · brand/ (mark SVG/PNG, logo lockups, social avatar)
```

Question papers: upload PDF / Word / photo in *Question papers*; the parser (`server/extract.ts`) rebuilds questions, options, marks and answer keys, and every imported item keeps a link back to its paper (`/admin/papers/[id]`) with timer · push · edit · delete per question.

UI notes: a "midnight & champagne" system: deep navy surfaces, champagne gold for primary actions and the brand, royal indigo for selection, emerald and coral for right and wrong, tabular numerals for every metric, and reduced motion respected. Fraunces (display) and Inter (text) are self-hosted by `next/font`, so pages make no runtime font requests. The logo is a stopwatch "P": the bowl of the letter is a dial with a tick inside, crowned like a stopwatch. Its geometry lives in `src/components/Logo.tsx` and is reused by every icon and the brand kit in `public/brand/`.
