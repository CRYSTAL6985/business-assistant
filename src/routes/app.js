// Owner panel API (/api/app). Every route requires login; store filters go through scope.storeFor,
// so ?store= can only narrow down to a store of the signed-in user's own workspace.
const express = require('express');
const { requireUser } = require('../auth');
const { usageFor } = require('../plans');
const { workspaceStores, requestStores } = require('../scope');
const { resolveRange } = require('../time');
const overview = require('../overview');
const attention = require('../attention');
const validate = require('../validate');
const { storeRoutes } = require('./app/stores');
const { productRoutes } = require('./app/products');
const { faqRoutes } = require('./app/faqs');
const { orderRoutes } = require('./app/orders');
const { conversationRoutes } = require('./app/conversations');
const { assistantRoutes } = require('./app/assistant');
const { integrationRoutes } = require('./app/integrations');

const ACTIVITY_TYPES = ['order', 'conversation'];

function appRoutes(db, ask, services) {
  const router = express.Router();
  router.use(requireUser(db));

  router.use('/stores', storeRoutes(db));
  router.use('/products', productRoutes(db));
  router.use('/faqs', faqRoutes(db));
  router.use('/orders', orderRoutes(db));
  router.use('/conversations', conversationRoutes(db));
  router.use('/assistant', assistantRoutes(db, ask));
  router.use('/integrations', integrationRoutes(services));

  const workspaceOf = (req) => db.prepare('SELECT id, name, plan, paid_until FROM workspaces WHERE id = ?').get(req.workspaceId);

  const scopedStores = (req) => requestStores(db, req);

  router.get('/me', (req, res) => {
    const user = db.prepare('SELECT name, email FROM users WHERE id = ?').get(req.userId);
    const workspace = workspaceOf(req);
    const stores = workspaceStores(db, req.workspaceId);
    res.json({
      user,
      workspace: { id: workspace.id, name: workspace.name, plan: workspace.plan, paidUntil: workspace.paid_until },
      usage: usageFor(db, workspace),
      stores: stores.map(({ id, name, slug, domain, platform }) => ({ id, name, slug, domain, platform })),
      counts: overview.counts(db, stores.map((s) => s.id)),
      attention: attention.items(db, workspace, stores),
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
