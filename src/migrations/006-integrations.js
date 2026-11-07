// Version 6: integrations. A store may connect WooCommerce (encrypted keys, sync history), call our
// public API with its own keys, and receive signed webhooks. Secrets are stored encrypted (crypto.js);
// API keys only as a SHA-256 hash, so a database leak does not leak working keys.
module.exports = {
  version: 6,
  name: 'integrations',
  up(db) {
    db.exec(`
      CREATE TABLE integrations (
        id                 INTEGER PRIMARY KEY AUTOINCREMENT,
        store_id           INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
        type               TEXT NOT NULL,                     -- woocommerce
        site_url           TEXT NOT NULL,
        credentials_enc    TEXT NOT NULL,                     -- {"key","secret"} encrypted
        webhook_secret_enc TEXT NOT NULL,                     -- signs WooCommerce -> us webhooks
        webhooks_ok        INTEGER NOT NULL DEFAULT 0,        -- 1 = WooCommerce accepted our webhooks
        currency           TEXT,
        status             TEXT NOT NULL DEFAULT 'pending',   -- pending | ok | error
        last_ok_at         TEXT,
        last_error         TEXT,
        last_sync_at       TEXT,                              -- start of the last successful sync (incremental cursor)
        created_at         TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (store_id, type)
      );

      CREATE TABLE sync_runs (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        store_id    INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
        kind        TEXT NOT NULL,                            -- full | incremental
        status      TEXT NOT NULL DEFAULT 'running',          -- running | ok | error
        started_at  TEXT NOT NULL DEFAULT (datetime('now')),
        finished_at TEXT,
        created     INTEGER NOT NULL DEFAULT 0,
        updated     INTEGER NOT NULL DEFAULT 0,
        error       TEXT
      );
      CREATE INDEX idx_sync_runs_store ON sync_runs(store_id, id);

      CREATE TABLE api_keys (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        store_id     INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
        prefix       TEXT NOT NULL UNIQUE,
        key_hash     TEXT NOT NULL,
        label        TEXT NOT NULL DEFAULT '',
        created_at   TEXT NOT NULL DEFAULT (datetime('now')),
        last_used_at TEXT,
        revoked_at   TEXT
      );
      CREATE INDEX idx_api_keys_store ON api_keys(store_id);

      CREATE TABLE webhooks (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        store_id        INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
        url             TEXT NOT NULL,
        secret_enc      TEXT NOT NULL,
        events          TEXT NOT NULL,                        -- comma list: order.created,conversation.waiting
        active          INTEGER NOT NULL DEFAULT 1,
        last_status     TEXT,
        last_attempt_at TEXT,
        created_at      TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_webhooks_store ON webhooks(store_id);

      ALTER TABLE conversations ADD COLUMN waiting_notified_at TEXT;  -- conversation.waiting sent for the current wait
    `);
  },
};
