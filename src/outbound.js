// Outbound webhooks: tells a shop's own system that something happened (order.created,
// conversation.waiting). The body is signed so the receiver can check it came from us:
//   X-Signature: sha256=<hex HMAC-SHA256 of the raw body with the webhook's secret>
// Delivery never blocks the caller; each webhook gets 3 attempts and its last status is stored.
const { hmac } = require('./crypto');
const { checkUrl } = require('./safeUrl');

const EVENTS = ['order.created', 'conversation.waiting'];
const ATTEMPT_DELAYS_MS = [0, 5_000, 30_000];
const TIMEOUT_MS = 10_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {{ db, cipher, fetch?: typeof fetch, allowPrivate?: boolean, delays?: number[] }} deps
 */
function createOutbound({ db, cipher, fetch: doFetch = fetch, allowPrivate = false, delays = ATTEMPT_DELAYS_MS }) {
  const setStatus = db.prepare("UPDATE webhooks SET last_status = ?, last_attempt_at = datetime('now') WHERE id = ?");

  async function deliver(hook, event, body) {
    const signature = `sha256=${hmac(cipher.decrypt(hook.secret_enc), body)}`;
    for (const delay of delays) {
      await sleep(delay);
      const safe = await checkUrl(hook.url, { allowPrivate });
      if (!safe.ok) { setStatus.run(safe.error, hook.id); return false; }
      try {
        const res = await doFetch(safe.url, {
          method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS),
          headers: { 'Content-Type': 'application/json', 'X-Event': event, 'X-Signature': signature },
          body,
        });
        setStatus.run(`HTTP ${res.status}`, hook.id);
        if (res.ok) return true;
      } catch {
        setStatus.run('در دسترس نبود', hook.id);
      }
    }
    return false;
  }

  return {
    /** Fire-and-forget; returns the delivery promises (tests await them). */
    emit(storeId, event, data) {
      const hooks = db.prepare('SELECT * FROM webhooks WHERE store_id = ? AND active = 1').all(storeId)
        .filter((h) => h.events.split(',').includes(event));
      const body = JSON.stringify({ event, createdAt: new Date().toISOString(), data });
      return hooks.map((hook) => deliver(hook, event, body).catch((err) => { console.error('[outbound]', err); return false; }));
    },
  };
}

module.exports = { createOutbound, EVENTS };
