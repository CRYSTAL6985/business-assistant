// Business-owner dashboard API. Every route requires login, and every query is filtered by
// req.businessId — an owner can only ever read or change their own business's rows.
const express = require('express');
const { requireAuth } = require('../auth');
const { usageFor } = require('../plans');
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
  router.use(requireAuth(db));

  router.get('/', (req, res) => {
    const business = db.prepare('SELECT id, slug, name, description, tone, email, plan FROM businesses WHERE id = ?').get(req.businessId);
    const products = db.prepare('SELECT id, name, description, price, in_stock FROM products WHERE business_id = ? ORDER BY id').all(req.businessId);
    const faqs = db.prepare('SELECT id, question, answer FROM faqs WHERE business_id = ? ORDER BY id').all(req.businessId);
    const stats = db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM orders WHERE business_id = ? AND status = 'new') AS newOrders,
        (SELECT COUNT(*) FROM conversations WHERE business_id = ?
           AND created_at >= strftime('%Y-%m-01 00:00:00', 'now')) AS conversationsThisMonth
    `).get(req.businessId, req.businessId);
    res.json({ business, products, faqs, stats, usage: usageFor(db, business) });
  });

  router.put('/business', (req, res) => {
    const name = validate.text(req.body?.name, 2, 80);
    const description = validate.text(req.body?.description ?? '', 0, 1500);
    const tone = validate.text(req.body?.tone, 2, 100);
    if (name === null || description === null || tone === null) return res.status(400).json({ error: 'اطلاعات نامعتبر است' });
    db.prepare('UPDATE businesses SET name = ?, description = ?, tone = ? WHERE id = ?').run(name, description, tone, req.businessId);
    res.json({ ok: true });
  });

  router.post('/products', (req, res) => {
    const p = productInput(req.body);
    if (!p) return res.status(400).json({ error: 'نام و قیمت (عدد صحیح) لازم است' });
    const info = db.prepare('INSERT INTO products (business_id, name, description, price, in_stock) VALUES (?, ?, ?, ?, ?)')
      .run(req.businessId, p.name, p.description, p.price, p.inStock);
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });

  router.put('/products/:id', (req, res) => {
    const id = validate.id(req.params.id);
    const p = productInput(req.body);
    if (!id || !p) return res.status(400).json({ error: 'نام و قیمت (عدد صحیح) لازم است' });
    oneRow(res, db.prepare('UPDATE products SET name = ?, description = ?, price = ?, in_stock = ? WHERE id = ? AND business_id = ?')
      .run(p.name, p.description, p.price, p.inStock, id, req.businessId));
  });

  router.delete('/products/:id', (req, res) => {
    oneRow(res, db.prepare('DELETE FROM products WHERE id = ? AND business_id = ?').run(validate.id(req.params.id), req.businessId));
  });

  router.post('/faqs', (req, res) => {
    const f = faqInput(req.body);
    if (!f) return res.status(400).json({ error: 'سؤال و پاسخ لازم است' });
    const info = db.prepare('INSERT INTO faqs (business_id, question, answer) VALUES (?, ?, ?)').run(req.businessId, f.question, f.answer);
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });

  router.put('/faqs/:id', (req, res) => {
    const id = validate.id(req.params.id);
    const f = faqInput(req.body);
    if (!id || !f) return res.status(400).json({ error: 'سؤال و پاسخ لازم است' });
    oneRow(res, db.prepare('UPDATE faqs SET question = ?, answer = ? WHERE id = ? AND business_id = ?')
      .run(f.question, f.answer, id, req.businessId));
  });

  router.delete('/faqs/:id', (req, res) => {
    oneRow(res, db.prepare('DELETE FROM faqs WHERE id = ? AND business_id = ?').run(validate.id(req.params.id), req.businessId));
  });

  router.get('/orders', (req, res) => {
    const rows = db.prepare('SELECT * FROM orders WHERE business_id = ? ORDER BY id DESC').all(req.businessId);
    res.json(rows.map(({ items_json: itemsJson, ...order }) => ({ ...order, items: JSON.parse(itemsJson) })));
  });

  router.put('/orders/:id', (req, res) => {
    const id = validate.id(req.params.id);
    const status = req.body?.status;
    if (!id || !ORDER_STATUSES.includes(status)) return res.status(400).json({ error: 'وضعیت نامعتبر است' });
    oneRow(res, db.prepare('UPDATE orders SET status = ? WHERE id = ? AND business_id = ?').run(status, id, req.businessId));
  });

  router.get('/conversations', (req, res) => {
    const conversations = db.prepare('SELECT id, created_at FROM conversations WHERE business_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?')
      .all(req.businessId, RECENT_CONVERSATIONS);
    const messagesOf = db.prepare('SELECT role, content, source, created_at FROM messages WHERE conversation_id = ? ORDER BY id');
    res.json(conversations.map((c) => ({ ...c, messages: messagesOf.all(c.id) })));
  });

  return router;
}

module.exports = { panelRoutes, ORDER_STATUSES };
