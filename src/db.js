// Database layer: one SQLite file, built into Node (node:sqlite), no ORM.
// Every table except sessions belongs to a business through business_id —
// that column is what keeps one shop's data invisible to another (multi-tenancy).
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS businesses (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  slug          TEXT NOT NULL UNIQUE,          -- used in the public chat URL: /chat/<slug>
  name          TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  tone          TEXT NOT NULL DEFAULT 'دوستانه و محترمانه',
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  plan          TEXT NOT NULL DEFAULT 'free',  -- free | pro (see PLAN_LIMITS)
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS products (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price       INTEGER NOT NULL,                -- in toman
  in_stock    INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS faqs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  question    TEXT NOT NULL,
  answer      TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS conversations (
  id          TEXT PRIMARY KEY,                -- random UUID handed to the customer's browser
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL,               -- user | assistant
  content         TEXT NOT NULL,
  source          TEXT,                        -- ai | offline (assistant rows only)
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS orders (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id     INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  conversation_id TEXT,
  customer_name   TEXT NOT NULL,
  phone           TEXT NOT NULL,
  address         TEXT NOT NULL,
  items_json      TEXT NOT NULL,               -- [{id, name, price, qty}] snapshot at order time
  total           INTEGER NOT NULL,
  status          TEXT NOT NULL DEFAULT 'new', -- new | confirmed | sent | cancelled
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  expires_at  INTEGER NOT NULL                 -- unix ms
);
CREATE INDEX IF NOT EXISTS idx_products_business ON products(business_id);
CREATE INDEX IF NOT EXISTS idx_faqs_business ON faqs(business_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_orders_business ON orders(business_id);
`;

/** Opens (and creates if needed) the database. Pass ':memory:' in tests. */
function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  return db;
}

module.exports = { openDb };
