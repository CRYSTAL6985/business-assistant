// Background timer (production process only, not in tests): every minute it starts WooCommerce syncs
// that are due (safety net next to webhooks) and sends conversation.waiting to shops that asked for it.
const { toSqlite } = require('./time');
const { effectivePlan, PLAN_LIMITS } = require('./plans');

const TICK_MS = 60_000;
const SYNC_EVERY_MS = 15 * 60_000;
const WAITING_AFTER_MS = 10 * 60_000; // same rule as the inbox and the attention center

function dueSyncs(db, now) {
  // Due = no run started in the last 15 minutes (successful or not, so a broken key isn't hammered).
  return db.prepare(`
    SELECT i.store_id AS storeId, w.plan, w.paid_until
    FROM integrations i JOIN stores s ON s.id = i.store_id JOIN workspaces w ON w.id = s.workspace_id
    WHERE i.type = 'woocommerce' AND s.disconnected_at IS NULL AND w.status = 'active'
      AND COALESCE((SELECT MAX(started_at) FROM sync_runs r WHERE r.store_id = i.store_id), '') <= ?
  `).all(toSqlite(now - SYNC_EVERY_MS)).filter((row) => PLAN_LIMITS[effectivePlan(row)].integrations);
}

function waitingConversations(db, now) {
  return db.prepare(`
    SELECT c.id, c.store_id AS storeId, c.customer_name AS customerName, last.created_at AS lastMessageAt
    FROM conversations c
    JOIN messages last ON last.id = (SELECT MAX(id) FROM messages WHERE conversation_id = c.id)
    WHERE last.role = 'user' AND last.created_at <= ? AND c.status = 'open' AND c.waiting_notified_at IS NULL
      AND EXISTS (SELECT 1 FROM webhooks h WHERE h.store_id = c.store_id AND h.active = 1 AND ',' || h.events || ',' LIKE '%,conversation.waiting,%')
  `).all(toSqlite(now - WAITING_AFTER_MS));
}

/** One pass; exported for tests. */
function tick({ db, queue, outbound, now = Date.now() }) {
  for (const { storeId } of dueSyncs(db, now)) queue.run(storeId);
  for (const c of waitingConversations(db, now)) {
    db.prepare("UPDATE conversations SET waiting_notified_at = datetime('now') WHERE id = ?").run(c.id);
    outbound.emit(c.storeId, 'conversation.waiting', { conversationId: c.id, customerName: c.customerName, lastMessageAt: c.lastMessageAt });
  }
}

function startScheduler(deps) {
  const run = () => { try { tick(deps); } catch (err) { console.error('[scheduler]', err); } };
  const timer = setInterval(run, TICK_MS);
  timer.unref();
  return { stop: () => clearInterval(timer) };
}

module.exports = { startScheduler, tick };
