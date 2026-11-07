// Products and FAQs (knowledge base) through /api/app.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers');

test('products: create, list with filters, edit, delete', async (t) => {
  const { register } = await startApp(t);
  const { call, storeId } = await register('cat-shop');
  const add = (body) => call('POST', '/api/app/products', { storeId, ...body });
  assert.equal((await add({ name: 'Red Rug', price: 100, category: 'Rugs' })).status, 201);
  await add({ name: 'Blue Lamp', price: 50, category: 'Lamps', inStock: false });
  await add({ name: '50% Off Mat', price: 10, category: 'Rugs' });

  const all = (await call('GET', '/api/app/products')).body;
  assert.equal(all.total, 3);
  assert.equal(all.items[0].storeName, 'Shop cat-shop');
  assert.deepEqual((await call('GET', '/api/app/products?category=Rugs&sort=price')).body.items.map((p) => p.name), ['50% Off Mat', 'Red Rug']);
  assert.deepEqual((await call('GET', '/api/app/products?stock=out')).body.items.map((p) => p.name), ['Blue Lamp']);
  assert.deepEqual((await call('GET', `/api/app/products?q=${encodeURIComponent('50%')}`)).body.items.map((p) => p.name), ['50% Off Mat']);
  assert.deepEqual((await call('GET', '/api/app/products?q=%25')).body.items.map((p) => p.name), ['50% Off Mat']);
  assert.deepEqual((await call('GET', `/api/app/products/categories?store=${storeId}`)).body, ['Lamps', 'Rugs']);

  const id = all.items.find((p) => p.name === 'Red Rug').id;
  assert.equal((await call('PUT', `/api/app/products/${id}`, { name: 'Red Rug XL', price: 120, category: 'Rugs', inStock: true })).status, 200);
  assert.equal((await call('DELETE', `/api/app/products/${id}`)).status, 200);
  assert.equal((await call('GET', '/api/app/products')).body.total, 2);
});

test('products: bad sort and huge per are ignored, not errors', async (t) => {
  const { register } = await startApp(t);
  const { call } = await register('sort-shop');
  const res = await call('GET', '/api/app/products?sort=;drop%20table&per=100000&page=-4');
  assert.equal(res.status, 200);
  assert.equal(res.body.page, 1);
});

test('products: synced rows are read-only', async (t) => {
  const { db, register } = await startApp(t);
  const { call, storeId } = await register('sync-shop');
  const { lastInsertRowid } = db.prepare("INSERT INTO products (store_id, name, price, external_id, source) VALUES (?, 'Woo', 5, 'w1', 'woocommerce')").run(storeId);
  const put = await call('PUT', `/api/app/products/${lastInsertRowid}`, { name: 'x', price: 1 });
  assert.equal(put.status, 409);
  assert.match(put.body.error, /همگام‌سازی/);
  assert.equal((await call('DELETE', `/api/app/products/${lastInsertRowid}`)).status, 409);
});

test('products and FAQs of another workspace are untouchable', async (t) => {
  const { register } = await startApp(t);
  const a = await register('cat-a');
  const b = await register('cat-b');
  const { body: { id: productId } } = await a.call('POST', '/api/app/products', { storeId: a.storeId, name: 'Secret', price: 1 });
  const { body: { id: faqId } } = await a.call('POST', '/api/app/faqs', { storeId: a.storeId, question: 'Q?', answer: 'A' });
  assert.equal((await b.call('POST', '/api/app/products', { storeId: a.storeId, name: 'Sneaky', price: 1 })).status, 404);
  assert.equal((await b.call('POST', '/api/app/faqs', { storeId: a.storeId, question: 'Q?', answer: 'A' })).status, 404);
  assert.equal((await b.call('PUT', `/api/app/products/${productId}`, { name: 'x', price: 1 })).status, 404);
  assert.equal((await b.call('DELETE', `/api/app/products/${productId}`)).status, 404);
  assert.equal((await b.call('PUT', `/api/app/faqs/${faqId}`, { question: 'x?', answer: 'y' })).status, 404);
  assert.equal((await b.call('DELETE', `/api/app/faqs/${faqId}`)).status, 404);
  assert.equal((await b.call('GET', '/api/app/products')).body.total, 0);
  assert.equal((await b.call('GET', `/api/app/products?store=${a.storeId}`)).status, 404);
});

test('FAQs: create, search, edit, delete', async (t) => {
  const { register } = await startApp(t);
  const { call, storeId } = await register('faq-shop');
  await call('POST', '/api/app/faqs', { storeId, question: 'هزینه ارسال؟', answer: 'رایگان' });
  await call('POST', '/api/app/faqs', { storeId, question: 'ساعت کاری؟', answer: '۹ تا ۵' });
  const found = (await call('GET', `/api/app/faqs?q=${encodeURIComponent('ارسال')}`)).body;
  assert.equal(found.total, 1);
  const id = found.items[0].id;
  assert.equal((await call('PUT', `/api/app/faqs/${id}`, { question: 'هزینه ارسال چقدر است؟', answer: 'رایگان است' })).status, 200);
  assert.equal((await call('POST', '/api/app/faqs', { storeId, question: '', answer: 'x' })).status, 400);
  assert.equal((await call('DELETE', `/api/app/faqs/${id}`)).status, 200);
  assert.equal((await call('GET', '/api/app/faqs')).body.total, 1);
});
