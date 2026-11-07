// End-to-end API tests: real Express app, in-memory database, fake AI.
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/db');
const { createApp } = require('../src/server');
const { PLAN_LIMITS } = require('../src/plans');

async function startServer(ask) {
  const db = openDb(':memory:');
  const server = createApp({ db, ask }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { db, server, base };
}

/** Tiny client that keeps the session cookie between calls, like a browser. */
function client(base) {
  let cookie = '';
  return async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    return { status: res.status, body: await res.json() };
  };
}

async function registerShop(base, slug) {
  const call = client(base);
  const res = await call('POST', '/api/auth/register', { name: `Shop ${slug}`, slug, email: `${slug}@test.ir`, password: 'password123' });
  assert.equal(res.status, 201);
  return call;
}

test('owner registers, adds a product, and cannot touch another shop\'s product', async (t) => {
  const { server, base } = await startServer(null);
  t.after(() => server.close());

  const alice = await registerShop(base, 'alice-shop');
  const bob = await registerShop(base, 'bob-shop');
  const created = await alice('POST', '/api/panel/products', { name: 'Scarf', price: 500000 });
  assert.equal(created.status, 201);

  const hijack = await bob('PUT', `/api/panel/products/${created.body.id}`, { name: 'Hacked', price: 1 });
  assert.equal(hijack.status, 404);
  const del = await bob('DELETE', `/api/panel/products/${created.body.id}`);
  assert.equal(del.status, 404);

  const panel = await alice('GET', '/api/panel');
  assert.equal(panel.body.products[0].name, 'Scarf');
});

test('panel rejects requests without a session', async (t) => {
  const { server, base } = await startServer(null);
  t.after(() => server.close());
  const res = await client(base)('GET', '/api/panel');
  assert.equal(res.status, 401);
});

test('login locks the email after 5 wrong passwords', async (t) => {
  const { server, base } = await startServer(null);
  t.after(() => server.close());
  await registerShop(base, 'lock-shop');
  const call = client(base);
  for (let i = 0; i < 5; i++) {
    assert.equal((await call('POST', '/api/auth/login', { email: 'lock-shop@test.ir', password: 'wrong-pass' })).status, 401);
  }
  const res = await call('POST', '/api/auth/login', { email: 'lock-shop@test.ir', password: 'password123' });
  assert.equal(res.status, 429);
});

test('chat falls back to offline FAQ answers when there is no AI', async (t) => {
  const { server, base } = await startServer(null);
  t.after(() => server.close());
  const owner = await registerShop(base, 'faq-shop');
  await owner('POST', '/api/panel/faqs', { question: 'هزینه ارسال چقدر است؟', answer: 'ارسال رایگان است.' });

  const res = await client(base)('POST', '/api/chat/faq-shop', { message: 'ارسال چقدر هزینه داره؟' });
  assert.equal(res.status, 200);
  assert.equal(res.body.source, 'offline');
  assert.equal(res.body.reply, 'ارسال رایگان است.');
});

test('chat falls back to offline when the AI call throws', async (t) => {
  const { server, base } = await startServer(async () => { throw new Error('network down'); });
  t.after(() => server.close());
  await registerShop(base, 'down-shop');
  const res = await client(base)('POST', '/api/chat/down-shop', { message: 'سلام' });
  assert.equal(res.body.source, 'offline');
});

test('an order block from the AI becomes a saved order with the database price', async (t) => {
  let seenHistory = null;
  const fakeAi = async (systemPrompt, history) => {
    seenHistory = history;
    const id = Number(systemPrompt.match(/#(\d+) \| Scarf/)[1]);
    return `ثبت شد!\n<order>{"items":[{"id":${id},"qty":2}],"name":"Sara","phone":"09121234567","address":"Tehran, Azadi St 10"}</order>`;
  };
  const { server, base } = await startServer(fakeAi);
  t.after(() => server.close());
  const owner = await registerShop(base, 'order-shop');
  await owner('POST', '/api/panel/products', { name: 'Scarf', price: 500000 });

  const customer = client(base);
  const res = await customer('POST', '/api/chat/order-shop', { message: 'بله تایید می‌کنم' });
  assert.ok(res.body.orderId);
  assert.doesNotMatch(res.body.reply, /<order>/);
  assert.equal(seenHistory.at(-1).content, 'بله تایید می‌کنم');

  const orders = await owner('GET', '/api/panel/orders');
  assert.equal(orders.body[0].total, 1000000);
  assert.equal(orders.body[0].items[0].qty, 2);
});

test('the bot stops answering once the monthly plan limit is used up', async (t) => {
  const { db, server, base } = await startServer(async () => 'سلام!');
  t.after(() => server.close());
  await registerShop(base, 'busy-shop');
  const { id } = db.prepare("SELECT id FROM stores WHERE slug = 'busy-shop'").get();
  db.prepare("INSERT INTO conversations (id, store_id) VALUES ('c1', ?)").run(id);
  const insert = db.prepare("INSERT INTO messages (conversation_id, role, content, source) VALUES ('c1', 'assistant', 'x', 'ai')");
  for (let i = 0; i < PLAN_LIMITS.free.replies; i++) insert.run();

  const res = await client(base)('POST', '/api/chat/busy-shop', { message: 'سلام' });
  assert.equal(res.body.source, 'limit');
});

test('chat rejects empty and oversized messages', async (t) => {
  const { server, base } = await startServer(null);
  t.after(() => server.close());
  await registerShop(base, 'val-shop');
  const call = client(base);
  assert.equal((await call('POST', '/api/chat/val-shop', { message: '   ' })).status, 400);
  assert.equal((await call('POST', '/api/chat/val-shop', { message: 'x'.repeat(1001) })).status, 400);
  assert.equal((await call('POST', '/api/chat/no-such-shop', { message: 'hi' })).status, 404);
});

test('chat history redraws only this business\'s conversation', async (t) => {
  const { server, base } = await startServer(null);
  t.after(() => server.close());
  await registerShop(base, 'hist-shop');
  await registerShop(base, 'other-shop');
  const call = client(base);
  const first = await call('POST', '/api/chat/hist-shop', { message: 'سلام' });

  const history = await call('GET', `/api/chat/hist-shop/history/${first.body.conversationId}`);
  assert.deepEqual(history.body.map((m) => m.role), ['user', 'assistant']);
  const leaked = await call('GET', `/api/chat/other-shop/history/${first.body.conversationId}`);
  assert.deepEqual(leaked.body, []);
});

test('panel overview counts new orders and this month\'s conversations', async (t) => {
  const { server, base } = await startServer(null);
  t.after(() => server.close());
  const owner = await registerShop(base, 'stats-shop');
  await client(base)('POST', '/api/chat/stats-shop', { message: 'سلام' });
  const panel = await owner('GET', '/api/panel');
  assert.deepEqual(panel.body.stats, { newOrders: 0, conversationsThisMonth: 1 });
});

test('pre-migration session cookie gets a clean 401', async (t) => {
  const { server, base } = await startServer(null);
  t.after(() => server.close());
  const res = await fetch(`${base}/api/panel`, { headers: { cookie: 'sid=deadbeef' } });
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error, 'ابتدا وارد شوید');
});

test('duplicate slug or email returns 409', async (t) => {
  const { server, base } = await startServer(null);
  t.after(() => server.close());
  await registerShop(base, 'dupe-shop');
  const call = client(base);
  const sameSlug = await call('POST', '/api/auth/register', { name: 'Dupe Two', slug: 'dupe-shop', email: 'new@test.ir', password: 'password123' });
  assert.equal(sameSlug.status, 409);
  const sameEmail = await call('POST', '/api/auth/register', { name: 'Fresh Shop', slug: 'fresh-shop', email: 'dupe-shop@test.ir', password: 'password123' });
  assert.equal(sameEmail.status, 409);
});

test('two simultaneous sign-ups with the same email: one 201, one 409', async (t) => {
  const { server, base } = await startServer(null);
  t.after(() => server.close());
  const body = (slug) => ({ name: 'Race Shop', slug, email: 'race@test.ir', password: 'password123' });
  const results = await Promise.all([client(base)('POST', '/api/auth/register', body('race-one')), client(base)('POST', '/api/auth/register', body('race-two'))]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
});
