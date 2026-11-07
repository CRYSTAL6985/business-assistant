// Database layer: one SQLite file, built into Node (node:sqlite), no ORM.
// The schema lives in src/migrations/ — numbered steps applied in order when the file is opened.
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { migrate } = require('./migrations');

/** Opens (and creates if needed) the database and brings it to the latest schema. Pass ':memory:' in tests. */
function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  migrate(db);
  return db;
}

module.exports = { openDb };
