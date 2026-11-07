// Stores of the signed-in workspace: list (incl. disconnected), add within the plan's limit,
// rename / change domain, disconnect (soft), reconnect, delete (typed-name confirmation).
const express = require('express');
const validate = require('../../validate');
const { insertStore, normalizeDomain, storeAllowance } = require('../../stores');

const SQLITE_CONSTRAINT_UNIQUE = 2067;
const LIMIT_REACHED = 'سقف فروشگاه‌های پلن شما پر است. برای فروشگاه بیشتر پلن را ارتقا دهید.';
const NOT_FOUND = { error: 'فروشگاه پیدا نشد' };

function storeRoutes(db) {
  const router = express.Router();
  const workspaceOf = (req) => db.prepare('SELECT id, plan, paid_until FROM workspaces WHERE id = ?').get(req.workspaceId);
  /** Any store of this workspace, connected or not. */
  const ownStore = (req) => db.prepare('SELECT id, name, slug, disconnected_at FROM stores WHERE id = ? AND workspace_id = ?')
    .get(validate.id(req.params.id) ?? -1, req.workspaceId);
  const isLastConnected = (req, store) => !store.disconnected_at && storeAllowance(db, workspaceOf(req)).used <= 1;

  router.get('/', (req, res) => {
    const items = db.prepare(`SELECT id, name, slug, domain, platform, created_at AS createdAt, disconnected_at AS disconnectedAt
      FROM stores WHERE workspace_id = ? ORDER BY disconnected_at IS NOT NULL, id`).all(req.workspaceId);
    res.json({ items, ...storeAllowance(db, workspaceOf(req)) });
  });

  router.post('/', (req, res, next) => {
    const name = validate.text(req.body?.name, 2, 80);
    const slug = validate.slug(req.body?.slug);
    const domain = normalizeDomain(req.body?.domain);
    if (!name) return res.status(400).json({ error: 'نام فروشگاه لازم است (۲ تا ۸۰ حرف)' });
    if (!slug) return res.status(400).json({ error: 'آدرس صفحه فقط حروف انگلیسی کوچک، عدد و خط تیره (۳ تا ۳۰ حرف)' });
    if (domain === null) return res.status(400).json({ error: 'دامنه نامعتبر است (مثال: shop.ir)' });
    const { used, limit } = storeAllowance(db, workspaceOf(req));
    if (used >= limit) return res.status(403).json({ error: LIMIT_REACHED });
    try {
      const id = insertStore(db, { workspaceId: req.workspaceId, slug, name, domain });
      res.status(201).json({ id });
    } catch (err) {
      if (err.errcode === SQLITE_CONSTRAINT_UNIQUE) return res.status(409).json({ error: 'این آدرس صفحه قبلاً گرفته شده' });
      next(err);
    }
  });

  router.put('/:id', (req, res) => {
    const store = ownStore(req);
    if (!store) return res.status(404).json(NOT_FOUND);
    const name = validate.text(req.body?.name, 2, 80);
    const domain = normalizeDomain(req.body?.domain);
    if (!name) return res.status(400).json({ error: 'نام فروشگاه لازم است (۲ تا ۸۰ حرف)' });
    if (domain === null) return res.status(400).json({ error: 'دامنه نامعتبر است (مثال: shop.ir)' });
    db.prepare('UPDATE stores SET name = ?, domain = ? WHERE id = ?').run(name, domain, store.id);
    res.json({ ok: true });
  });

  router.post('/:id/disconnect', (req, res) => {
    const store = ownStore(req);
    if (!store) return res.status(404).json(NOT_FOUND);
    if (isLastConnected(req, store)) return res.status(409).json({ error: 'حداقل یک فروشگاه باید متصل بماند' });
    db.prepare("UPDATE stores SET disconnected_at = COALESCE(disconnected_at, datetime('now')) WHERE id = ?").run(store.id);
    res.json({ ok: true });
  });

  router.post('/:id/reconnect', (req, res) => {
    const store = ownStore(req);
    if (!store) return res.status(404).json(NOT_FOUND);
    if (store.disconnected_at) {
      const { used, limit } = storeAllowance(db, workspaceOf(req));
      if (used >= limit) return res.status(403).json({ error: LIMIT_REACHED });
      db.prepare('UPDATE stores SET disconnected_at = NULL WHERE id = ?').run(store.id);
    }
    res.json({ ok: true });
  });

  router.delete('/:id', (req, res) => {
    const store = ownStore(req);
    if (!store) return res.status(404).json(NOT_FOUND);
    if (isLastConnected(req, store)) return res.status(409).json({ error: 'حداقل یک فروشگاه باید متصل بماند' });
    if (req.body?.confirm !== store.name) return res.status(400).json({ error: 'برای حذف، نام فروشگاه را دقیقاً وارد کنید' });
    db.prepare('DELETE FROM stores WHERE id = ?').run(store.id); // cascades to products, orders, conversations, events
    res.json({ ok: true });
  });

  return router;
}

module.exports = { storeRoutes };
