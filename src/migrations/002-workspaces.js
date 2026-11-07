// Version 2: one business -> user + workspace + store.
// Each old business id is reused as its user, workspace and store id, so child rows keep pointing at
// the right owner: their business_id column simply becomes store_id. The slug moves to the store,
// which keeps every existing /chat/<slug> link and widget snippet working.
// Old sessions are dropped (they pointed at businesses): owners just log in again.

const NEW_TABLES = `
CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL DEFAULT '',
  is_operator   INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE workspaces (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  plan       TEXT NOT NULL DEFAULT 'free',   -- see PLAN_LIMITS in plans.js
  paid_until TEXT,                            -- NULL = no expiry; past date = treated as free
  status     TEXT NOT NULL DEFAULT 'active',  -- active | suspended
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE workspace_members (
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role         TEXT NOT NULL DEFAULT 'owner', -- owner | member
  PRIMARY KEY (workspace_id, user_id)
);
CREATE TABLE stores (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id    INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  slug            TEXT NOT NULL UNIQUE,       -- public id: /chat/<slug>, widget data-business
  name            TEXT NOT NULL,
  domain          TEXT NOT NULL DEFAULT '',
  platform        TEXT NOT NULL DEFAULT 'widget', -- widget | woocommerce | custom
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  disconnected_at TEXT
);
CREATE TABLE assistant_configs (
  store_id       INTEGER PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
  draft_json     TEXT NOT NULL DEFAULT '{}',  -- what the owner is editing
  published_json TEXT NOT NULL DEFAULT '{}',  -- what customers get
  published_at   TEXT
);
`;

const COPY_ACCOUNTS = `
INSERT INTO users (id, email, password_hash, name, created_at)
  SELECT id, email, password_hash, name, created_at FROM businesses;
INSERT INTO workspaces (id, name, plan, created_at)
  SELECT id, name, plan, created_at FROM businesses;
INSERT INTO workspace_members (workspace_id, user_id, role)
  SELECT id, id, 'owner' FROM businesses;
INSERT INTO stores (id, workspace_id, slug, name, created_at)
  SELECT id, id, slug, name, created_at FROM businesses;
INSERT INTO assistant_configs (store_id, draft_json, published_json, published_at)
  SELECT id, json_object('description', description, 'tone', tone),
             json_object('description', description, 'tone', tone), datetime('now')
  FROM businesses;
`;

// Child tables rebuilt with store_id (SQLite can't change a column's REFERENCES in place).
const REBUILD_CHILDREN = `
CREATE TABLE products_new (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id    INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price       INTEGER NOT NULL,                -- in toman
  in_stock    INTEGER NOT NULL DEFAULT 1
);
INSERT INTO products_new (id, store_id, name, description, price, in_stock)
  SELECT id, business_id, name, description, price, in_stock FROM products;
DROP TABLE products;
ALTER TABLE products_new RENAME TO products;

CREATE TABLE faqs_new (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  answer   TEXT NOT NULL
);
INSERT INTO faqs_new (id, store_id, question, answer) SELECT id, business_id, question, answer FROM faqs;
DROP TABLE faqs;
ALTER TABLE faqs_new RENAME TO faqs;

CREATE TABLE conversations_new (
  id         TEXT PRIMARY KEY,                 -- random UUID handed to the customer's browser
  store_id   INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO conversations_new (id, store_id, created_at) SELECT id, business_id, created_at FROM conversations;
DROP TABLE conversations;
ALTER TABLE conversations_new RENAME TO conversations;

CREATE TABLE orders_new (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id        INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  conversation_id TEXT,
  customer_name   TEXT NOT NULL,
  phone           TEXT NOT NULL,
  address         TEXT NOT NULL,
  items_json      TEXT NOT NULL,               -- [{id, name, price, qty}] snapshot at order time
  total           INTEGER NOT NULL,
  status          TEXT NOT NULL DEFAULT 'new', -- new | confirmed | sent | cancelled
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO orders_new (id, store_id, conversation_id, customer_name, phone, address, items_json, total, status, created_at)
  SELECT id, business_id, conversation_id, customer_name, phone, address, items_json, total, status, created_at FROM orders;
DROP TABLE orders;
ALTER TABLE orders_new RENAME TO orders;
`;

const SESSIONS_AND_CLEANUP = `
DROP TABLE sessions;
CREATE TABLE sessions (
  token               TEXT PRIMARY KEY,
  user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  active_workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  expires_at          INTEGER NOT NULL           -- unix ms
);
DROP TABLE businesses;

CREATE INDEX idx_products_store ON products(store_id);
CREATE INDEX idx_faqs_store ON faqs(store_id);
CREATE INDEX idx_orders_store_created ON orders(store_id, created_at);
CREATE INDEX idx_conversations_store_created ON conversations(store_id, created_at);
CREATE INDEX idx_stores_workspace ON stores(workspace_id);
CREATE INDEX idx_members_user ON workspace_members(user_id);
`;

/**
 * Rebuilding a table resets its AUTOINCREMENT counter to the highest id still present, which would
 * hand out ids of deleted rows again (a customer could get an order number someone already had).
 * Restore each counter to at least its old value.
 */
function restoreCounters(db, saved) {
  const counters = {
    products: saved.products, faqs: saved.faqs, orders: saved.orders,
    users: saved.businesses, workspaces: saved.businesses, stores: saved.businesses,
  };
  const update = db.prepare('UPDATE sqlite_sequence SET seq = MAX(seq, ?) WHERE name = ?');
  const insert = db.prepare('INSERT INTO sqlite_sequence (name, seq) SELECT ?, ? WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = ?)');
  for (const [table, seq] of Object.entries(counters)) {
    if (!seq) continue;
    update.run(seq, table);
    insert.run(table, seq, table);
  }
}

module.exports = {
  version: 2,
  name: 'workspaces',
  up(db) {
    const hasSequence = db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'sqlite_sequence'").get();
    const saved = hasSequence
      ? Object.fromEntries(db.prepare('SELECT name, seq FROM sqlite_sequence').all().map((r) => [r.name, r.seq]))
      : {};
    db.exec(NEW_TABLES);
    db.exec(COPY_ACCOUNTS);
    db.exec(REBUILD_CHILDREN);
    db.exec(SESSIONS_AND_CLEANUP);
    restoreCounters(db, saved);
  },
};
