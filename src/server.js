// Entry point. createApp() wires the routes together; it takes the database and the AI function
// as arguments so tests can pass an in-memory database and a fake AI.
const path = require('node:path');
const express = require('express');
const { openDb } = require('./db');
const { askModel } = require('./assistant');
const { chatRoutes } = require('./routes/chat');
const { panelRoutes } = require('./routes/panel');
const { accountRoutes } = require('./routes/account');
const { appRoutes } = require('./routes/app');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const DEFAULT_PORT = 3000;

function securityHeaders(req, res, next) {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'same-origin');
  // The chat page is meant to be embedded on shop websites; everything else must not be framed.
  if (!req.path.startsWith('/chat/')) res.set('Content-Security-Policy', "frame-ancestors 'self'");
  next();
}

/**
 * @param {{ db: import('node:sqlite').DatabaseSync, ask: null | ((systemPrompt: string, history: object[]) => Promise<string>) }} deps
 */
function createApp({ db, ask }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(securityHeaders);
  app.use(express.json({ limit: '50kb' }));

  app.use('/api/auth', accountRoutes(db));
  app.use('/api/panel', panelRoutes(db));
  app.use('/api/app', appRoutes(db));
  app.use('/api/chat', chatRoutes(db, ask));

  app.get('/chat/:slug', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'chat.html')));
  app.get('/panel', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'panel.html')));
  app.get(['/app', '/app/*'], (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'app.html')));
  app.use(express.static(PUBLIC_DIR));

  // Last stop for errors: log the details, show the browser only a generic message.
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'درخواست نامعتبر است' });
    console.error('[server]', err);
    res.status(500).json({ error: 'خطای سرور' });
  });
  return app;
}

/** Reads the AI settings from .env. No key -> null -> the bot runs in offline mode. */
function aiFromEnv(env) {
  if (!env.AI_API_KEY) return null;
  const config = { baseUrl: env.AI_BASE_URL || 'https://openrouter.ai/api/v1', apiKey: env.AI_API_KEY, model: env.AI_MODEL };
  if (!config.model) throw new Error('AI_API_KEY is set but AI_MODEL is empty — set AI_MODEL in .env');
  return (systemPrompt, history) => askModel(config, systemPrompt, history);
}

if (require.main === module) {
  const db = openDb(process.env.DB_FILE || 'data/assistant.db');
  const ask = aiFromEnv(process.env);
  const port = Number(process.env.PORT) || DEFAULT_PORT;
  createApp({ db, ask }).listen(port, () => {
    console.info(`Assistant running on http://localhost:${port}  (AI: ${ask ? process.env.AI_MODEL : 'offline mode'})`);
  });
}

module.exports = { createApp, aiFromEnv };
