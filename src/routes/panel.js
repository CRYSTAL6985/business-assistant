// Owner dashboard API for one store. Every route requires login; the store comes from scope.storeFor()
// (?store=<id>, default: the workspace's first store) and every query is filtered by req.store.id —
// an owner can only ever read or change rows of stores in their own workspace.
const express = require('express');
const { requireUser } = require('../auth');
const { usageFor, effectivePlan } = require('../plans');
const { storeFor } = require('../scope');
const { recordEvent } = require('../events');
const validate = require('../validate');

const ORDER_STATUSES = ['new', 'confirmed', 'sent', 'cancelled'];
const RECENT_CONVERSATIONS = 30;

function productInput(body) {
  const name = validate.text(body?.name, 1, 120);
  const description = validate.text(body?.description ?? '', 0, 1000);
  const price = validate.price(body?.price);
  if (name === null || description === null || price === null) return null;
  return { name, description, price, inStock: body?.inStock === false ? 0 : 1 };
}

function faqInput(body) {
  const question = validate.text(body?.question, 2, 300);
  const answer = validate.text(body?.answer, 1, 2000);
  return question && answer ? { question, answer } : null;
}

/** 404 unless the UPDATE/DELETE touched exactly one row (wrong id or another business's row). */
function oneRow(res, info) {
  if (info.changes !== 1) return res.status(404).json({ error: 'پیدا نشد' });
  res.json({ ok: true });
}

function panelRoutes(db) {
  const router = express.Router();
  router.use(requireUser(db));
  router.use((req, res, next) => {
    req.store = storeFor(db, req, validate.id(req.query.store) ?? undefined);
    if (!req.store) return res.status(404).json({ error: 'فروشگاه پیدا نشد' });
    next();
  });

  router.get('/', (req, res) => {
    const storeId = req.store.id;
    const workspace = db.prepare('SELECT id, plan, paid_until FROM workspaces WHERE id = ?').get(req.workspaceId);
    const { email } = db.prepare('SELECT email FROM users WHERE id = ?').get(req.userId);
    const config = JSON.parse(db.prepare('SELECT published_json FROM assistant_configs WHERE store_id = ?').get(storeId)?.published_json ?? '{}');
    const business = {
      id: storeId, slug: req.store.slug, name: req.store.name,
      description: config.description ?? '', tone: config.tone ?? '', email, plan: effectivePlan(workspace),
    };
    const products = db.prepare('SELECT id, name, description, price, in_stock FROM products WHERE store_id = ? ORDER BY id').all(storeId);
    const faqs = db.prepare('SELECT id, question, answer FROM faqs WHERE store_id = ? ORDER BY id').all(storeId);
    const stats = db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM orders WHERE store_id = ? AND status = 'new') AS newOrders,
        (SELECT COUNT(*) FROM conversations WHERE store_id = ?
           AND created_at >= strftime('%Y-%m-01 00:00:00', 'now')) AS conversationsThisMonth
    `).get(storeId, storeId);
    res.json({ business, products, faqs, stats, usage: usageFor(db, workspace) });
  });

  router.put('/business', (req, res) => {
    const name = validate.text(req.body?.name, 2, 80);
    const description = validate.text(req.body?.description ?? '', 0, 1500);
    const tone = validate.text(req.body?.tone, 2, 100);
    if (name === null || description === null || tone === null) return res.status(400).json({ error: 'اطلاعات نامعتبر است' });
        // Merge into the existing settings: the classic panel only knows description and tone.
    const row = db.prepare('SELECT draft_json, published_json FROM assistant_configs WHERE store_id = ?').get(req.store.id);
    const merge = (json) => JSON.stringify({ ...JSON.parse(json ?? '{}'), description, tone });
    db.prepare('UPDATE stores SET name = ? WHERE id = ?').run(name, req.store.id);
    db.prepare("UPDATE assistant_configs SET draft_json = ?, published_json = ?, published_at = datetime('now') WHERE store_id = ?")
      .run(merge(row?.draft_json), merge(row?.published_json), req.store.id);
    res.json({ ok: true });
  });

  router.post('/products', (req, res) => {
    const p = productInput(req.body);
    if (!p) return res.status(400).json({ error: 'نام و قیمت (عدد صحیح) لازم است' });
    const info = db.prepare('INSERT INTO products (store_id, name, description, price, in_stock) VALUES (?, ?, ?, ?, ?)')
      .run(req.store.id, p.name, p.description, p.price, p.inStock);
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });

  router.put('/products/:id', (req, res) => {
    const id = validate.id(req.params.id);
    const p = productInput(req.body);
    if (!id || !p) return res.status(400).json({ error: 'نام و قیمت (عدد صحیح) لازم است' });
    oneRow(res, db.prepare('UPDATE products SET name = ?, description = ?, price = ?, in_stock = ? WHERE id = ? AND store_id = ?')
      .run(p.name, p.description, p.price, p.inStock, id, req.store.id));
  });

  router.delete('/products/:id', (req, res) => {
    oneRow(res, db.prepare('DELETE FROM products WHERE id = ? AND store_id = ?').run(validate.id(req.params.id), req.store.id));
  });

  router.post('/faqs', (req, res) => {
    const f = faqInput(req.body);
    if (!f) return res.status(400).json({ error: 'سؤال و پاسخ لازم است' });
    const info = db.prepare('INSERT INTO faqs (store_id, question, answer) VALUES (?, ?, ?)').run(req.store.id, f.question, f.answer);
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });

  router.put('/faqs/:id', (req, res) => {
    const id = validate.id(req.params.id);
    const f = faqInput(req.body);
    if (!id || !f) return res.status(400).json({ error: 'سؤال و پاسخ لازم است' });
    oneRow(res, db.prepare('UPDATE faqs SET question = ?, answer = ? WHERE id = ? AND store_id = ?')
      .run(f.question, f.answer, id, req.store.id));
  });

  router.delete('/faqs/:id', (req, res) => {
    oneRow(res, db.prepare('DELETE FROM faqs WHERE id = ? AND store_id = ?').run(validate.id(req.params.id), req.store.id));
  });

  router.get('/orders', (req, res) => {
    const rows = db.prepare('SELECT * FROM orders WHERE store_id = ? ORDER BY id DESC').all(req.store.id);
    res.json(rows.map(({ items_json: itemsJson, ...order }) => ({ ...order, items: JSON.parse(itemsJson) })));
  });

  router.put('/orders/:id', (req, res) => {
    const id = validate.id(req.params.id);
    const status = req.body?.status;
    if (!id || !ORDER_STATUSES.includes(status)) return res.status(400).json({ error: 'وضعیت نامعتبر است' });
    const info = db.prepare('UPDATE orders SET status = ? WHERE id = ? AND store_id = ?').run(status, id, req.store.id);
    if (info.changes === 1) recordEvent(db, { storeId: req.store.id, type: 'order.status', refId: id, summary: status });
    oneRow(res, info);
  });

  router.get('/conversations', (req, res) => {
    const conversations = db.prepare('SELECT id, created_at FROM conversations WHERE store_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?')
      .all(req.store.id, RECENT_CONVERSATIONS);
    const messagesOf = db.prepare('SELECT role, content, source, created_at FROM messages WHERE conversation_id = ? ORDER BY id');
    res.json(conversations.map((c) => ({ ...c, messages: messagesOf.all(c.id) })));
  });

  return router;
}

module.exports = { panelRoutes, ORDER_STATUSES };
