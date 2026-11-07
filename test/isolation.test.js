// Tenant isolation: owner B must never read or change anything in owner A's workspace.
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/db');
const { createApp } = require('../src/server');

async function setup(t) {
  const db = openDb(':memory:');
  const server = createApp({ db, ask: null }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = () => {
    let cookie = '';
    return async (method, path, body) => {
      const res = await fetch(base + path, {
        method, headers: { 'Content-Type': 'application/json', cookie },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const setCookie = res.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';')[0];
      return { status: res.status, body: await res.json() };
    };
  };
  const register = async (slug) => {
    const call = client();
    assert.equal((await call('POST', '/api/auth/register', { name: slug, slug, email: `${slug}@t.ir`, password: 'password123' })).status, 201);
    return call;
  };
  const a = await register('shop-a');
  const b = await register('shop-b');
  const storeA = db.prepare("SELECT id FROM stores WHERE slug = 'shop-a'").get().id;
  return { db, a, b, storeA, anonymous: client() };
}

test('owner B cannot update, delete or see A\'s products', async (t) => {
  const { a, b } = await setup(t);
  const { body: { id } } = await a('POST', '/api/panel/products', { name: 'Secret Rug', price: 9 });
  assert.equal((await b('PUT', `/api/panel/products/${id}`, { name: 'x', price: 1 })).status, 404);
  assert.equal((await b('DELETE', `/api/panel/products/${id}`)).status, 404);
  assert.deepEqual((await b('GET', '/api/panel')).body.products, []);
  assert.equal((await a('GET', '/api/panel')).body.products[0].name, 'Secret Rug');
});

test('owner B cannot update, delete or see A\'s FAQs', async (t) => {
  const { a, b } = await setup(t);
  const { body: { id } } = await a('POST', '/api/panel/faqs', { question: 'Q?', answer: 'A' });
  assert.equal((await b('PUT', `/api/panel/faqs/${id}`, { question: 'x?', answer: 'y' })).status, 404);
  assert.equal((await b('DELETE', `/api/panel/faqs/${id}`)).status, 404);
  assert.deepEqual((await b('GET', '/api/panel')).body.faqs, []);
});

test('owner B cannot change or list A\'s orders', async (t) => {
  const { db, a, b, storeA } = await setup(t);
  const { lastInsertRowid } = db.prepare(`INSERT INTO orders (store_id, customer_name, phone, address, items_json, total)
    VALUES (?, 'Sara', '09120000000', 'Tehran 1', '[]', 5)`).run(storeA);
  assert.equal((await b('PUT', `/api/panel/orders/${lastInsertRowid}`, { status: 'sent' })).status, 404);
  assert.deepEqual((await b('GET', '/api/panel/orders')).body, []);
  assert.equal((await a('GET', '/api/panel/orders')).body.length, 1);
});

test('?store= of another workspace is refused', async (t) => {
  const { b, storeA } = await setup(t);
  const res = await b('GET', `/api/panel?store=${storeA}`);
  assert.equal(res.status, 404);
  assert.equal(res.body.error, 'فروشگاه پیدا نشد');
});

test('chat for A never sees B\'s products', async (t) => {
  const { b, anonymous } = await setup(t);
  await b('POST', '/api/panel/products', { name: 'Velvet Lamp', price: 7 });
  const res = await anonymous('POST', '/api/chat/shop-a', { message: 'Velvet Lamp قیمت' });
  assert.equal(res.status, 200);
  assert.doesNotMatch(res.body.reply, /Velvet Lamp/);
});
