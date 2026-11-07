// Version 7: manual payments recorded by the operator, and sessions that may have no workspace
// (the operator's own login). Sessions are rebuilt (SQLite can't drop NOT NULL in place), so
// everyone signs in again once.
module.exports = {
  version: 7,
  name: 'payments-operator',
  up(db) {
    db.exec(`
      CREATE TABLE payments (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        amount       INTEGER NOT NULL,                 -- toman
        note         TEXT NOT NULL DEFAULT '',
        period_end   TEXT NOT NULL,                    -- paid until (UTC "YYYY-MM-DD HH:MM:SS")
        recorded_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at   TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_payments_workspace ON payments(workspace_id, id);

      DROP TABLE sessions;
      CREATE TABLE sessions (
        token               TEXT PRIMARY KEY,
        user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        active_workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE,  -- NULL = operator-only login
        expires_at          INTEGER NOT NULL                                      -- unix ms
      );
      CREATE INDEX idx_sessions_user ON sessions(user_id);

      CREATE INDEX idx_events_store_type ON events(store_id, type, created_at);
    `);
  },
};
