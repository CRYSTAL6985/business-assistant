// API keys for a shop's own site: "ba_<prefix>_<secret>". The full key is shown to the owner once;
// we keep only the prefix (to find the row) and a SHA-256 hash (to check it).
const crypto = require('node:crypto');
const { sha256, safeEqual } = require('./crypto');

const KEY_PATTERN = /^ba_([a-f0-9]{12})_([A-Za-z0-9_-]{32,})$/;

/** @returns {{ id: number, key: string, prefix: string }} */
function createApiKey(db, storeId, label) {
  const prefix = crypto.randomBytes(6).toString('hex');
  const key = `ba_${prefix}_${crypto.randomBytes(24).toString('base64url')}`;
  const info = db.prepare('INSERT INTO api_keys (store_id, prefix, key_hash, label) VALUES (?, ?, ?, ?)').run(storeId, prefix, sha256(key), label);
  return { id: Number(info.lastInsertRowid), key, prefix };
}

/** The store id an Authorization header's key belongs to, or null (unknown, revoked, malformed). */
function storeForKey(db, header) {
  const key = String(header ?? '').replace(/^Bearer\s+/i, '').trim();
  const match = key.match(KEY_PATTERN);
  if (!match) return null;
  const row = db.prepare('SELECT id, store_id, key_hash FROM api_keys WHERE prefix = ? AND revoked_at IS NULL').get(match[1]);
  if (!row || !safeEqual(row.key_hash, sha256(key))) return null;
  db.prepare("UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?").run(row.id);
  return row.store_id;
}

module.exports = { createApiKey, storeForKey };
