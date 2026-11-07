const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildSystemPrompt, extractOrder, validateOrder, offlineAnswer, normalizePhone,
} = require('../src/assistant');

const PRODUCTS = [
  { id: 1, name: 'Garnet Sequin Knit', description: 'red knit', price: 2450000, in_stock: 1 },
  { id: 2, name: 'Espresso Top', description: 'ribbed top', price: 1350000, in_stock: 0 },
];
const FAQS = [
  { question: 'هزینهٔ ارسال چقدر است؟', answer: 'ارسال رایگان است.' },
  { question: 'به شهرستان ارسال دارید؟', answer: 'بله، به همهٔ شهرها.' },
];
const GOOD_ORDER = { items: [{ id: 1, qty: 2 }], name: 'سارا احمدی', phone: '۰۹۱۲ ۱۲۳ ۴۵۶۷', address: 'تهران، خیابان آزادی، پلاک ۱۰' };

test('system prompt lists every product with id, price and stock', () => {
  const prompt = buildSystemPrompt({ name: 'Shop', description: '', tone: 'friendly' }, PRODUCTS, FAQS);
  assert.match(prompt, /#1 \| Garnet Sequin Knit/);
  assert.match(prompt, /ناموجود/);
  assert.match(prompt, /هزینهٔ ارسال/);
});

test('extractOrder removes the hidden order block from the customer-visible text', () => {
  const { text, order } = extractOrder('سفارش شما آماده است.\n<order>{"items":[{"id":1,"qty":1}]}</order>');
  assert.equal(text, 'سفارش شما آماده است.');
  assert.deepEqual(order, { items: [{ id: 1, qty: 1 }] });
});

test('extractOrder reports broken JSON instead of throwing', () => {
  const { order, error } = extractOrder('ok <order>{not json}</order>');
  assert.equal(order, null);
  assert.ok(error);
});

test('validateOrder computes the total from database prices, not from the AI', () => {
  const result = validateOrder({ ...GOOD_ORDER, items: [{ id: 1, qty: 2, price: 1 }], total: 5 }, PRODUCTS);
  assert.equal(result.ok, true);
  assert.equal(result.value.total, 4900000);
  assert.equal(result.value.phone, '09121234567');
});

test('validateOrder rejects unknown products, out-of-stock products and bad quantities', () => {
  assert.equal(validateOrder({ ...GOOD_ORDER, items: [{ id: 99, qty: 1 }] }, PRODUCTS).ok, false);
  assert.equal(validateOrder({ ...GOOD_ORDER, items: [{ id: 2, qty: 1 }] }, PRODUCTS).ok, false);
  assert.equal(validateOrder({ ...GOOD_ORDER, items: [{ id: 1, qty: 0 }] }, PRODUCTS).ok, false);
  assert.equal(validateOrder({ ...GOOD_ORDER, items: [{ id: 1, qty: 1.5 }] }, PRODUCTS).ok, false);
});

test('validateOrder rejects a missing name, phone or address', () => {
  assert.equal(validateOrder({ ...GOOD_ORDER, name: '' }, PRODUCTS).ok, false);
  assert.equal(validateOrder({ ...GOOD_ORDER, phone: '12345' }, PRODUCTS).ok, false);
  assert.equal(validateOrder({ ...GOOD_ORDER, address: 'x' }, PRODUCTS).ok, false);
});

test('normalizePhone accepts the usual ways people type an Iranian mobile', () => {
  for (const input of ['09121234567', '+989121234567', '00989121234567', '9121234567', '۰۹۱۲-۱۲۳-۴۵۶۷']) {
    assert.equal(normalizePhone(input), '09121234567', input);
  }
  assert.equal(normalizePhone('0212345678'), null);
});

test('offline mode answers from the closest FAQ', () => {
  assert.equal(offlineAnswer('ارسال به شهرستان دارید؟', PRODUCTS, FAQS), 'بله، به همهٔ شهرها.');
});

test('offline mode lists in-stock products when asked for prices', () => {
  const reply = offlineAnswer('قیمت محصولات چنده؟', PRODUCTS, FAQS);
  assert.match(reply, /Garnet Sequin Knit/);
  assert.doesNotMatch(reply, /Espresso/);
});

test('offline mode admits it does not know', () => {
  assert.match(offlineAnswer('ساعت کاری جمعه؟', PRODUCTS, FAQS), /ندارم/);
});

test('askModel sends an OpenAI-style request and returns the reply text', async (t) => {
  const http = require('node:http');
  const { askModel } = require('../src/assistant');
  let received = null;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      received = { url: req.url, auth: req.headers.authorization, body: JSON.parse(body) };
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { content: ' سلام! ' } }] }));
    });
  }).listen(0);
  t.after(() => server.close());
  await new Promise((r) => server.once('listening', r));

  const config = { baseUrl: `http://127.0.0.1:${server.address().port}/v1/`, apiKey: 'k', model: 'm:free' };
  const reply = await askModel(config, 'SYSTEM', [{ role: 'user', content: 'hi' }]);

  assert.equal(reply, 'سلام!');
  assert.equal(received.url, '/v1/chat/completions');
  assert.equal(received.auth, 'Bearer k');
  assert.equal(received.body.model, 'm:free');
  assert.deepEqual(received.body.messages[0], { role: 'system', content: 'SYSTEM' });
});
