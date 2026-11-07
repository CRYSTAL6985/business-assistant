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
const { findStore } = require('./routes/chat');
const { frameAncestors } = require('./origins');
const { createCipher, DEV_SECRET } = require('./crypto');
const { createSyncQueue } = require('./sync/queue');
const { createOutbound } = require('./outbound');
const { startScheduler } = require('./scheduler');
const { webhookRoutes } = require('./routes/webhooks');
const { publicApiRoutes } = require('./routes/publicApi');

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
 * @param {{
 *   db: import('node:sqlite').DatabaseSync,
 *   ask: null | ((systemPrompt: string, history: object[]) => Promise<string>),
 *   secretKey?: string,          encrypts integration secrets (SECRET_KEY)
 *   fetch?: typeof fetch,        outgoing HTTP (WooCommerce, webhooks) — tests pass a fake
 *   allowPrivateUrls?: boolean,  development / tests only: let integrations call local addresses
 *   publicBaseUrl?: string,      where shops reach us (webhook delivery URL)
 *   retryDelays?: number[],      sync / webhook backoff — tests pass zeros
 * }} deps
 */
function createApp({ db, ask, secretKey = DEV_SECRET, fetch: doFetch = fetch, allowPrivateUrls = false, publicBaseUrl = `http://localhost:${DEFAULT_PORT}`, retryDelays }) {
  const cipher = createCipher(secretKey);
  const queue = createSyncQueue({ db, cipher, fetch: doFetch, ...(retryDelays ? { retryDelays } : {}) });
  const outbound = createOutbound({ db, cipher, fetch: doFetch, allowPrivate: allowPrivateUrls, ...(retryDelays ? { delays: [0, ...retryDelays] } : {}) });
  const services = { db, cipher, queue, outbound, fetch: doFetch, allowPrivate: allowPrivateUrls, publicBaseUrl: publicBaseUrl.replace(/\/+$/, '') };

  const app = express();
  app.disable('x-powered-by');
  app.locals.services = services;
  app.use(securityHeaders);
  app.use('/api/webhooks', webhookRoutes(services)); // before express.json: signatures cover the raw body
  app.use(express.json({ limit: '50kb' }));

  app.use('/api/auth', accountRoutes(db));
  app.use('/api/panel', panelRoutes(db));
  app.use('/api/app', appRoutes(db, ask, services));
  app.use('/api/chat', chatRoutes(db, ask, { outbound }));
  app.use('/api/v1', publicApiRoutes(services));

  app.get('/chat/:slug', (req, res) => {
    const store = findStore(db, String(req.params.slug));
    // Embeddable only on the store's own site (any site while the store has no domain set).
    res.set('Content-Security-Policy', store ? frameAncestors(store) : "frame-ancestors 'self'");
    res.sendFile(path.join(PUBLIC_DIR, 'chat.html'));
  });
  app.get('/panel', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'panel.html')));
  app.get(['/app', '/app/*'], (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'app.html')));
  app.get('/favicon.ico', (req, res) => res.redirect(301, '/favicon.svg'));
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

/** Settings from the environment. Production refuses to start without the secrets it needs. */
function configFromEnv(env) {
  const production = env.NODE_ENV === 'production';
  const port = Number(env.PORT) || DEFAULT_PORT;
  const missing = ['SECRET_KEY', 'PUBLIC_BASE_URL'].filter((name) => production && !env[name]);
  if (missing.length) throw new Error(`${missing.join(' and ')} must be set in production (see .env.example)`);
  if (!env.SECRET_KEY) console.warn('[server] SECRET_KEY is not set: using the development key. Never do this in production.');
  return {
    port,
    secretKey: env.SECRET_KEY || DEV_SECRET,
    publicBaseUrl: env.PUBLIC_BASE_URL || `http://localhost:${port}`,
    allowPrivateUrls: !production,
  };
}

if (require.main === module) {
  const config = configFromEnv(process.env);
  const db = openDb(process.env.DB_FILE || 'data/assistant.db');
  const ask = aiFromEnv(process.env);
  const app = createApp({ db, ask, ...config });
  startScheduler(app.locals.services);
  app.listen(config.port, () => {
    console.info(`Assistant running on http://localhost:${config.port}  (AI: ${ask ? process.env.AI_MODEL : 'offline mode'})`);
  });
}

module.exports = { createApp, aiFromEnv, configFromEnv };
