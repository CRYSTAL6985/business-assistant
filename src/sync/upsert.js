// Writes synced rows. Keyed by (store_id, external_id), so importing the same data twice updates
// instead of duplicating — a failed sync can simply be run again. Each call is one transaction.
const { recordEvent } = require('../events');

function transaction(db, fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/**
 * @param {Array<{ externalId: string, name: string, description: string, category: string, price: number, inStock: boolean, stockQty: number|null }>} rows
 * @param {'woocommerce'|'api'} source
 * @returns {{ created: number, updated: number }}
 */
function upsertProducts(db, storeId, rows, source) {
  const find = db.prepare('SELECT id FROM products WHERE store_id = ? AND external_id = ?');
  const insert = db.prepare(`INSERT INTO products (store_id, external_id, source, name, description, category, price, in_stock, stock_qty, synced_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`);
  const update = db.prepare(`UPDATE products SET source = ?, name = ?, description = ?, category = ?, price = ?, in_stock = ?, stock_qty = ?,
    synced_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`);
  return transaction(db, () => {
    const counts = { created: 0, updated: 0 };
    for (const r of rows) {
      const values = [r.name, r.description, r.category, r.price, r.inStock ? 1 : 0, r.stockQty];
      const existing = find.get(storeId, r.externalId);
      if (existing) { update.run(source, ...values, existing.id); counts.updated++; } else { insert.run(storeId, r.externalId, source, ...values); counts.created++; }
    }
    return counts;
  });
}

/** Removes a synced product (and its variations, "<id>:<variation>"). Local products are never touched. */
function deleteProduct(db, storeId, externalId, source) {
  const { changes } = db.prepare("DELETE FROM products WHERE store_id = ? AND source = ? AND (external_id = ? OR external_id LIKE ? ESCAPE '\\')")
    .run(storeId, source, externalId, `${externalId.replace(/[\\%_]/g, (c) => `\\${c}`)}:%`);
  return Number(changes);
}

/**
 * @param {Array<{ externalId: string, customerName: string, phone: string, address: string, items: object[], total: number, status: string, createdAt: string|null }>} rows
 * @param {{ announce?: boolean }} options announce: add new orders to the activity feed (not for a historical import)
 */
function upsertOrders(db, storeId, rows, source, { announce = true } = {}) {
  const find = db.prepare('SELECT id FROM orders WHERE store_id = ? AND external_id = ?');
  const insert = db.prepare(`INSERT INTO orders (store_id, external_id, source, customer_name, phone, address, items_json, total, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), datetime('now'))`);
  const update = db.prepare(`UPDATE orders SET customer_name = ?, phone = ?, address = ?, items_json = ?, total = ?, status = ?, updated_at = datetime('now') WHERE id = ?`);
  return transaction(db, () => {
    const counts = { created: 0, updated: 0 };
    for (const r of rows) {
      const items = JSON.stringify(r.items);
      const existing = find.get(storeId, r.externalId);
      if (existing) {
        update.run(r.customerName, r.phone, r.address, items, r.total, r.status, existing.id);
        counts.updated++;
      } else {
        const id = Number(insert.run(storeId, r.externalId, source, r.customerName, r.phone, r.address, items, r.total, r.status, r.createdAt).lastInsertRowid);
        if (announce) recordEvent(db, { storeId, type: 'order.created', refId: id, summary: r.customerName });
        counts.created++;
      }
    }
    return counts;
  });
}

module.exports = { upsertProducts, deleteProduct, upsertOrders, transaction };
