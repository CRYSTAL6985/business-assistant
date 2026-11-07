// Analytics: per-store comparison and a daily series for a date range. Every number is a COUNT or
// SUM over real rows; a rate with nothing to divide by is null (shown as «—»), never 0.
const { metrics } = require('./overview');

const PAID = "('confirmed', 'sent')";

function storeRow(db, store, range) {
  const o = db.prepare(`SELECT COUNT(*) AS orders, COALESCE(SUM(CASE WHEN status IN ${PAID} THEN total END), 0) AS revenue
    FROM orders WHERE store_id = ? AND created_at >= ? AND created_at < ?`).get(store.id, range.start, range.end);
  const { conversations } = db.prepare('SELECT COUNT(*) AS conversations FROM conversations WHERE store_id = ? AND created_at >= ? AND created_at < ?')
    .get(store.id, range.start, range.end);
  const r = db.prepare(`SELECT COUNT(*) AS replies, COALESCE(SUM(m.source = 'ai'), 0) AS ai, COALESCE(SUM(m.source = 'offline'), 0) AS offline
    FROM messages m JOIN conversations c ON c.id = m.conversation_id
    WHERE c.store_id = ? AND m.role = 'assistant' AND m.created_at >= ? AND m.created_at < ?`).get(store.id, range.start, range.end);
  const { takeovers } = db.prepare("SELECT COUNT(*) AS takeovers FROM events WHERE store_id = ? AND type = 'conversation.takeover' AND created_at >= ? AND created_at < ?")
    .get(store.id, range.start, range.end);
  return {
    id: store.id, name: store.name, orders: o.orders, revenue: o.revenue, conversations, replies: r.replies,
    aiRate: r.replies ? r.ai / r.replies : null, offlineRate: r.replies ? r.offline / r.replies : null, takeovers,
  };
}

/** @returns {{ days: string[], series: object, stores: object[] }} */
function report(db, stores, range) {
  const m = metrics(db, stores.map((s) => s.id), range);
  return {
    days: range.days,
    series: { orders: m.orders.series, revenue: m.revenue.series, conversations: m.conversations.series },
    stores: stores.map((s) => storeRow(db, s, range)),
  };
}

module.exports = { report };
