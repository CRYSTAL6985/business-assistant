// Assistant settings per store: read draft + published, save the draft, publish, discard, and a
// test chat that runs the draft without saving anything (no conversation, no order).
const express = require('express');
const validate = require('../../validate');
const { storeFor } = require('../../scope');
const { normalize, validateDraft } = require('../../assistantConfig');
const { buildSystemPrompt, extractOrder, validateOrder, offlineReply } = require('../../assistant');

const MAX_TEST_HISTORY = 12;
const MAX_MESSAGE = 1000;
const NOT_FOUND = { error: 'فروشگاه پیدا نشد' };

function assistantRoutes(db, ask) {
  const router = express.Router();

  const configRow = (storeId) => db.prepare('SELECT draft_json, published_json, published_at FROM assistant_configs WHERE store_id = ?').get(storeId);
  const read = (store) => {
    const row = configRow(store.id);
    const draft = normalize(JSON.parse(row?.draft_json ?? '{}'), store.name);
    const published = normalize(JSON.parse(row?.published_json ?? '{}'), store.name);
    return { draft, published, publishedAt: row?.published_at ?? null };
  };
  const withStore = (handler) => (req, res) => {
    const store = storeFor(db, req, validate.id(req.params.storeId) ?? -1);
    if (!store) return res.status(404).json(NOT_FOUND);
    return handler(req, res, store);
  };

  router.get('/', (req, res) => {
    const store = storeFor(db, req, req.query.store ? (validate.id(req.query.store) ?? -1) : undefined);
    if (!store) return res.status(404).json(NOT_FOUND);
    const { draft, published, publishedAt } = read(store);
    const knowledge = db.prepare(`SELECT (SELECT COUNT(*) FROM products WHERE store_id = ?) AS products,
      (SELECT COUNT(*) FROM products WHERE store_id = ? AND in_stock = 1) AS inStock, (SELECT COUNT(*) FROM faqs WHERE store_id = ?) AS faqs`)
      .get(store.id, store.id, store.id);
    res.json({ storeId: store.id, storeName: store.name, storeSlug: store.slug, draft, published, publishedAt,
      hasChanges: JSON.stringify(draft) !== JSON.stringify(published), knowledge, aiConnected: Boolean(ask) });
  });

  router.put('/:storeId/draft', withStore((req, res, store) => {
    const result = validateDraft(req.body?.config);
    if (!result.ok) return res.status(400).json({ error: result.error });
    db.prepare(`INSERT INTO assistant_configs (store_id, draft_json, published_json) VALUES (?, ?, '{}')
      ON CONFLICT(store_id) DO UPDATE SET draft_json = excluded.draft_json`).run(store.id, JSON.stringify(result.value));
    res.json({ ok: true });
  }));

  router.post('/:storeId/publish', withStore((req, res, store) => {
    db.prepare("UPDATE assistant_configs SET published_json = draft_json, published_at = datetime('now') WHERE store_id = ?").run(store.id);
    res.json({ ok: true });
  }));

  router.post('/:storeId/discard', withStore((req, res, store) => {
    db.prepare('UPDATE assistant_configs SET draft_json = published_json WHERE store_id = ?').run(store.id);
    res.json({ ok: true });
  }));

  // Runs the draft against the store's real products and FAQs. Nothing is saved: an order block is
  // validated (so the owner sees whether it would have been accepted) but never stored.
  router.post('/:storeId/test', withStore(async (req, res, store) => {
    const message = validate.text(req.body?.message, 1, MAX_MESSAGE);
    if (!message) return res.status(400).json({ error: 'پیام آزمایشی لازم است' });
    const history = (Array.isArray(req.body?.history) ? req.body.history : []).slice(-MAX_TEST_HISTORY)
      .filter((m) => (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string')
      .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_MESSAGE) }));
    const { draft } = read(store);
    const profile = { ...draft, name: store.name };
    const products = db.prepare('SELECT id, name, description, price, in_stock FROM products WHERE store_id = ? ORDER BY id').all(store.id);
    const faqs = db.prepare('SELECT id, question, answer FROM faqs WHERE store_id = ? ORDER BY id').all(store.id);

    if (ask) {
      try {
        const raw = await ask(buildSystemPrompt(profile, products, faqs), [...history, { role: 'user', content: message }]);
        const { text, order, error } = extractOrder(raw);
        const context = { mode: 'ai', productIds: products.map((p) => p.id), faqIds: faqs.map((f) => f.id), order: null };
        if (error) context.order = { ok: false, error };
        if (order) {
          if (!profile.orderTaking) context.order = { ok: false, error: 'ثبت سفارش در تنظیمات خاموش است' };
          else {
            const checked = validateOrder(order, products);
            context.order = checked.ok ? { ok: true, total: checked.value.total, items: checked.value.items } : { ok: false, error: checked.error };
          }
        }
        return res.json({ reply: text, source: 'ai', context });
      } catch (err) {
        console.error(`[assistant-test] AI call failed for ${store.slug}:`, err.message);
      }
    }
    const offline = offlineReply(message, products, faqs, profile);
    const faq = offline.faqId ? faqs.find((f) => f.id === offline.faqId) : null;
    res.json({ reply: offline.text, source: 'offline', context: { mode: 'offline', matched: offline.matched, faqId: offline.faqId, faqQuestion: faq?.question ?? null, productIds: offline.productIds } });
  }));

  return router;
}

module.exports = { assistantRoutes };
