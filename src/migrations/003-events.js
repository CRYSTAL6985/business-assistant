// Version 3: the activity feed. One row per thing that happened in a store, newest read first.
// Existing orders and conversations are backfilled so the feed isn't empty after upgrading.
module.exports = {
  version: 3,
  name: 'events',
  up(db) {
    db.exec(`
      CREATE TABLE events (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        store_id     INTEGER REFERENCES stores(id) ON DELETE CASCADE,
        type         TEXT NOT NULL,              -- order.created | order.status | conversation.started
        ref_id       TEXT,                       -- id of the order / conversation
        summary      TEXT NOT NULL DEFAULT '',
        created_at   TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_events_workspace_created ON events(workspace_id, created_at);
      CREATE INDEX idx_events_store_created ON events(store_id, created_at);

      INSERT INTO events (workspace_id, store_id, type, ref_id, summary, created_at)
        SELECT s.workspace_id, c.store_id, 'conversation.started', c.id, '', c.created_at
        FROM conversations c JOIN stores s ON s.id = c.store_id;
      INSERT INTO events (workspace_id, store_id, type, ref_id, summary, created_at)
        SELECT s.workspace_id, o.store_id, 'order.created', CAST(o.id AS TEXT), o.customer_name, o.created_at
        FROM orders o JOIN stores s ON s.id = o.store_id;
    `);
  },
};
