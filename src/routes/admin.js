// Operator panel API (/api/admin), is_operator only. METADATA ONLY — a hard wall: nothing here may
// return conversations, messages, customer names, phones, addresses or order contents. Counts,
// usage, plans, payments, store names/domains and widget sightings are what the operator runs on.
const express = require('express');
const { requireOperator } = require('../auth');
const { usageFor, effectivePlan } = require('../plans');
const { resolveRange } = require('../time');
const validate = require('../validate');

const PLANS = ['free', 'pro'];
const NOT_FOUND = { error: 'فضای کاری پیدا نشد' };

/** "2026-12-31" -> end of that Tehran day as SQLite UTC, or null. */
function endOfDay(day) {
  const range = resolveRange({ range: 'custom', from: day, to: day });
  return range.error ? null : range.end;
}

function adminRoutes(db) {
  const router = express.Router();
  router.use(requireOperator(db));

  const workspaceRow = (w) => ({
    id: w.id, name: w.name, ownerEmail: w.owner_email, plan: w.plan, effectivePlan: effectivePlan(w), paidUntil: w.paid_until,
    status: w.status, createdAt: w.created_at, stores: w.stores, usage: usageFor(db, w),
  });
  const WORKSPACES = `SELECT w.*, (SELECT COUNT(*) FROM stores s WHERE s.workspace_id = w.id AND s.disconnected_at IS NULL) AS stores,
    (SELECT u.email FROM workspace_members m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = w.id AND m.role = 'owner' ORDER BY m.user_id LIMIT 1) AS owner_email
    FROM workspaces w`;
  const findWorkspace = (req) => db.prepare(`${WORKSPACES} WHERE w.id = ?`).get(validate.id(req.params.id) ?? -1);

  const storesOf = (where, ...params) => {
    const sightings = db.prepare('SELECT origin, last_seen_at AS lastSeenAt, hits FROM widget_sightings WHERE store_id = ? ORDER BY last_seen_at DESC');
    return db.prepare(`SELECT s.id, s.name, s.slug, s.domain, s.platform, s.disconnected_at AS disconnectedAt, s.created_at AS createdAt,
        w.id AS workspaceId, w.name AS workspaceName, i.status AS integrationStatus
      FROM stores s JOIN workspaces w ON w.id = s.workspace_id LEFT JOIN integrations i ON i.store_id = s.id AND i.type = 'woocommerce'
      ${where} ORDER BY s.id DESC`).all(...params).map((s) => ({ ...s, sightings: sightings.all(s.id) }));
  };

  router.get('/workspaces', (req, res) => {
    res.json(db.prepare(`${WORKSPACES} ORDER BY w.id DESC`).all().map(workspaceRow));
  });

  router.get('/stores', (req, res) => {
    res.json(storesOf(''));
  });

  router.get('/workspaces/:id', (req, res) => {
    const w = findWorkspace(req);
    if (!w) return res.status(404).json(NOT_FOUND);
    const count = (table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table} t JOIN stores s ON s.id = t.store_id WHERE s.workspace_id = ?`).get(w.id).n;
    res.json({
      ...workspaceRow(w),
      counts: { conversations: count('conversations'), orders: count('orders'), products: count('products') },
      stores: storesOf('WHERE s.workspace_id = ?', w.id),
      payments: db.prepare(`SELECT p.id, p.amount, p.note, p.period_end AS periodEnd, p.created_at AS createdAt, u.email AS recordedBy
        FROM payments p LEFT JOIN users u ON u.id = p.recorded_by WHERE p.workspace_id = ? ORDER BY p.id DESC`).all(w.id),
    });
  });

  router.put('/workspaces/:id/plan', (req, res) => {
    const w = findWorkspace(req);
    if (!w) return res.status(404).json(NOT_FOUND);
    const plan = req.body?.plan;
    if (!PLANS.includes(plan)) return res.status(400).json({ error: 'پلن نامعتبر است' });
    const paidUntil = req.body?.paidUntil ? endOfDay(req.body.paidUntil) : null;
    if (req.body?.paidUntil && !paidUntil) return res.status(400).json({ error: 'تاریخ نامعتبر است' });
    db.prepare('UPDATE workspaces SET plan = ?, paid_until = ? WHERE id = ?').run(plan, plan === 'pro' ? paidUntil : null, w.id);
    res.json({ ok: true });
  });

  router.post('/workspaces/:id/payments', (req, res) => {
    const w = findWorkspace(req);
    if (!w) return res.status(404).json(NOT_FOUND);
    const amount = validate.price(req.body?.amount);
    const periodEnd = endOfDay(req.body?.periodEnd);
    const note = validate.text(req.body?.note ?? '', 0, 200);
    if (!amount) return res.status(400).json({ error: 'مبلغ (تومان) لازم است' });
    if (!periodEnd) return res.status(400).json({ error: 'تاریخ پایان دوره نامعتبر است' });
    if (note === null) return res.status(400).json({ error: 'یادداشت حداکثر ۲۰۰ حرف' });
    db.exec('BEGIN');
    try {
      db.prepare('INSERT INTO payments (workspace_id, amount, note, period_end, recorded_by) VALUES (?, ?, ?, ?, ?)').run(w.id, amount, note, periodEnd, req.userId);
      db.prepare("UPDATE workspaces SET plan = 'pro', paid_until = ? WHERE id = ?").run(periodEnd, w.id);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    res.status(201).json({ ok: true, paidUntil: periodEnd });
  });

  const setStatus = (status) => (req, res) => {
    const w = findWorkspace(req);
    if (!w) return res.status(404).json(NOT_FOUND);
    db.prepare('UPDATE workspaces SET status = ? WHERE id = ?').run(status, w.id);
    res.json({ ok: true });
  };
  router.post('/workspaces/:id/suspend', setStatus('suspended'));
  router.post('/workspaces/:id/reactivate', setStatus('active'));

  return router;
}

module.exports = { adminRoutes };
