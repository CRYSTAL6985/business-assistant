// Products of the workspace's stores. Synced products (WooCommerce / API) are read-only here:
// the source system owns their price and stock.
const express = require('express');
const validate = require('../../validate');
const { requestStores, storeFor, ownedRow } = require('../../scope');
const { parsePaging, pageResult, likePattern } = require('../../paging');

const SORTS = { name: 'p.name', price: 'p.price', '-price': 'p.price DESC', updated: 'COALESCE(p.updated_at, p.synced_at) DESC, p.id DESC' };
const SOURCES = ['local', 'woocommerce', 'api'];
const SOURCE_LABELS = { woocommerce: 'ووکامرس', api: 'API فروشگاه' };
const NOT_FOUND = { error: 'محصول پیدا نشد' };

const syncedError = (source) => ({ error: `این محصول از ${SOURCE_LABELS[source] ?? source} همگام‌سازی می‌شود؛ آن را در همان‌جا تغییر دهید` });
const marks = (ids) => ids.map(() => '?').join(',');

function productInput(body) {
  const name = validate.text(body?.name, 1, 120);
  const description = validate.text(body?.description ?? '', 0, 1000);
  const category = validate.text(body?.category ?? '', 0, 60);
  const price = validate.price(body?.price);
  if (name === null || description === null || category === null || price === null) return null;
  return { name, description, category, price, inStock: body?.inStock === false ? 0 : 1 };
}

const toJson = (row) => ({
  id: row.id, storeId: row.store_id, storeName: row.store_name, name: row.name, description: row.description,
  price: row.price, inStock: Boolean(row.in_stock), category: row.category, source: row.source,
  externalId: row.external_id, stockQty: row.stock_qty, syncedAt: row.synced_at,
});

function productRoutes(db) {
  const router = express.Router();

  router.get('/', (req, res) => {
    const stores = requestStores(db, req);
    if (!stores) return res.status(404).json({ error: 'فروشگاه پیدا نشد' });
    const paging = parsePaging(req.query);
    if (!stores.length) return res.json(pageResult([], 0, paging));
    const where = [`p.store_id IN (${marks(stores)})`];
    const params = stores.map((s) => s.id);
    if (req.query.q) { where.push("(p.name LIKE ? ESCAPE '\\' OR p.description LIKE ? ESCAPE '\\')"); params.push(likePattern(req.query.q), likePattern(req.query.q)); }
    if (req.query.category) { where.push('p.category = ?'); params.push(String(req.query.category)); }
    if (req.query.stock === 'in' || req.query.stock === 'out') { where.push('p.in_stock = ?'); params.push(req.query.stock === 'in' ? 1 : 0); }
    if (SOURCES.includes(req.query.source)) { where.push('p.source = ?'); params.push(req.query.source); }
    const clause = where.join(' AND ');
    const { total } = db.prepare(`SELECT COUNT(*) AS total FROM products p WHERE ${clause}`).get(...params);
    const rows = db.prepare(`SELECT p.*, s.name AS store_name FROM products p JOIN stores s ON s.id = p.store_id
      WHERE ${clause} ORDER BY ${SORTS[req.query.sort] ?? 'p.id DESC'} LIMIT ? OFFSET ?`).all(...params, paging.per, paging.offset);
    res.json(pageResult(rows.map(toJson), total, paging));
  });

  router.get('/categories', (req, res) => {
    const stores = requestStores(db, req);
    if (!stores) return res.status(404).json({ error: 'فروشگاه پیدا نشد' });
    if (!stores.length) return res.json([]);
    const rows = db.prepare(`SELECT DISTINCT category FROM products WHERE store_id IN (${marks(stores)}) AND category != '' ORDER BY category`).all(...stores.map((s) => s.id));
    res.json(rows.map((r) => r.category));
  });

  router.post('/', (req, res) => {
    const store = storeFor(db, req, validate.id(req.body?.storeId) ?? -1);
    if (!store) return res.status(404).json({ error: 'فروشگاه پیدا نشد' });
    const p = productInput(req.body);
    if (!p) return res.status(400).json({ error: 'نام و قیمت (عدد صحیح به تومان) لازم است' });
    const info = db.prepare("INSERT INTO products (store_id, name, description, category, price, in_stock, updated_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))")
      .run(store.id, p.name, p.description, p.category, p.price, p.inStock);
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });

  router.put('/:id', (req, res) => {
    const row = ownedRow(db, req, 'products', validate.id(req.params.id));
    if (!row) return res.status(404).json(NOT_FOUND);
    if (row.source !== 'local') return res.status(409).json(syncedError(row.source));
    const p = productInput(req.body);
    if (!p) return res.status(400).json({ error: 'نام و قیمت (عدد صحیح به تومان) لازم است' });
    db.prepare("UPDATE products SET name = ?, description = ?, category = ?, price = ?, in_stock = ?, updated_at = datetime('now') WHERE id = ?")
      .run(p.name, p.description, p.category, p.price, p.inStock, row.id);
    res.json({ ok: true });
  });

  router.delete('/:id', (req, res) => {
    const row = ownedRow(db, req, 'products', validate.id(req.params.id));
    if (!row) return res.status(404).json(NOT_FOUND);
    if (row.source !== 'local') return res.status(409).json(syncedError(row.source));
    db.prepare('DELETE FROM products WHERE id = ?').run(row.id);
    res.json({ ok: true });
  });

  return router;
}

module.exports = { productRoutes };
