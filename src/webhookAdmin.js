// Creating outbound webhooks — shared by the owner panel and the public API. The signing secret is
// returned once at creation and stored encrypted (we need it again to sign each delivery).
const crypto = require('node:crypto');
const { checkUrl } = require('./safeUrl');
const { EVENTS } = require('./outbound');

const MAX_WEBHOOKS_PER_STORE = 10;

const webhookJson = (h) => ({ id: h.id, url: h.url, events: h.events.split(','), active: Boolean(h.active), lastStatus: h.last_status, lastAttemptAt: h.last_attempt_at, createdAt: h.created_at });

/** @returns {Promise<{ error: string } | { id: number, url: string, events: string[], secret: string }>} */
async function createWebhook(db, cipher, storeId, body, { allowPrivate }) {
  const events = Array.isArray(body?.events) ? [...new Set(body.events)] : [];
  if (!events.length || events.some((e) => !EVENTS.includes(e))) return { error: `events: one or more of ${EVENTS.join(', ')}` };
  const safe = await checkUrl(body?.url, { allowPrivate });
  if (!safe.ok) return { error: safe.error };
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM webhooks WHERE store_id = ?').get(storeId);
  if (n >= MAX_WEBHOOKS_PER_STORE) return { error: `حداکثر ${MAX_WEBHOOKS_PER_STORE.toLocaleString('fa-IR')} وب‌هوک برای هر فروشگاه` };
  const secret = `whsec_${crypto.randomBytes(24).toString('base64url')}`;
  const info = db.prepare('INSERT INTO webhooks (store_id, url, secret_enc, events) VALUES (?, ?, ?, ?)').run(storeId, safe.url, cipher.encrypt(secret), events.join(','));
  return { id: Number(info.lastInsertRowid), url: safe.url, events, secret };
}

module.exports = { createWebhook, webhookJson };
