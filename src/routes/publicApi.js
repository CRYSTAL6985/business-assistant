// Public API for shops with their own (non-WooCommerce) website: /api/v1, Authorization: Bearer <key>.
// A key belongs to one store; everything here is limited to that store. Only pro workspaces may use it.
const express = require('express');
const validate = require('../validate');
const { storeForKey } = require('../apiKeys');
const { effectivePlan, PLAN_LIMITS } = require('../plans');
const { upsertProducts, deleteProduct, upsertOrders } = require('../sync/upsert');
const { parsePaging, pageResult } = require('../paging');
const { addStaffReply } = require('../inbox');
const { ORDER_STATUSES } = require('./panel');
const { rateLimit } = require('../ratelimit');
const { createWebhook, webhookJson } = require('../webhookAdmin');

const EXTERNAL_ID = /^[A-Za-z0-9._:-]{1,64}$/;
const MAX_ITEMS = 100;
const MAX_QTY = 1000;
const REQUESTS_PER_MINUTE = 120;
const MAX_REPLY = 2000;

const bad = (res, error) => res.status(400).json({ error });

function productInput(body) {
  const name = validate.text(body?.name, 1, 120);
  const price = validate.price(body?.price);
  const description = validate.text(body?.description ?? '', 0, 1000);
  const category = validate.text(body?.category ?? '', 0, 60);
  const stockQty = body?.stockQty === undefined || body?.stockQty === null ? null : Number(body.stockQty);
  if (!name || price === null || description === null || category === null) return null;
  if (stockQty !== null && (!Number.isInteger(stockQty) || stockQty < 0)) return null;
  const inStock = body?.inStock === undefined ? stockQty !== 0 : body.inStock === true;
  return { name, price, description, category, stockQty, inStock };
}

/** Order lines with the total computed here, never taken from the caller. */
function orderInput(body) {
  const customerName = validate.text(body?.customerName, 1, 80);
  const phone = validate.text(body?.phone ?? '', 0, 30);
  const address = validate.text(body?.address ?? '', 0, 500);
  const status = body?.status ?? 'new';
  if (!customerName || phone === null || address === null || !ORDER_STATUSES.includes(status)) return null;
  if (!Array.isArray(body?.items) || !body.items.length || body.items.length > MAX_ITEMS) return null;
  const items = [];
  for (const item of body.items) {
    const name = validate.text(item?.name, 1, 120);
    const price = validate.price(item?.price);
    const qty = Number(item?.qty);
    if (!name || price === null || !Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) return null;
    items.push({ name, price, qty });
  }
  return { customerName, phone, address, status, items, total: items.reduce((s, i) => s + i.price * i.qty, 0), createdAt: null };
}

function publicApiRoutes({ db, cipher, allowPrivate }) {
  const router = express.Router();

  router.use((req, res, next) => {
    const storeId = storeForKey(db, req.get('authorization'));
    const store = storeId && db.prepare(`SELECT s.id, w.plan, w.paid_until, w.status FROM stores s JOIN workspaces w ON w.id = s.workspace_id
      WHERE s.id = ? AND s.disconnected_at IS NULL`).get(storeId);
    if (!store) return res.status(401).json({ error: 'invalid or revoked API key' });
    if (store.status !== 'active') return res.status(403).json({ error: 'workspace suspended' });
    if (!PLAN_LIMITS[effectivePlan(store)].integrations) return res.status(403).json({ error: 'the API needs the pro plan' });
    req.storeId = store.id;
    next();
  });
  router.use(rateLimit({ capacity: REQUESTS_PER_MINUTE, perMinute: REQUESTS_PER_MINUTE, key: (req) => `store:${req.storeId}` }));

  const externalId = (req, res) => {
    const id = String(req.params.externalId);
    if (!EXTERNAL_ID.test(id)) { bad(res, 'externalId: 1-64 characters, letters, digits . _ : -'); return null; }
    return id;
  };

  router.put('/products/:externalId', (req, res) => {
    const id = externalId(req, res);
    if (!id) return;
    const p = productInput(req.body);
    if (!p) return bad(res, 'name (text) and price (whole toman) are required; stockQty must be a whole number');
    const { created } = upsertProducts(db, req.storeId, [{ externalId: id, ...p }], 'api');
    res.status(created ? 201 : 200).json({ ok: true, created: Boolean(created) });
  });

  router.delete('/products/:externalId', (req, res) => {
    const id = externalId(req, res);
    if (!id) return;
    if (!deleteProduct(db, req.storeId, id, 'api')) return res.status(404).json({ error: 'product not found' });
    res.json({ ok: true });
  });

  router.put('/orders/:externalId', (req, res) => {
    const id = externalId(req, res);
    if (!id) return;
    const o = orderInput(req.body);
    if (!o) return bad(res, `customerName and 1-${MAX_ITEMS} items [{name, price, qty}] are required; status: ${ORDER_STATUSES.join('|')}`);
    const { created } = upsertOrders(db, req.storeId, [{ externalId: id, ...o }], 'api');
    res.status(created ? 201 : 200).json({ ok: true, created: Boolean(created), total: o.total });
  });

  router.get('/conversations', (req, res) => {
    const paging = parsePaging(req.query);
    const { total } = db.prepare('SELECT COUNT(*) AS total FROM conversations WHERE store_id = ?').get(req.storeId);
    const items = db.prepare(`SELECT id, customer_name AS customerName, status, handler, created_at AS createdAt, last_message_at AS lastMessageAt
      FROM conversations WHERE store_id = ? ORDER BY last_message_at DESC LIMIT ? OFFSET ?`).all(req.storeId, paging.per, paging.offset);
    res.json(pageResult(items, total, paging));
  });

  const ownConversation = (req) => db.prepare('SELECT id, customer_name, status, handler, created_at FROM conversations WHERE id = ? AND store_id = ?')
    .get(String(req.params.id), req.storeId);

  router.get('/conversations/:id', (req, res) => {
    const c = ownConversation(req);
    if (!c) return res.status(404).json({ error: 'conversation not found' });
    const messages = db.prepare('SELECT id, role, content, source, created_at AS createdAt FROM messages WHERE conversation_id = ? ORDER BY id').all(c.id);
    res.json({ id: c.id, customerName: c.customer_name, status: c.status, handler: c.handler, createdAt: c.created_at, messages });
  });

  router.post('/conversations/:id/messages', (req, res) => {
    const c = ownConversation(req);
    if (!c) return res.status(404).json({ error: 'conversation not found' });
    const content = validate.text(req.body?.content, 1, MAX_REPLY);
    if (!content) return bad(res, `content: 1-${MAX_REPLY} characters`);
    res.status(201).json({ id: addStaffReply(db, c.id, content) });
  });

  router.get('/webhooks', (req, res) => {
    res.json(db.prepare('SELECT * FROM webhooks WHERE store_id = ? ORDER BY id').all(req.storeId).map(webhookJson));
  });

  router.post('/webhooks', async (req, res, next) => {
    try {
      const result = await createWebhook(db, cipher, req.storeId, req.body, { allowPrivate });
      if (result.error) return bad(res, result.error);
      res.status(201).json(result);
    } catch (err) { next(err); }
  });

  router.delete('/webhooks/:id', (req, res) => {
    const { changes } = db.prepare('DELETE FROM webhooks WHERE id = ? AND store_id = ?').run(validate.id(req.params.id) ?? -1, req.storeId);
    if (!changes) return res.status(404).json({ error: 'webhook not found' });
    res.json({ ok: true });
  });

  return router;
}

module.exports = { publicApiRoutes };
