import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Resolve __dirname in ESM context — same idiom as server/lib/supabase.ts.
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Note: dotenv is loaded inside server/lib/supabase.ts which is imported below.
// No need to call dotenv.config() here.

// Route imports
import authRoutes from './routes/auth.routes';
import materialRoutes from './routes/materials.routes';
import studySpaceRoutes from './routes/studyspaces.routes';
import flashcardRoutes from './routes/flashcards.routes';
import cognitiveRoutes from './routes/cognitive.routes';
import practiceRoutes from './routes/practice.routes';
import gamificationRoutes from './routes/gamification.routes';
import gamesRoutes from './routes/games.routes';
import chatRoutes from './routes/chat.routes';
import dashboardRoutes from './routes/dashboard.routes';
import educatorRoutes from './routes/educator.routes';
import adminRoutes from './routes/admin.routes';
import { loadBktParameters } from './lib/bkt';

const app = express();
const PORT = process.env.PORT || 5000;

// ─────────────────────────────────────────────
// Global Middleware
// ─────────────────────────────────────────────
/*
 * ⚠️ A BARE `helmet()` BLOCKS SUPABASE, WHICH BREAKS LOGIN AND EVERY LESSON PDF.
 *
 * Helmet's default Content-Security-Policy sets `default-src 'self'`, and
 * `connect-src` is NOT one of the directives it names explicitly — so it inherits
 * `'self'` and the browser refuses every request to an origin that is not ours.
 * Two things in this app talk straight to Supabase from the browser, and both fail
 * silently, with nothing in the server log:
 *
 *   - `supabase.auth.signInWithPassword()` in `src/lib/supabase.ts` — nobody can
 *     sign in, and the login form reports no error because the request never left.
 *   - `PdfViewer`, which is handed a Supabase Storage signed URL by
 *     `GET /api/materials/:id/view` and fetches it with pdf.js — no lesson opens.
 *
 * ⚠️ NEITHER IS REPRODUCIBLE IN DEVELOPMENT. Vite serves index.html on :3000 and
 * this header never reaches the document, so the policy is only ever applied once
 * Express serves the app itself — i.e. only in production. Do not "simplify" this
 * back to `helmet()` after testing locally and finding no difference.
 *
 * `worker-src` is listed because `PdfViewer` sets `GlobalWorkerOptions.workerSrc`
 * to a bundled same-origin worker; `blob:` covers pdf.js's fallback path.
 */
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        'connect-src': ["'self'", 'https://*.supabase.co', 'wss://*.supabase.co'],
        'img-src': ["'self'", 'data:', 'blob:'],
        'worker-src': ["'self'", 'blob:'],
      },
    },
  })
);
app.use(cors({ origin: process.env.APP_URL || 'http://localhost:3000' }));
app.use(morgan('dev'));                    // Request logging
app.use(express.json());                   // Parse JSON request bodies
app.use(express.urlencoded({ extended: true }));

// ─────────────────────────────────────────────
// Health Check (public — no auth required)
// ─────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─────────────────────────────────────────────
// API Routes
// ─────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/materials', materialRoutes);
app.use('/api/spaces', studySpaceRoutes);
app.use('/api/flashcards', flashcardRoutes);
app.use('/api/cognitive', cognitiveRoutes);
app.use('/api/practice', practiceRoutes);
app.use('/api/gamification', gamificationRoutes);
app.use('/api/games', gamesRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/educator', educatorRoutes);
/*
 * `/api/admin` is the third endpoint shape, and the narrowest in what it reads.
 * Per-space (`requireOwnedSpace`) is the student default; `/api/educator` is
 * scoped by a material the caller uploaded; this one is scoped by nothing but the
 * role, because administering every account is what the role is.
 *
 * It touches `profiles` and `auth.users` and NO LEARNING TABLE AT ALL — no
 * materials, no concepts, no mastery. That is the line all four scope statements
 * draw (ARCHITECTURE.md:14, README.md:191, CLAUDE.md:14, schema.sql:13), and the
 * line `educator_assignments` was removed for crossing.
 */
app.use('/api/admin', adminRoutes);

/*
 * `/api/bkt` is gone, and should not come back.
 *
 * It exposed a `POST /recalculate` that proxied to a Python pyBKT microservice
 * with parameters contradicting the paper — P(S) = 0.1 instead of 0.15, and a
 * single flat P(G) = 0.2 in place of the eight context-sensitive values. Nothing
 * ever called it. BKT now runs in-process (`server/lib/bkt.ts`) at the only two
 * moments the paper permits: completing an adaptive test and rating a due
 * flashcard.
 *
 * Mastery is read back in exactly two shapes, and both are read-only:
 *
 *   - per space, via `GET /api/practice/space/:spaceId/mastery`, gated by
 *     `requireOwnedSpace()`. This is the default and every feature uses it.
 *   - globally, via `GET /api/dashboard` — the documented exception, because a
 *     dashboard is by definition about all of a student's spaces at once, and
 *     fanning out client-side would cost 1 + N requests.
 *
 * The global route is safe for a reason worth stating: it accepts NO body, NO
 * query and NO path parameter, so every set it reads is derived from the caller's
 * own id. It cannot be pointed at another student's data because there is nothing
 * to point with. Any future global read should meet the same bar.
 *
 * `/api/educator` is the third shape and the only one that reads ACROSS students,
 * because a class-level dashboard (paper p. 61, p. 90) is by definition about a
 * set of them. It is scoped by a material the caller uploaded rather than by the
 * caller's own id, so ownership is a check rather than a construction:
 * `requireOwnedMaterial()` 404s on anyone else's material, and the one route that
 * names a student in its path re-derives that student's role, status and grade
 * membership through `rosterStudent()` instead of trusting the id. Read-only —
 * mastery still has exactly two writers, both on the student side.
 */

// ─────────────────────────────────────────────
// Static Frontend — one origin in production
// ─────────────────────────────────────────────
/*
 * In development two processes run side by side: Vite serves the app on :3000 and
 * proxies `/api` here. In production there is only this one, so Express serves the
 * built app itself.
 *
 * That is a deliberate deployment choice, not a convenience. `apiFetch()` in
 * `src/lib/api.ts` calls `fetch('/api' + endpoint)` — a RELATIVE path with no
 * configurable base URL — and `ResourcesTab`'s SSE call does the same. Serving both
 * halves from one origin is what makes those work untouched, and it removes the
 * CORS preflight a split origin would add to every request.
 *
 * ⚠️ THE SPA FALLBACK IS NOT OPTIONAL. React Router owns paths like
 * `/admin/accounts` and `/student/space/:id`, which exist only in the browser. A
 * refresh on any route but `/` would otherwise fall through to the 404 handler
 * below and return `{"error":"Route not found"}` instead of the app.
 *
 * Guarded on `dist/index.html` existing so a machine that has never run
 * `npm run build` behaves exactly as it does today rather than throwing on
 * `sendFile`. The `/api/` test keeps unknown API routes answering JSON — without
 * it, a typo'd endpoint would return the HTML shell and surface as a JSON parse
 * error in the client.
 */
const clientDist = path.resolve(__dirname, '../dist');
const clientIndex = path.join(clientDist, 'index.html');

if (fs.existsSync(clientIndex)) {
  app.use(express.static(clientDist));

  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) {
      next();
      return;
    }
    res.sendFile(clientIndex);
  });
} else {
  console.warn(
    '[Static] dist/index.html not found — serving the API only.\n' +
      '         Run `npm run build` if you meant to serve the app from this process.'
  );
}

// ─────────────────────────────────────────────
// 404 Handler (must come after all routes)
// ─────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ─────────────────────────────────────────────
// Global Error Handler
// ─────────────────────────────────────────────
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[Server Error]', err.message);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

// ─────────────────────────────────────────────
// Start Server
// ─────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 LearnSyncAI API server running on http://localhost:${PORT}`);
  console.log(`   Health check: http://localhost:${PORT}/api/health`);
  console.log(`   Environment: ${process.env.NODE_ENV || 'development'}\n`);

  // Warm the BKT parameter cache so the first student to finish a test does not
  // pay the round trip, and — more usefully — so a missing or malformed row in
  // `bkt_parameters` shows up in the boot log rather than mid-assessment.
  void loadBktParameters()
    .then((p) => {
      console.log(
        `   BKT: P(L0) ${p.pL0}  P(T) ${p.pT}  P(S) ${p.pS}  ` +
          `P(G) ${Object.entries(p.guess).map(([k, v]) => `${k.replace('g_', '')}=${v}`).join(' ')}\n`
      );
    })
    .catch((err) => console.error('[BKT] Parameter warm-up failed:', err));
});

export default app;
