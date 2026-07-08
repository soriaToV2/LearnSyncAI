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
import bktRoutes from './routes/bkt.routes';
import chatRoutes from './routes/chat.routes';

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
app.use('/api/bkt', bktRoutes);
app.use('/api/chat', chatRoutes);

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
});

export default app;
