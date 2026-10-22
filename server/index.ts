import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Resolve __dirname in ESM.
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// dotenv is loaded by server/lib/supabase.ts, imported below.

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
import subjectRoutes from './routes/subjects.routes';
import onboardingRoutes from './routes/onboarding.routes';
import { loadBktParameters } from './lib/bkt';
import { verifyGeminiCredential } from './lib/gemini';

const app = express();
const PORT = process.env.PORT || 5000;

// Global middleware

// A bare helmet() blocks the browser's direct calls to Supabase (sign-in, PDF signed URLs) via CSP
// connect-src. Only visible in production, where Express serves index.html. Don't simplify it.
// worker-src covers pdf.js's bundled worker and its blob: fallback.
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
// Skip logging successful health checks (polled constantly); failures still log.
app.use(
  morgan('dev', {
    skip: (req, res) => req.path === '/api/health' && res.statusCode < 400,
  })
);
app.use(express.json());                   // Parse JSON request bodies
app.use(express.urlencoded({ extended: true }));

// Health check (public)
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API routes
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
// Subject catalogue, read-only. Students and educators only.
app.use('/api/subjects', subjectRoutes);
// First-run onboarding state. Gates nothing; a failed read only repeats a tour step.
app.use('/api/onboarding', onboardingRoutes);
// Admin: accounts only; touches no learning table.
app.use('/api/admin', adminRoutes);

// No /api/bkt: mastery updates only on test completion and due flashcard ratings, and is read
// per space, globally via /api/dashboard (accepts no input), or by educators per owned material.

// Static frontend: in production Express serves the built app from one origin (api.ts uses relative
// paths). The SPA fallback is required for client routes; /api/ paths still 404 as JSON.
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

// 404 handler (after all routes)
app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Global error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[Server Error]', err.message);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

// Start server
app.listen(PORT, () => {
  console.log(`\n🚀 LearnSyncAI API server running on http://localhost:${PORT}`);
  console.log(`   Health check: http://localhost:${PORT}/api/health`);
  console.log(`   Environment: ${process.env.NODE_ENV || 'development'}\n`);

  // Warm the BKT parameter cache so a bad row shows in the boot log.
  void loadBktParameters()
    .then((p) => {
      console.log(
        `   BKT: P(L0) ${p.pL0}  P(T) ${p.pT}  P(S) ${p.pS}  ` +
          `P(G) ${Object.entries(p.guess).map(([k, v]) => `${k.replace('g_', '')}=${v}`).join(' ')}\n`
      );
    })
    .catch((err) => console.error('[BKT] Parameter warm-up failed:', err));

  // Check the Gemini key with a free metadata call. Non-blocking: it must never delay or break startup.
  void verifyGeminiCredential()
    .then(() => console.log('   Gemini: credential OK\n'))
    .catch((err) => {
      console.error(`\n⛔ Gemini: credential REJECTED — ${err.message}`);
      console.error('   Every AI feature will fail: extraction, flashcards, tests, games, chat.');
      console.error('   Check GEMINI_API_KEY in .env (and in the Render dashboard for the');
      console.error('   deployed app). The server is still running and still serving.\n');
    });
});

export default app;
