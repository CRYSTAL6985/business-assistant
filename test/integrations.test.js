// Integrations: crypto, SSRF guard, WooCommerce sync against a fake shop, signed webhooks both ways,
// public API keys, plan gate, isolation, scheduler.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const { startApp } = require('./helpers');
const { createCipher } = require('../src/crypto');
const { checkUrl } = require('../src/safeUrl');
const { tick } = require('../src/scheduler');

const KEY = 'ck_test_key_123456';
const SECRET = 'cs_test_secret_123456';

/** A tiny WooCommerce: 101 simple products (2 pages), one variable product, one order. */
async function fakeWoo(t, { currency = 'IRR', failOrders = false } = {}) {
  const hits = { webhooks: 0, products: 0 };
  const simple = Array.from({ length: 101 }, (_, i) => ({ id: i + 1, type: 'simple', status: 'publish', name: `P${i + 1}`, price: '10000', stock_status: 'instock', categories: [{ name: 'Cat' }] }));
  const variable = { id: 500, type: 'variable', status: 'publish', name: 'Dress', price: '', categories: [] };
  const all = [...simple, variable];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const send = (status, body, headers = {}) => { res.writeHead(status, { 'Content-Type': 'application/json', ...headers }); res.end(JSON.stringify(body)); };
    if (req.headers.authorization !== `Basic ${Buffer.from(`${KEY}:${SECRET}`).toString('base64')}`) return send(401, { code: 'woocommerce_rest_cannot_view' });
    const p = url.pathname.replace('/wp-json/wc/v3', '');
    if (p === '/settings/general/woocommerce_currency') return send(200, { id: 'woocommerce_currency', value: currency });
    if (p === '/products') {
      hits.products++;
      const page = Number(url.searchParams.get('page'));
      return send(200, all.slice((page - 1) * 100, page * 100), { 'X-WP-TotalPages': '2' });
    }
    if (p === '/products/500/variations') {
      return send(200, [
        { id: 501, price: '25000', stock_status: 'instock', manage_stock: true, stock_quantity: 3, attributes: [{ option: 'S' }] },
        { id: 502, price: '25000', stock_status: 'outofstock', attributes: [{ option: 'M' }] },
      ]);
    }
    if (p === '/orders') {
      if (failOrders) return send(500, {});
      return send(200, [{ id: 9001, status: 'processing', total: '50000', date_created_gmt: '2026-11-01T10:00:00', billing: { first_name: 'Sara', last_name: 'M', phone: '0912', city: 'Tehran' }, line_items: [{ name: 'P1', quantity: 5, price: 10000 }] }]);
    }
    if (p === '/webhooks' && req.method === 'POST') { hits.webhooks++; return send(201, { id: hits.webhooks }); }
    send(404, {});
  });
  server.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  t.after(() => server.close());
  return { url: `http://127.0.0.1:${server.address().port}`, hits };
}

async function proStore(app, slug) {
  const owner = await app.register(slug);
  app.db.prepare("UPDATE workspaces SET plan = 'pro' WHERE id = ?").run(owner.workspaceId);
  return owner;
}

test('crypto: round trip, tamper detection, wrong key', () => {
  const a = createCipher('a'.repeat(32));
  const sealed = a.encrypt('ck_secret');
  assert.doesNotMatch(sealed, /ck_secret/);
  assert.equal(a.decrypt(sealed), 'ck_secret');
  const parts = sealed.split(':');
  parts[3] = Buffer.from('xxxxxxxxx').toString('base64url');
  assert.throws(() => a.decrypt(parts.join(':')));
  assert.throws(() => createCipher('b'.repeat(32)).decrypt(sealed));
  assert.throws(() => createCipher('short'), /SECRET_KEY/);
});

test('safeUrl refuses http and internal addresses unless private URLs are allowed', async () => {
  assert.equal((await checkUrl('http://shop.ir')).ok, false);
  assert.equal((await checkUrl('https://127.0.0.1/x')).ok, false);
  assert.equal((await checkUrl('https://10.1.2.3')).ok, false);
  assert.equal((await checkUrl('https://[::1]/')).ok, false);
  assert.equal((await checkUrl('https://user:pw@shop.ir')).ok, false);
  assert.equal((await checkUrl('http://127.0.0.1:8080', { allowPrivate: true })).ok, true);
});

test('WooCommerce: connect, import products + variations + orders in toman, re-run is idempotent', async (t) => {
  const woo = await fakeWoo(t);
  const app = await startApp(t);
  const { call, storeId } = await proStore(app, 'woo-shop');

  const res = await call('POST', `/api/app/integrations/${storeId}/woocommerce`, { siteUrl: woo.url, consumerKey: KEY, consumerSecret: SECRET });
  assert.equal(res.status, 201);
  assert.equal(res.body.webhooks, true);
  assert.equal(woo.hits.webhooks, 5);
  const first = await app.services.queue.run(storeId);
  assert.equal(first.ok, true);

  const products = app.db.prepare("SELECT * FROM products WHERE store_id = ? AND source = 'woocommerce' ORDER BY id").all(storeId);
  assert.equal(products.length, 103); // 101 simple + 2 variations; the variable parent itself is not sellable
  assert.equal(products[0].price, 1000); // IRR ÷ 10
  const small = products.find((p) => p.external_id === '500:501');
  assert.equal(small.name, 'Dress — S');
  assert.equal(small.stock_qty, 3);
  assert.equal(products.find((p) => p.external_id === '500:502').in_stock, 0);
  const order = app.db.prepare("SELECT * FROM orders WHERE store_id = ? AND source = 'woocommerce'").get(storeId);
  assert.equal(order.status, 'confirmed');
  assert.equal(order.total, 5000);
  assert.equal(order.created_at, '2026-11-01 10:00:00');
  assert.equal(app.db.prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'order.created'").get().n, 0, 'historical import does not flood the feed');

  const second = await app.services.queue.run(storeId);
  assert.equal(second.created, 0);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM products WHERE store_id = ?').get(storeId).n, 103);

  const state = (await call('GET', `/api/app/integrations?store=${storeId}`)).body;
  assert.equal(state.woocommerce.status, 'ok');
  assert.equal(state.platform, 'woocommerce');
  assert.equal(state.syncRuns.length, 2);
  assert.doesNotMatch(JSON.stringify(state), new RegExp(`${KEY}|${SECRET}`), 'keys never go back to the browser');

  const edit = await call('PUT', `/api/app/products/${products[0].id}`, { name: 'x', price: 1 });
  assert.equal(edit.status, 409, 'synced products are read-only');
});

test('WooCommerce: wrong keys, foreign currency and free plan are refused with a clear message', async (t) => {
  const woo = await fakeWoo(t, { currency: 'USD' });
  const app = await startApp(t);
  const { call, storeId, workspaceId } = await app.register('woo-bad');
  const free = await call('POST', `/api/app/integrations/${storeId}/woocommerce`, { siteUrl: woo.url, consumerKey: KEY, consumerSecret: SECRET });
  assert.equal(free.status, 403);
  app.db.prepare("UPDATE workspaces SET plan = 'pro' WHERE id = ?").run(workspaceId);
  const wrong = await call('POST', `/api/app/integrations/${storeId}/woocommerce`, { siteUrl: woo.url, consumerKey: 'ck_wrong_key_000', consumerSecret: SECRET });
  assert.equal(wrong.status, 400);
  assert.match(wrong.body.error, /کلید/);
  const usd = await call('POST', `/api/app/integrations/${storeId}/woocommerce`, { siteUrl: woo.url, consumerKey: KEY, consumerSecret: SECRET });
  assert.equal(usd.status, 400);
  assert.match(usd.body.error, /USD/);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM integrations').get().n, 0);
});

test('WooCommerce: a failing page keeps what was written, records the error, and does not advance the cursor', async (t) => {
  const woo = await fakeWoo(t, { failOrders: true });
  const app = await startApp(t);
  const { call, storeId } = await proStore(app, 'woo-fail');
  await call('POST', `/api/app/integrations/${storeId}/woocommerce`, { siteUrl: woo.url, consumerKey: KEY, consumerSecret: SECRET });
  const run = await app.services.queue.run(storeId);
  assert.equal(run.ok, false);
  const integration = app.db.prepare('SELECT * FROM integrations WHERE store_id = ?').get(storeId);
  assert.equal(integration.status, 'error');
  assert.match(integration.last_error, /۵۰۰|500/);
  assert.equal(integration.last_sync_at, null);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM products WHERE store_id = ?').get(storeId).n, 103, 'products pages stayed');
});

test('inbound webhooks: signed product updates apply, bad signatures are refused, deletes remove', async (t) => {
  const woo = await fakeWoo(t);
  const app = await startApp(t);
  const { call, storeId } = await proStore(app, 'woo-hook');
  await call('POST', `/api/app/integrations/${storeId}/woocommerce`, { siteUrl: woo.url, consumerKey: KEY, consumerSecret: SECRET });
  await app.services.queue.run(storeId);
  const secret = app.services.cipher.decrypt(app.db.prepare('SELECT webhook_secret_enc FROM integrations WHERE store_id = ?').get(storeId).webhook_secret_enc);
  const send = (topic, payload, signature) => {
    const body = JSON.stringify(payload);
    const sig = signature ?? crypto.createHmac('sha256', secret).update(body).digest('base64');
    return fetch(`${app.base}/api/webhooks/woocommerce/${storeId}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-WC-Webhook-Topic': topic, 'X-WC-Webhook-Signature': sig }, body });
  };
  const price = () => app.db.prepare("SELECT price FROM products WHERE store_id = ? AND external_id = '1'").get(storeId)?.price;

  assert.equal((await send('product.updated', { id: 1, type: 'simple', status: 'publish', name: 'P1', price: '30000' }, 'bad')).status, 401);
  assert.equal(price(), 1000);
  assert.equal((await send('product.updated', { id: 1, type: 'simple', status: 'publish', name: 'P1', price: '30000' })).status, 200);
  assert.equal(price(), 3000);
  assert.equal((await send('order.created', { id: 9002, status: 'pending', total: '20000', billing: {}, line_items: [] })).status, 200);
  assert.equal(app.db.prepare("SELECT status FROM orders WHERE external_id = '9002'").get().status, 'new');
  assert.equal(app.db.prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'order.created'").get().n, 1, 'live orders reach the feed');
  await send('product.deleted', { id: 1 });
  assert.equal(price(), undefined);
});

test('public API: key shown once, upserts by external id, totals computed here, revoke and plan gate', async (t) => {
  const app = await startApp(t);
  const { call, storeId, workspaceId } = await proStore(app, 'api-shop');
  const created = await call('POST', `/api/app/integrations/${storeId}/api-keys`, { label: 'site' });
  assert.equal(created.status, 201);
  const { key } = created.body;
  assert.match(key, /^ba_[a-f0-9]{12}_/);
  const state = (await call('GET', `/api/app/integrations?store=${storeId}`)).body;
  assert.equal(state.apiKeys.length, 1);
  assert.doesNotMatch(JSON.stringify(state), new RegExp(key.split('_')[2]), 'the secret part is never shown again');
  assert.equal(state.platform, 'custom');

  const v1 = (method, path, body, k = key) => fetch(`${app.base}/api/v1${path}`, { method, headers: { Authorization: `Bearer ${k}`, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) })
    .then(async (r) => ({ status: r.status, body: await r.json() }));

  assert.equal((await v1('PUT', '/products/sku-1', { name: 'Scarf', price: 120000, stockQty: 4 })).status, 201);
  assert.equal((await v1('PUT', '/products/sku-1', { name: 'Scarf', price: 99000, stockQty: 0 })).status, 200);
  const product = app.db.prepare("SELECT * FROM products WHERE external_id = 'sku-1'").get();
  assert.equal(product.price, 99000);
  assert.equal(product.in_stock, 0);
  assert.equal((await v1('PUT', '/products/bad id!', { name: 'x', price: 1 })).status, 400);

  const order = await v1('PUT', '/orders/A-1', { customerName: 'Ali', items: [{ name: 'Scarf', price: 99000, qty: 2 }], total: 1 });
  assert.equal(order.status, 201);
  assert.equal(order.body.total, 198000, 'the caller cannot set the total');

  assert.equal((await v1('GET', '/conversations', undefined, `${key}x`)).status, 401);
  app.db.prepare("UPDATE workspaces SET plan = 'free' WHERE id = ?").run(workspaceId);
  assert.equal((await v1('GET', '/conversations')).status, 403);
  app.db.prepare("UPDATE workspaces SET plan = 'pro' WHERE id = ?").run(workspaceId);
  assert.equal((await call('DELETE', `/api/app/integrations/${storeId}/api-keys/${created.body.id}`)).status, 200);
  assert.equal((await v1('GET', '/conversations')).status, 401);
});

test('public API: staff reply takes the chat over; other stores stay out of reach', async (t) => {
  const app = await startApp(t);
  const a = await proStore(app, 'api-a');
  const b = await proStore(app, 'api-b');
  const { key } = (await a.call('POST', `/api/app/integrations/${a.storeId}/api-keys`, {})).body;
  const chat = (slug) => fetch(`${app.base}/api/chat/${slug}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'سلام' }) }).then((r) => r.json());
  const mine = await chat('api-a');
  const theirs = await chat('api-b');
  const v1 = (method, path, body) => fetch(`${app.base}/api/v1${path}`, { method, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) }).then((r) => r.status);

  assert.equal(await v1('GET', `/conversations/${theirs.conversationId}`), 404);
  assert.equal(await v1('POST', `/conversations/${theirs.conversationId}/messages`, { content: 'hi' }), 404);
  assert.equal(await v1('POST', `/conversations/${mine.conversationId}/messages`, { content: 'از فروشگاه' }), 201);
  assert.equal(app.db.prepare('SELECT handler FROM conversations WHERE id = ?').get(mine.conversationId).handler, 'human');
  assert.equal((await b.call('POST', `/api/app/integrations/${a.storeId}/api-keys`, {})).status, 404);
});

test('outbound webhooks are signed; conversation.waiting is sent once per wait', async (t) => {
  const received = [];
  const receiver = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => { received.push({ headers: req.headers, body }); res.end('ok'); });
  });
  receiver.listen(0, '127.0.0.1');
  await new Promise((r) => receiver.once('listening', r));
  t.after(() => receiver.close());

  const app = await startApp(t);
  const { call, storeId } = await proStore(app, 'hook-out');
  const hook = await call('POST', `/api/app/integrations/${storeId}/webhooks`, { url: `http://127.0.0.1:${receiver.address().port}/in`, events: ['conversation.waiting', 'order.created'] });
  assert.equal(hook.status, 201);
  assert.match(hook.body.secret, /^whsec_/);
  assert.equal((await call('POST', `/api/app/integrations/${storeId}/webhooks`, { url: 'https://x.ir', events: ['nope'] })).status, 400);

  const chat = await fetch(`${app.base}/api/chat/hook-out`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'کسی هست؟' }) }).then((r) => r.json());
  app.db.prepare("UPDATE messages SET created_at = datetime('now', '-20 minutes') WHERE conversation_id = ?").run(chat.conversationId);
  app.db.prepare("DELETE FROM messages WHERE conversation_id = ? AND role = 'assistant'").run(chat.conversationId); // unanswered
  const sent = [];
  const outbound = { emit: (...args) => { const p = app.services.outbound.emit(...args); sent.push(...p); return p; } };
  tick({ db: app.db, queue: app.services.queue, outbound });
  tick({ db: app.db, queue: app.services.queue, outbound });
  await Promise.all(sent);
  assert.equal(received.length, 1, 'once per wait');
  const [{ headers, body }] = received;
  assert.equal(headers['x-event'], 'conversation.waiting');
  assert.equal(headers['x-signature'], `sha256=${crypto.createHmac('sha256', hook.body.secret).update(body).digest('hex')}`);
  assert.equal(JSON.parse(body).data.conversationId, chat.conversationId);
  assert.match(app.db.prepare('SELECT last_status FROM webhooks').get().last_status, /200/);
});
