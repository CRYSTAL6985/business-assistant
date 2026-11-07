// Inbound WooCommerce webhooks: /api/webhooks/woocommerce/:storeId. WooCommerce signs each delivery
// with the secret we gave it: X-WC-Webhook-Signature = base64 HMAC-SHA256 of the raw body. Anything
// unsigned or wrongly signed is refused before its body is read as data. Mounted before express.json
// because the signature covers the exact bytes.
const express = require('express');
const { hmac, safeEqual } = require('../crypto');
const { productRow, orderRow, CURRENCY_TO_TOMAN } = require('../sync/woocommerce');
const { upsertProducts, deleteProduct, upsertOrders } = require('../sync/upsert');
const validate = require('../validate');

const MAX_BODY = '2mb';

function webhookRoutes({ db, cipher, queue }) {
  const router = express.Router();

  router.post('/woocommerce/:storeId', express.raw({ type: () => true, limit: MAX_BODY }), (req, res) => {
    const storeId = validate.id(req.params.storeId);
    const integration = storeId && db.prepare(`SELECT i.* FROM integrations i JOIN stores s ON s.id = i.store_id
      WHERE i.store_id = ? AND i.type = 'woocommerce' AND s.disconnected_at IS NULL`).get(storeId);
    if (!integration) return res.status(404).json({ error: 'not found' });

    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const expected = hmac(cipher.decrypt(integration.webhook_secret_enc), raw, 'base64');
    if (!safeEqual(req.get('x-wc-webhook-signature') ?? '', expected)) return res.status(401).json({ error: 'bad signature' });

    const topic = String(req.get('x-wc-webhook-topic') ?? '');
    let payload;
    try { payload = JSON.parse(raw.toString('utf8')); } catch { return res.json({ ok: true }); } // WooCommerce's creation ping is form-encoded
    const factor = CURRENCY_TO_TOMAN[integration.currency];
    if (!factor || !payload?.id) return res.json({ ok: true, skipped: true }); // currency unknown until the first sync succeeds

    if (topic === 'product.deleted') {
      deleteProduct(db, storeId, String(payload.id), 'woocommerce');
    } else if (topic === 'product.created' || topic === 'product.updated') {
      // Variations are stored as "<parent>:<variation>" and need extra calls: let the queue fetch them.
      if (payload.type === 'variable' || payload.type === 'variation') queue.run(storeId);
      else {
        const row = productRow(payload, factor);
        if (row) upsertProducts(db, storeId, [row], 'woocommerce');
        else deleteProduct(db, storeId, String(payload.id), 'woocommerce'); // unpublished or price removed: not sellable any more
      }
    } else if (topic === 'order.created' || topic === 'order.updated') {
      upsertOrders(db, storeId, [orderRow(payload, factor)], 'woocommerce');
    }
    db.prepare("UPDATE integrations SET last_ok_at = datetime('now') WHERE id = ?").run(integration.id);
    res.json({ ok: true });
  });

  return router;
}

module.exports = { webhookRoutes };
