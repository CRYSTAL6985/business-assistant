// Orders of the workspace's stores. Totals and items are never editable (the server computed them);
// owners change the status of orders the assistant took. Synced orders follow their source system.
const express = require('express');
const validate = require('../../validate');
const { requestStores, ownedRow } = require('../../scope');
const { parsePaging, pageResult, likePattern } = require('../../paging');
const { resolveRange } = require('../../time');
const { recordEvent } = require('../../events');
const { ORDER_STATUSES } = require('../panel');

const SORTS = { '-created': 'o.id DESC', created: 'o.id', '-total': 'o.total DESC, o.id DESC', total: 'o.total, o.id' };
const SOURCES = ['assistant', 'woocommerce', 'api'];
const SOURCE_LABELS = { woocommerce: 'ووکامرس', api: 'API فروشگاه' };
const ORDER_NUMBER = /^#?(\d+)$/;
const marks = (ids) => ids.map(() => '?').join(',');
const latinDigits = (s) => String(s).replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));

const listJson = (o) => ({
  id: o.id, storeId: o.store_id, storeName: o.store_name, customerName: o.customer_name, phone: o.phone,
  total: o.total, status: o.status, source: o.source, itemCount: o.item_count, createdAt: o.created_at,
});

function orderRoutes(db) {
  const router = express.Router();

  router.get('/', (req, res) => {
    const stores = requestStores(db, req);
    if (!stores) return res.status(404).json({ error: 'فروشگاه پیدا نشد' });
    const paging = parsePaging(req.query);
    if (!stores.length) return res.json(pageResult([], 0, paging));
    const where = [`o.store_id IN (${marks(stores)})`];
    const params = stores.map((s) => s.id);
    if (ORDER_STATUSES.includes(req.query.status)) { where.push('o.status = ?'); params.push(req.query.status); }
    if (SOURCES.includes(req.query.source)) { where.push('o.source = ?'); params.push(req.query.source); }
    if (req.query.from || req.query.to) {
      const range = resolveRange({ range: 'custom', from: req.query.from, to: req.query.to });
      if (range.error) return res.status(400).json({ error: range.error });
      where.push('o.created_at >= ? AND o.created_at < ?');
      params.push(range.start, range.end);
    }
    const q = req.query.q ? latinDigits(String(req.query.q).trim()) : '';
    if (q) {
      const number = q.match(ORDER_NUMBER);
      if (q.startsWith('#') && number) {
        where.push('o.id = ?'); // "#12" means order number 12, not phones containing 12
        params.push(Number(number[1]));
      } else {
        where.push(`(o.customer_name LIKE ? ESCAPE '\\' OR o.phone LIKE ? ESCAPE '\\'${number ? ' OR o.id = ?' : ''})`);
        params.push(likePattern(q), likePattern(q), ...(number ? [Number(number[1])] : []));
      }
    }
    const clause = where.join(' AND ');
    const { total } = db.prepare(`SELECT COUNT(*) AS total FROM orders o WHERE ${clause}`).get(...params);
    const rows = db.prepare(`SELECT o.*, s.name AS store_name, json_array_length(o.items_json) AS item_count
      FROM orders o JOIN stores s ON s.id = o.store_id WHERE ${clause} ORDER BY ${SORTS[req.query.sort] ?? SORTS['-created']} LIMIT ? OFFSET ?`)
      .all(...params, paging.per, paging.offset);
    res.json(pageResult(rows.map(listJson), total, paging));
  });

  router.get('/:id', (req, res) => {
    const o = ownedRow(db, req, 'orders', validate.id(req.params.id));
    if (!o) return res.status(404).json({ error: 'سفارش پیدا نشد' });
    const items = JSON.parse(o.items_json);
    res.json({
      ...listJson({ ...o, item_count: items.length }), address: o.address, items,
      conversationId: o.conversation_id, externalId: o.external_id, updatedAt: o.updated_at,
    });
  });

  router.put('/:id/status', (req, res) => {
    const o = ownedRow(db, req, 'orders', validate.id(req.params.id));
    if (!o) return res.status(404).json({ error: 'سفارش پیدا نشد' });
    if (o.source !== 'assistant') return res.status(409).json({ error: `این سفارش از ${SOURCE_LABELS[o.source] ?? o.source} همگام‌سازی می‌شود؛ وضعیت را در همان‌جا تغییر دهید` });
    const status = req.body?.status;
    if (!ORDER_STATUSES.includes(status)) return res.status(400).json({ error: 'وضعیت نامعتبر است' });
    db.prepare("UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, o.id);
    recordEvent(db, { storeId: o.store_id, type: 'order.status', refId: o.id, summary: status });
    res.json({ ok: true });
  });

  return router;
}

module.exports = { orderRoutes };
