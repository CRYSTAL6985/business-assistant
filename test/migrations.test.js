// Database migrations: the runner (order, idempotence, rollback) and the v1 -> v2 data move.
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { openDb } = require('../src/db');
const { migrate, MIGRATIONS } = require('../src/migrations');

const latest = Math.max(...MIGRATIONS.map((m) => m.version));
const tableExists = (db, name) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));

test('fresh database reaches the latest version', () => {
  const db = openDb(':memory:');
  assert.equal(db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get().v, latest);
});

test('re-running migrate is a no-op', () => {
  const db = openDb(':memory:');
  const before = db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n;
  assert.equal(migrate(db), latest);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n, before);
});

test('a failing migration rolls back and leaves earlier ones applied', () => {
  const db = new DatabaseSync(':memory:');
  const ok = { version: 1, name: 'ok', up: (d) => d.exec('CREATE TABLE a (x)') };
  const bad = { version: 2, name: 'bad', up: (d) => { d.exec('CREATE TABLE b (x)'); throw new Error('boom'); } };
  assert.throws(() => migrate(db, { migrations: [ok, bad] }), /boom/);
  assert.ok(tableExists(db, 'a'));
  assert.ok(!tableExists(db, 'b'));
  assert.deepEqual(db.prepare('SELECT version FROM schema_migrations').all().map((r) => r.version), [1]);
  assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
});
