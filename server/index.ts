import http from 'node:http';
import next from 'next';
import express from 'express';
import { Server } from 'socket.io';
import { config, isProd } from './config';
import { api } from './api';
import { cache } from './cache';
import { initMongo, mongoReady } from './mongo';
import { seedIfEmpty } from './seed';
import { db, store } from './store';
import { userFromToken } from './auth';
import { emitStaff, setIO, examRoom, staffRoom, staffLobby, userRoom, type AxiomIO } from './realtime';
import { buildExamPublic, getLeaderboard, rearmTimers } from './engine';
import { resumeAiQueue } from './grading';
import type { ClientToServerEvents, PublicUser, Role, ServerToClientEvents } from '../shared/types';

/**
 * Refuses to continue if the port is already taken.
 *
 * This check has to happen *before* `next().prepare()`. A second instance that
 * gets as far as preparing Next re-initialises the shared build directory, and
 * the instance that actually owns the port then starts serving 200s for HTML
 * while every JS chunk 404s — the page renders but never hydrates, so forms
 * fall back to a native GET. Failing fast here turns that silent corruption
 * into one obvious line of output.
 */
function ensurePortFree(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const probe = http.createServer();
    probe.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        const howToStop =
          process.platform === 'win32'
            ? `Get-NetTCPConnection -LocalPort ${port} -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }`
            : `lsof -ti:${port} | xargs kill -9`;
        reject(
          new Error(
            `Port ${port} is already in use — another Axiom server is running.\n\n` +
              '       Two servers sharing one build directory leave the running one\n' +
              '       serving broken assets, so this one stopped instead of starting.\n\n' +
              '       Check your editor terminals first. To free the port:\n\n' +
              `         ${howToStop}\n\n` +
              `       Or set a different port:  PORT=${port + 1} npm run dev\n`
          )
        );
      } else {
        reject(err);
      }
    });
    probe.once('listening', () => probe.close(() => resolve()));
    probe.listen(port, '0.0.0.0');
  });
}

async function main() {
  const t0 = Date.now();
  await ensurePortFree(config.port);
  await cache.init();
  await initMongo();
  if (!isProd) seedIfEmpty();
  rearmTimers();
  // Evaluations interrupted by a restart pick up where they left off.
  resumeAiQueue();

  const nextApp = next({ dev: !isProd, hostname: '0.0.0.0', port: config.port });
  const handle = nextApp.getRequestHandler();
  await nextApp.prepare();

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustedProxies);

  // Baseline hardening. The UI and API are same-origin, so we can be strict.
  app.use((_req, res, nextFn) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-DNS-Prefetch-Control', 'off');
    if (isProd) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    nextFn();
  });

  app.use(express.json({ limit: '1mb' }));
  app.use((req, res, nextFn) => {
    const origin = req.headers.origin;
    if (origin && config.allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') {
      res.sendStatus(origin && config.allowedOrigins.includes(origin) ? 204 : 403);
      return;
    }
    nextFn();
  });
  app.use('/api', api);
  app.get('/healthz', (_req, res) => res.json({ ok: true }));
  app.all('*', (req, res) => handle(req, res));

  /**
   * Final error net for the API. Express 4 does not catch rejections from async
   * handlers on its own — `api.ts` wraps those in `asyncRoute` so they arrive
   * here instead of becoming an unhandled rejection that would take the whole
   * process down (and with it the in-memory store, when Mongo is absent).
   */
  app.use((err: Error, req: express.Request, res: express.Response, _nextFn: express.NextFunction) => {
    console.error(`[api] unhandled error on ${req.method} ${req.originalUrl}:`, err);
    if (res.headersSent) return;
    res.status(500).json({ error: 'Something went wrong on our side. Please try again.' });
  });

  const server = http.createServer(app);
  const io: AxiomIO = new Server<ClientToServerEvents, ServerToClientEvents>(server, {
    // Same-origin by default; set ALLOWED_ORIGINS to let other hosts connect.
    cors: {
      origin: config.allowedOrigins.length ? config.allowedOrigins : isProd ? false : true,
      credentials: true
    },
    transports: ['websocket', 'polling']
  });
  setIO(io);

  // ── socket auth (JWT in handshake) ──────────────────────────
  io.use((socket, next) => {
    const token = (socket.handshake.auth?.token as string | undefined) ?? '';
    const user = userFromToken(token);
    if (!user) return next(new Error('unauthorised'));
    socket.data.user = user;
    return next();
  });

  io.on('connection', (socket) => {
    const user = socket.data.user as PublicUser;
    const role: Role = user.role;
    socket.emit('time:sync', { serverTime: Date.now() });
    socket.join(userRoom(user.id));
    if (role === 'admin') socket.join(staffLobby);

    socket.on('join:exam', (payload) => {
      const exam = db.examByCode(String(payload?.examCode ?? ''));
      if (!exam) return;
      // The REST equivalent refuses draft exams for students; match it here.
      if (exam.status === 'draft' && role !== 'admin') return;

      const target = examRoom(exam.code);
      const staff = staffRoom(exam.code);
      const own = userRoom(user.id);
      // Without this a socket accumulates every exam room it has ever joined and
      // keeps receiving pushes for sessions it has moved on from.
      for (const room of [...socket.rooms]) {
        if (room !== socket.id && room !== staffLobby && room !== own && room !== target && room !== staff) {
          socket.leave(room);
        }
      }

      // The room is decided by the *token* role. `payload.role` is client-supplied,
      // so trusting it let any student join the staff room and watch every
      // submission — answer text and grade — stream in while the question was
      // still open.
      socket.join(target);
      socket.data.examCode = exam.code;
      if (role === 'admin') socket.join(staff);

      socket.emit('time:sync', { serverTime: Date.now() });
      socket.emit('exam:state', buildExamPublic(exam, user.id));
      socket.emit('leaderboard:update', { examId: exam.id, entries: getLeaderboard(exam.id) });
    });

    socket.on('student:tab-hidden', (payload) => {
      if (role !== 'student') return;
      const examCode = String(payload?.examCode ?? '').trim().toUpperCase();
      const exam = db.examByCode(examCode);
      if (!exam || exam.status !== 'live') return;
      if (socket.data.examCode !== exam.code || !socket.rooms.has(examRoom(exam.code))) return;

      emitStaff(exam.code, 'student:tab-hidden', {
        examId: exam.id,
        examCode: exam.code,
        studentId: user.id,
        studentName: user.name,
        hiddenAt: Date.now()
      });
    });

    socket.on('time:sync:request', () => {
      socket.emit('time:sync', { serverTime: Date.now() });
    });
  });

  // Clock broadcast keeps every student's countdown aligned with the server.
  const clock = setInterval(() => {
    io.emit('time:sync', { serverTime: Date.now() });
  }, 10_000);

  server.listen(config.port, '0.0.0.0', () => {
    console.log(`\n  ⬢  Axiom Live  ·  http://localhost:${config.port}`);
    console.log(`     engine: ${isProd ? 'production' : 'development'}  ·  boot ${Date.now() - t0}ms`);
    console.log(`     mongo:  ${mongoReady() ? 'connected' : 'ephemeral (no MONGODB_URI)'}`);
    console.log(`     redis:  ${cache.stats().status}`);
    console.log(
      `     ai:     ${config.gemini.enabled ? `gemini (${config.gemini.models.join(' → ')})${config.gemini.autoGrade ? '' : ' · on demand'}` : 'off (set GEMINI_API_KEY to AI-grade short/long answers)'}`
    );
    console.log(`     data:   ${store.questions.length} questions · ${store.exams.length} exams · ${store.responses.length} responses\n`);
  });

  const shutdown = () => {
    clearInterval(clock);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  /**
   * A rejected promise with no handler would otherwise terminate the process on
   * Node 15+, taking every question, exam and response with it when MongoDB is
   * not configured. One bad request should not cost the whole session.
   */
  process.on('unhandledRejection', (reason) => {
    console.error('[server] unhandled promise rejection:', reason);
  });
  // Logs the stack but deliberately leaves Node's default crash behaviour in
  // place: after a genuine uncaught exception the process state is unknown.
  process.on('uncaughtExceptionMonitor', (err, origin) => {
    console.error(`[server] uncaught exception (${origin}):`, err);
  });
}

main().catch((err) => {
  console.error(`\n  ✖  ${(err as Error).message}\n`);
  process.exit(1);
});
