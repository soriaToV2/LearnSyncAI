import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';

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
import { loadBktParameters } from './lib/bkt';

const app = express();
const PORT = process.env.PORT || 5000;

// ─────────────────────────────────────────────
// Global Middleware
// ─────────────────────────────────────────────
app.use(helmet());                         // Sets secure HTTP headers
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

/*
 * `/api/bkt` is gone, and should not come back.
 *
 * It exposed a `POST /recalculate` that proxied to a Python pyBKT microservice
 * with parameters contradicting the paper — P(S) = 0.1 instead of 0.15, and a
 * single flat P(G) = 0.2 in place of the eight context-sensitive values. Nothing
 * ever called it. BKT now runs in-process (`server/lib/bkt.ts`) at the only two
 * moments the paper permits: completing an adaptive test and rating a due
 * flashcard. Mastery is read back through
 * `GET /api/practice/space/:spaceId/mastery`, which is scoped to one owned space
 * rather than returning every row a student has.
 */

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
