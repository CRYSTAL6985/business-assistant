// «نیازمند توجه»: actionable problems derived from real state. Returns [] when nothing needs the
// owner — the page then shows a calm success state instead of invented warnings.
const { usageFor, PLAN_LIMITS } = require('./plans');
const { toSqlite } = require('./time');

const USAGE_WARNING = 0.8;
const ORDER_WAIT_MS = 24 * 60 * 60 * 1000;
const UNANSWERED_MS = 10 * 60 * 1000;
const STALE_SYNC_MS = 60 * 60 * 1000;          // scheduled sync runs every 15 min; an hour means it is stuck
const WIDGET_GRACE_MS = 24 * 60 * 60 * 1000;   // a new widget-only store gets a day to install the snippet
const fa = (n) => Number(n).toLocaleString('fa-IR');
const marks = (ids) => ids.map(() => '?').join(',');

function planExpired(workspace, now) {
  if (workspace.plan !== 'pro' || !workspace.paid_until) return null;
  if (new Date(`${workspace.paid_until.replace(' ', 'T')}Z`) > now) return null;
  return {
    id: 'plan-expired', severity: 'high', title: 'پلن حرفه‌ای شما به پایان رسیده',
    detail: `فضای کاری به پلن رایگان (${fa(PLAN_LIMITS.free.replies)} پاسخ هوشمند در ماه) برگشته است.`,
    action: { label: 'صورتحساب', href: '/app/billing' },
  };
}

function usageItem(db, workspace, now) {
  const usage = usageFor(db, workspace, now);
  const share = usage.used / usage.limit;
  if (share < USAGE_WARNING) return null;
  return {
    id: 'usage', severity: share >= 1 ? 'high' : 'medium',
    title: share >= 1 ? 'سقف پاسخ‌های هوشمند این ماه پر شده' : 'سقف پاسخ‌های هوشمند نزدیک است',
    detail: `${fa(usage.used)} از ${fa(usage.limit)} پاسخ این ماه مصرف شده.${share >= 1 ? ' دستیار تا ماه بعد فقط پاسخ آفلاین می‌دهد.' : ''}`,
    action: { label: 'صورتحساب', href: '/app/billing' },
  };
}

function ordersWaiting(db, ids, now) {
  const { n } = db.prepare(`SELECT COUNT(*) AS n FROM orders WHERE store_id IN (${marks(ids)}) AND status = 'new' AND created_at <= ?`)
    .get(...ids, toSqlite(now.getTime() - ORDER_WAIT_MS));
  if (!n) return null;
  return {
    id: 'orders-waiting', severity: 'medium', title: `${fa(n)} سفارش بیش از یک روز بررسی نشده`,
    detail: 'وضعیت این سفارش‌ها هنوز «جدید» است.', action: { label: 'سفارش‌ها', href: '/app/orders?status=new' },
  };
}

function unanswered(db, ids, now) {
  const { n } = db.prepare(`
    SELECT COUNT(*) AS n FROM conversations c
    JOIN messages last ON last.id = (SELECT MAX(id) FROM messages WHERE conversation_id = c.id)
    WHERE c.store_id IN (${marks(ids)}) AND last.role = 'user' AND last.created_at <= ?
  `).get(...ids, toSqlite(now.getTime() - UNANSWERED_MS));
  if (!n) return null;
  return {
    id: 'unanswered', severity: 'high', title: `${fa(n)} گفتگو منتظر پاسخ است`,
    detail: 'آخرین پیام از مشتری است و بیش از ۱۰ دقیقه بی‌پاسخ مانده.', action: { label: 'گفتگوها', href: '/app/conversations?status=waiting' },
  };
}

function integrationItems(db, ids, now) {
  const rows = db.prepare(`SELECT i.status, i.last_error, i.last_sync_at, s.id, s.name FROM integrations i JOIN stores s ON s.id = i.store_id
    WHERE i.store_id IN (${marks(ids)}) AND i.type = 'woocommerce'`).all(...ids);
  const stale = toSqlite(now.getTime() - STALE_SYNC_MS);
  return rows.map((r) => {
    const action = { label: 'یکپارچه‌سازی‌ها', href: `/app/integrations?store=${r.id}` };
    if (r.status === 'error') {
      return { id: `woo-error-${r.id}`, severity: 'high', title: `اتصال ووکامرس «${r.name}» خطا دارد`, detail: r.last_error || 'آخرین همگام‌سازی ناموفق بود.', action };
    }
    if (r.status === 'ok' && r.last_sync_at && r.last_sync_at < stale) {
      return { id: `woo-stale-${r.id}`, severity: 'medium', title: `محصولات «${r.name}» بیش از یک ساعت همگام نشده`, detail: 'همگام‌سازی خودکار اجرا نشده است. یک بار دستی همگام کنید.', action };
    }
    return null;
  });
}

function widgetNeverSeen(db, ids, now) {
  return db.prepare(`SELECT s.id, s.name FROM stores s WHERE s.id IN (${marks(ids)}) AND s.platform = 'widget' AND s.created_at <= ?
    AND NOT EXISTS (SELECT 1 FROM widget_sightings w WHERE w.store_id = s.id)`).all(...ids, toSqlite(now.getTime() - WIDGET_GRACE_MS))
    .map((s) => ({
      id: `widget-${s.id}`, severity: 'low', title: `ویجت «${s.name}» هنوز روی سایت دیده نشده`,
      detail: 'کد ویجت را قبل از </body> سایت قرار دهید؛ با اولین بازدید، این مورد خودش برطرف می‌شود.',
      action: { label: 'کد ویجت', href: `/app/integrations?store=${s.id}` },
    }));
}

/** @returns {Array<{ id: string, severity: 'high'|'medium'|'low', title: string, detail: string, action: { label: string, href: string } }>} */
function items(db, workspace, stores, now = new Date()) {
  const ids = stores.map((s) => s.id);
  const found = [planExpired(workspace, now), usageItem(db, workspace, now)];
  if (ids.length) found.push(ordersWaiting(db, ids, now), unanswered(db, ids, now), ...integrationItems(db, ids, now), ...widgetNeverSeen(db, ids, now));
  const order = { high: 0, medium: 1, low: 2 };
  return found.filter(Boolean).sort((a, b) => order[a.severity] - order[b.severity]);
}

module.exports = { items };
