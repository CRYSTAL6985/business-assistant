// Knowledge base: FAQs and policies per store. The assistant answers only from these and the products.
const express = require('express');
const validate = require('../../validate');
const { requestStores, storeFor, ownedRow } = require('../../scope');
const { parsePaging, pageResult, likePattern } = require('../../paging');

const NOT_FOUND = { error: 'پرسش پیدا نشد' };
const INVALID = { error: 'پرسش (۲ تا ۳۰۰ حرف) و پاسخ (تا ۲۰۰۰ حرف) لازم است' };
const marks = (ids) => ids.map(() => '?').join(',');

function faqInput(body) {
  const question = validate.text(body?.question, 2, 300);
  const answer = validate.text(body?.answer, 1, 2000);
  return question && answer ? { question, answer } : null;
}

function faqRoutes(db) {
  const router = express.Router();

  router.get('/', (req, res) => {
    const stores = requestStores(db, req);
    if (!stores) return res.status(404).json({ error: 'فروشگاه پیدا نشد' });
    const paging = parsePaging(req.query);
    if (!stores.length) return res.json(pageResult([], 0, paging));
    const where = [`f.store_id IN (${marks(stores)})`];
    const params = stores.map((s) => s.id);
    if (req.query.q) { where.push("(f.question LIKE ? ESCAPE '\\' OR f.answer LIKE ? ESCAPE '\\')"); params.push(likePattern(req.query.q), likePattern(req.query.q)); }
    const clause = where.join(' AND ');
    const { total } = db.prepare(`SELECT COUNT(*) AS total FROM faqs f WHERE ${clause}`).get(...params);
    const rows = db.prepare(`SELECT f.id, f.store_id AS storeId, s.name AS storeName, f.question, f.answer FROM faqs f JOIN stores s ON s.id = f.store_id
      WHERE ${clause} ORDER BY f.id LIMIT ? OFFSET ?`).all(...params, paging.per, paging.offset);
    res.json(pageResult(rows, total, paging));
  });

  router.post('/', (req, res) => {
    const store = storeFor(db, req, validate.id(req.body?.storeId) ?? -1);
    if (!store) return res.status(404).json({ error: 'فروشگاه پیدا نشد' });
    const f = faqInput(req.body);
    if (!f) return res.status(400).json(INVALID);
    const info = db.prepare('INSERT INTO faqs (store_id, question, answer) VALUES (?, ?, ?)').run(store.id, f.question, f.answer);
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });

  router.put('/:id', (req, res) => {
    const row = ownedRow(db, req, 'faqs', validate.id(req.params.id));
    if (!row) return res.status(404).json(NOT_FOUND);
    const f = faqInput(req.body);
    if (!f) return res.status(400).json(INVALID);
    db.prepare('UPDATE faqs SET question = ?, answer = ? WHERE id = ?').run(f.question, f.answer, row.id);
    res.json({ ok: true });
  });

  router.delete('/:id', (req, res) => {
    const row = ownedRow(db, req, 'faqs', validate.id(req.params.id));
    if (!row) return res.status(404).json(NOT_FOUND);
    db.prepare('DELETE FROM faqs WHERE id = ?').run(row.id);
    res.json({ ok: true });
  });

  return router;
}

module.exports = { faqRoutes };
