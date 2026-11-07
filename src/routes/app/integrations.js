// Integrations of one store: WooCommerce (connect = a real authenticated call), API keys, outbound
// webhooks, widget sightings. Secrets go out exactly once (when created) and never again.
const crypto = require('node:crypto');
const express = require('express');
const validate = require('../../validate');
const { storeFor } = require('../../scope');
const { effectivePlan, PLAN_LIMITS } = require('../../plans');
const { checkUrl } = require('../../safeUrl');
const { wooClient, tomanFactor, WooError } = require('../../sync/woocommerce');
const { createApiKey } = require('../../apiKeys');
const { createWebhook, webhookJson } = require('../../webhookAdmin');

const WOO_TOPICS = ['product.created', 'product.updated', 'product.deleted', 'order.created', 'order.updated'];
const RECENT_RUNS = 10;
const NOT_FOUND = { error: 'فروشگاه پیدا نشد' };
const PRO_ONLY = { error: 'اتصال ووکامرس و API در پلن حرفه‌ای فعال است.' };

function integrationRoutes({ db, cipher, queue, fetch: doFetch, allowPrivate, publicBaseUrl }) {
  const router = express.Router();
  const workspaceOf = (req) => db.prepare('SELECT id, plan, paid_until FROM workspaces WHERE id = ?').get(req.workspaceId);
  const allowed = (req) => PLAN_LIMITS[effectivePlan(workspaceOf(req))].integrations;
  const wooOf = (storeId) => db.prepare("SELECT * FROM integrations WHERE store_id = ? AND type = 'woocommerce'").get(storeId);

  /** :storeId must be a connected store of this workspace; pro plan for anything that connects. */
  const withStore = ({ pro = true } = {}) => (req, res, next) => {
    req.store = storeFor(db, req, validate.id(req.params.storeId) ?? -1);
    if (!req.store) return res.status(404).json(NOT_FOUND);
    if (pro && !allowed(req)) return res.status(403).json(PRO_ONLY);
    next();
  };

  /** Platform label follows what is really set up: WooCommerce > own API > widget only. */
  function refreshPlatform(storeId) {
    const hasKeys = db.prepare('SELECT 1 FROM api_keys WHERE store_id = ? AND revoked_at IS NULL').get(storeId);
    const platform = wooOf(storeId) ? 'woocommerce' : hasKeys ? 'custom' : 'widget';
    db.prepare('UPDATE stores SET platform = ? WHERE id = ?').run(platform, storeId);
  }

  router.get('/', (req, res) => {
    const store = storeFor(db, req, req.query.store ? validate.id(req.query.store) ?? -1 : undefined);
    if (!store) return res.status(404).json(NOT_FOUND);
    const woo = wooOf(store.id);
    res.json({
      storeId: store.id, storeName: store.name, slug: store.slug, domain: store.domain, platform: store.platform,
      allowed: allowed(req), publicBaseUrl,
      woocommerce: woo && {
        siteUrl: woo.site_url, status: woo.status, currency: woo.currency, lastOkAt: woo.last_ok_at, lastError: woo.last_error,
        lastSyncAt: woo.last_sync_at, webhooks: Boolean(woo.webhooks_ok), syncing: queue.isRunning(store.id),
      },
      syncRuns: db.prepare(`SELECT id, kind, status, started_at AS startedAt, finished_at AS finishedAt, created, updated, error
        FROM sync_runs WHERE store_id = ? ORDER BY id DESC LIMIT ?`).all(store.id, RECENT_RUNS),
      apiKeys: db.prepare(`SELECT id, prefix, label, created_at AS createdAt, last_used_at AS lastUsedAt
        FROM api_keys WHERE store_id = ? AND revoked_at IS NULL ORDER BY id`).all(store.id),
      webhooks: db.prepare('SELECT * FROM webhooks WHERE store_id = ? ORDER BY id').all(store.id).map(webhookJson),
      sightings: db.prepare('SELECT origin, last_seen_at AS lastSeenAt, hits FROM widget_sightings WHERE store_id = ? ORDER BY last_seen_at DESC').all(store.id),
    });
  });

  router.post('/:storeId/woocommerce', withStore(), async (req, res, next) => {
    try {
      const key = validate.text(req.body?.consumerKey, 10, 100);
      const secret = validate.text(req.body?.consumerSecret, 10, 100);
      if (!key || !secret) return res.status(400).json({ error: 'کلید مصرف‌کننده و رمز مصرف‌کننده لازم است (از ووکامرس › تنظیمات › پیشرفته › REST API)' });
      const safe = await checkUrl(req.body?.siteUrl, { allowPrivate });
      if (!safe.ok) return res.status(400).json({ error: `آدرس سایت: ${safe.error}` });
      const siteUrl = new URL(safe.url).origin + new URL(safe.url).pathname.replace(/\/+$/, '');

      // Connected means WooCommerce answered with these keys — not that a URL was typed.
      const client = wooClient({ siteUrl, key, secret, fetch: doFetch });
      let currency;
      try {
        currency = await client.currency();
        tomanFactor(currency);
      } catch (err) {
        if (err instanceof WooError) return res.status(400).json({ error: err.message });
        throw err;
      }

      const webhookSecret = crypto.randomBytes(32).toString('base64url');
      db.prepare('DELETE FROM integrations WHERE store_id = ? AND type = ?').run(req.store.id, 'woocommerce');
      db.prepare(`INSERT INTO integrations (store_id, type, site_url, credentials_enc, webhook_secret_enc, currency, status, last_ok_at)
        VALUES (?, 'woocommerce', ?, ?, ?, ?, 'pending', datetime('now'))`)
        .run(req.store.id, siteUrl, cipher.encrypt(JSON.stringify({ key, secret })), cipher.encrypt(webhookSecret), currency);
      refreshPlatform(req.store.id);

      // Webhooks keep things instant; without them the 15-minute scheduled sync still runs.
      const deliveryUrl = `${publicBaseUrl}/api/webhooks/woocommerce/${req.store.id}`;
      const results = await Promise.allSettled(WOO_TOPICS.map((topic) => client.createWebhook(topic, deliveryUrl, webhookSecret)));
      const webhooks = results.every((r) => r.status === 'fulfilled');
      db.prepare('UPDATE integrations SET webhooks_ok = ? WHERE store_id = ? AND type = ?').run(webhooks ? 1 : 0, req.store.id, 'woocommerce');

      queue.run(req.store.id); // first import runs in the background; the page polls its progress
      res.status(201).json({ ok: true, currency, webhooks });
    } catch (err) { next(err); }
  });

  router.post('/:storeId/woocommerce/sync', withStore(), (req, res) => {
    if (!wooOf(req.store.id)) return res.status(404).json({ error: 'ووکامرس به این فروشگاه وصل نیست' });
    queue.run(req.store.id);
    res.status(202).json({ ok: true });
  });

  router.delete('/:storeId/woocommerce', withStore({ pro: false }), (req, res) => {
    db.prepare("DELETE FROM integrations WHERE store_id = ? AND type = 'woocommerce'").run(req.store.id);
    refreshPlatform(req.store.id);
    res.json({ ok: true });
  });

  router.post('/:storeId/api-keys', withStore(), (req, res) => {
    const label = validate.text(req.body?.label ?? '', 0, 60);
    if (label === null) return res.status(400).json({ error: 'نام کلید حداکثر ۶۰ حرف' });
    const created = createApiKey(db, req.store.id, label);
    refreshPlatform(req.store.id);
    res.status(201).json(created);
  });

  router.delete('/:storeId/api-keys/:id', withStore({ pro: false }), (req, res) => {
    const { changes } = db.prepare("UPDATE api_keys SET revoked_at = datetime('now') WHERE id = ? AND store_id = ? AND revoked_at IS NULL")
      .run(validate.id(req.params.id) ?? -1, req.store.id);
    if (!changes) return res.status(404).json({ error: 'کلید پیدا نشد' });
    refreshPlatform(req.store.id);
    res.json({ ok: true });
  });

  router.post('/:storeId/webhooks', withStore(), async (req, res, next) => {
    try {
      const result = await createWebhook(db, cipher, req.store.id, req.body, { allowPrivate });
      if (result.error) return res.status(400).json({ error: result.error });
      res.status(201).json(result);
    } catch (err) { next(err); }
  });

  router.delete('/:storeId/webhooks/:id', withStore({ pro: false }), (req, res) => {
    const { changes } = db.prepare('DELETE FROM webhooks WHERE id = ? AND store_id = ?').run(validate.id(req.params.id) ?? -1, req.store.id);
    if (!changes) return res.status(404).json({ error: 'وب‌هوک پیدا نشد' });
    res.json({ ok: true });
  });

  return router;
}

module.exports = { integrationRoutes };
