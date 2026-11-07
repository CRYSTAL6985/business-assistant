// Migration runner. Each migration is { version, name, up(db) }; pending ones run in version order,
// each inside its own transaction, so a failure leaves the database exactly as it was before that step.
const MIGRATIONS = [
  require('./001-initial'),
  require('./002-workspaces'),
];

/**
 * Applies every migration newer than the database's current version.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ to?: number, migrations?: Array<{version:number,name:string,up:Function}> }} [options]
 * @returns {number} the version the database is at afterwards
 */
function migrate(db, { to = Infinity, migrations = MIGRATIONS } = {}) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  const applied = new Set(db.prepare('SELECT version FROM schema_migrations').all().map((r) => r.version));
  const pending = [...migrations].sort((a, b) => a.version - b.version)
    .filter((m) => !applied.has(m.version) && m.version <= to);

  for (const migration of pending) {
    // Table rebuilds need foreign keys off, and the pragma can't change inside a transaction.
    db.exec('PRAGMA foreign_keys = OFF');
    let began = false; // own flag instead of db.isTransaction, which only exists from Node 22.16
    try {
      db.exec('BEGIN');
      began = true;
      migration.up(db);
      db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(migration.version, migration.name);
      const broken = db.prepare('PRAGMA foreign_key_check').all();
      if (broken.length) throw new Error(`migration ${migration.version} left ${broken.length} broken foreign keys`);
      db.exec('COMMIT');
    } catch (err) {
      if (began) db.exec('ROLLBACK');
      throw err;
    } finally {
      db.exec('PRAGMA foreign_keys = ON');
    }
  }
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get();
  return row.v ?? 0;
}

module.exports = { migrate, MIGRATIONS };
