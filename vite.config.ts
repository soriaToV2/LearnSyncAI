import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

/*
 * ⚠️ THE `define` BLOCK THAT INJECTED `process.env.GEMINI_API_KEY` IS GONE, AND
 * MUST NOT COME BACK.
 *
 * It substituted the raw Gemini key into any client file that referenced that
 * expression. Nothing did — verified against the built bundle, the key was never
 * actually shipped — so it leaked nothing, but it was a trap: the first line of
 * browser code to read `process.env.GEMINI_API_KEY` would have published a live
 * API key to every visitor, with no build error and no visible symptom. Public
 * repositories and deployed bundles are both scanned for exactly this.
 *
 * Gemini and Groq are called ONLY from `server/lib/`, where the keys stay in the
 * server process. If the browser ever needs an AI result, it must come through an
 * authenticated route in `server/routes/` — never a key handed to the client.
 *
 * `loadEnv` went with it; it existed only to feed that block. The frontend's own
 * variables (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) reach the bundle
 * through Vite's normal `import.meta.env` handling and are unaffected.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  server: {
    // HMR is disabled in AI Studio via DISABLE_HMR env var.
    // Do not modify — file watching is disabled to prevent flickering during agent edits.
    hmr: process.env.DISABLE_HMR !== 'true',
    // Proxy all /api requests to the Express backend to avoid CORS issues in development
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },
});
