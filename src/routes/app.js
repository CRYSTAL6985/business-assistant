// Owner panel API (/api/app). Every route requires login; store filters go through scope.storeFor,
// so ?store= can only narrow down to a store of the signed-in user's own workspace.
const express = require('express');
const { requireUser } = require('../auth');
const { usageFor } = require('../plans');
const { workspaceStores, storeFor } = require('../scope');
const { resolveRange } = require('../time');
const overview = require('../overview');
const attention = require('../attention');
const validate = require('../validate');

const ACTIVITY_TYPES = ['order', 'conversation'];

function appRoutes(db) {
  const router = express.Router();
  router.use(requireUser(db));

  const workspaceOf = (req) => db.prepare('SELECT id, name, plan, paid_until FROM workspaces WHERE id = ?').get(req.workspaceId);

  /** Stores the request is about: one (validated) store with ?store=, otherwise all of the workspace. Null = forbidden. */
  function scopedStores(req) {
    if (req.query.store === undefined || req.query.store === '') return workspaceStores(db, req.workspaceId);
    const store = storeFor(db, req, validate.id(req.query.store) ?? -1);
    return store ? [store] : null;
  }

  router.get('/me', (req, res) => {
    const user = db.prepare('SELECT name, email FROM users WHERE id = ?').get(req.userId);
    const workspace = workspaceOf(req);
    res.json({
      user,
      workspace: { id: workspace.id, name: workspace.name, plan: workspace.plan, paidUntil: workspace.paid_until },
      usage: usageFor(db, workspace),
      stores: workspaceStores(db, req.workspaceId).map(({ id, name, slug, domain, platform }) => ({ id, name, slug, domain, platform })),
    });
  });

  router.get('/overview', (req, res) => {
    const stores = scopedStores(req);
    if (!stores) return res.status(404).json({ error: 'فروشگاه پیدا نشد' });
    const range = resolveRange(req.query);
    if (range.error) return res.status(400).json({ error: range.error });
    const ids = stores.map((s) => s.id);
    res.json({
      range: { days: range.days },
      scope: { storeId: req.query.store ? ids[0] : null },
      metrics: overview.metrics(db, ids, range),
      stores: overview.storeSummaries(db, stores, range),
      attention: attention.items(db, workspaceOf(req), stores),
    });
  });

  router.get('/activity', (req, res) => {
    const stores = scopedStores(req);
    if (!stores) return res.status(404).json({ error: 'فروشگاه پیدا نشد' });
    const type = ACTIVITY_TYPES.includes(req.query.type) ? req.query.type : undefined;
    res.json(overview.activity(db, stores.map((s) => s.id), { type, before: validate.id(req.query.before) ?? undefined }));
  });

  return router;
}

module.exports = { appRoutes };
