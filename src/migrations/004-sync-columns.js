// Version 4: columns for data that comes from outside (WooCommerce, a shop's own API).
// external_id is the id in the source system; UNIQUE(store_id, external_id) makes syncing idempotent
// (re-importing updates the same row). Rows created here keep external_id NULL.
module.exports = {
  version: 4,
  name: 'sync-columns',
  up(db) {
    db.exec(`
      ALTER TABLE products ADD COLUMN external_id TEXT;
      ALTER TABLE products ADD COLUMN source TEXT NOT NULL DEFAULT 'local';      -- local | woocommerce | api
      ALTER TABLE products ADD COLUMN category TEXT NOT NULL DEFAULT '';
      ALTER TABLE products ADD COLUMN stock_qty INTEGER;                         -- NULL = not tracked
      ALTER TABLE products ADD COLUMN synced_at TEXT;
      ALTER TABLE products ADD COLUMN updated_at TEXT;
      CREATE UNIQUE INDEX idx_products_external ON products(store_id, external_id);

      ALTER TABLE orders ADD COLUMN external_id TEXT;
      ALTER TABLE orders ADD COLUMN source TEXT NOT NULL DEFAULT 'assistant';    -- assistant | woocommerce | api
      ALTER TABLE orders ADD COLUMN updated_at TEXT;
      CREATE UNIQUE INDEX idx_orders_external ON orders(store_id, external_id);
      CREATE INDEX idx_orders_store_status ON orders(store_id, status);
    `);
  },
};
