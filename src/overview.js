// Numbers for the Overview page. Everything is computed from rows for the given stores and range;
// nothing is estimated. Day buckets use Tehran days ('+210 minutes' = UTC+03:30).

const TEHRAN_DAY = "date(created_at, '+210 minutes')";
const PAID = "('confirmed', 'sent')";
const DEFAULT_ACTIVITY_LIMIT = 20;
const MAX_ACTIVITY_LIMIT = 100;

const marks = (ids) => ids.map(() => '?').join(',');

function ordersBy(db, ids, start, end) {
  return db.prepare(`
    SELECT ${TEHRAN_DAY} AS day, COUNT(*) AS orders, SUM(CASE WHEN status IN ${PAID} THEN total ELSE 0 END) AS revenue
    FROM orders WHERE store_id IN (${marks(ids)}) AND created_at >= ? AND created_at < ? GROUP BY day
  `).all(...ids, start, end);
}

function conversationsBy(db, ids, start, end) {
  return db.prepare(`
    SELECT ${TEHRAN_DAY} AS day, COUNT(*) AS conversations
    FROM conversations WHERE store_id IN (${marks(ids)}) AND created_at >= ? AND created_at < ? GROUP BY day
  `).all(...ids, start, end);
}

function repliesBy(db, ids, start, end) {
  return db.prepare(`
    SELECT date(m.created_at, '+210 minutes') AS day, SUM(m.source = 'ai') AS ai, COUNT(*) AS replies
    FROM messages m JOIN conversations c ON c.id = m.conversation_id
    WHERE c.store_id IN (${marks(ids)}) AND m.role = 'assistant' AND m.created_at >= ? AND m.created_at < ? GROUP BY day
  `).all(...ids, start, end);
}

const sum = (rows, key) => rows.reduce((total, row) => total + (row[key] ?? 0), 0);
const rate = (ai, replies) => (replies ? ai / replies : null);
const seriesOf = (rows, days, pick) => {
  const byDay = new Map(rows.map((row) => [row.day, row]));
  return days.map((day) => (byDay.has(day) ? pick(byDay.get(day)) : 0));
};

/**
 * @param {number[]} storeIds
 * @param {{ start: string, end: string, prevStart: string, prevEnd: string, days: string[] }} range
 */
function metrics(db, storeIds, range) {
  const zeros = range.days.map(() => 0);
  if (!storeIds.length) {
    const empty = { value: 0, previous: 0, series: zeros };
    return { revenue: empty, orders: empty, conversations: empty, aiRate: { value: null, previous: null, series: zeros } };
  }
  const now = { o: ordersBy(db, storeIds, range.start, range.end), c: conversationsBy(db, storeIds, range.start, range.end), r: repliesBy(db, storeIds, range.start, range.end) };
  const prev = { o: ordersBy(db, storeIds, range.prevStart, range.prevEnd), c: conversationsBy(db, storeIds, range.prevStart, range.prevEnd), r: repliesBy(db, storeIds, range.prevStart, range.prevEnd) };
  return {
    revenue: { value: sum(now.o, 'revenue'), previous: sum(prev.o, 'revenue'), series: seriesOf(now.o, range.days, (r) => r.revenue) },
    orders: { value: sum(now.o, 'orders'), previous: sum(prev.o, 'orders'), series: seriesOf(now.o, range.days, (r) => r.orders) },
    conversations: { value: sum(now.c, 'conversations'), previous: sum(prev.c, 'conversations'), series: seriesOf(now.c, range.days, (r) => r.conversations) },
    aiRate: {
      value: rate(sum(now.r, 'ai'), sum(now.r, 'replies')),
      previous: rate(sum(prev.r, 'ai'), sum(prev.r, 'replies')),
      series: seriesOf(now.r, range.days, (r) => rate(r.ai, r.replies) ?? 0),
    },
  };
}

/** One row per store with its own orders, revenue, AI rate and last activity in the range. */
function storeSummaries(db, stores, range) {
  const orderStats = db.prepare(`SELECT COUNT(*) AS orders, COALESCE(SUM(CASE WHEN status IN ${PAID} THEN total END), 0) AS revenue
    FROM orders WHERE store_id = ? AND created_at >= ? AND created_at < ?`);
  const replyStats = db.prepare(`SELECT SUM(m.source = 'ai') AS ai, COUNT(*) AS replies FROM messages m JOIN conversations c ON c.id = m.conversation_id
    WHERE c.store_id = ? AND m.role = 'assistant' AND m.created_at >= ? AND m.created_at < ?`);
  const lastEvent = db.prepare('SELECT MAX(created_at) AS at FROM events WHERE store_id = ?');
  return stores.map((store) => {
    const o = orderStats.get(store.id, range.start, range.end);
    const r = replyStats.get(store.id, range.start, range.end);
    return {
      id: store.id, name: store.name, slug: store.slug, domain: store.domain, platform: store.platform,
      orders: o.orders, revenue: o.revenue, aiRate: rate(r.ai ?? 0, r.replies), lastActivityAt: lastEvent.get(store.id).at,
    };
  });
}

/** Newest-first activity feed, paged by event id. type: 'order' | 'conversation' | undefined. */
function activity(db, storeIds, { type, before, limit = DEFAULT_ACTIVITY_LIMIT } = {}) {
  if (!storeIds.length) return { items: [], nextBefore: null };
  const size = Math.min(Math.max(1, limit), MAX_ACTIVITY_LIMIT);
  const where = [`e.store_id IN (${marks(storeIds)})`];
  const params = [...storeIds];
  if (type) { where.push('e.type LIKE ?'); params.push(`${type}.%`); }
  if (before) { where.push('e.id < ?'); params.push(before); }
  const rows = db.prepare(`
    SELECT e.id, e.store_id AS storeId, s.name AS storeName, e.type, e.ref_id AS refId, e.summary, e.created_at AS createdAt
    FROM events e JOIN stores s ON s.id = e.store_id
    WHERE ${where.join(' AND ')} ORDER BY e.id DESC LIMIT ?
  `).all(...params, size + 1);
  const items = rows.slice(0, size);
  return { items, nextBefore: rows.length > size ? items.at(-1).id : null };
}

module.exports = { metrics, storeSummaries, activity };
