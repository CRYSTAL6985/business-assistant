// Conversation state, human takeover, staff replies, notes, widget config and domain lock.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers');

const say = (base, slug, message, conversationId, headers = {}) => fetch(`${base}/api/chat/${slug}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ message, conversationId }),
}).then(async (r) => ({ status: r.status, body: await r.json() }));

test('customer messages update conversation state and mark it unread', async (t) => {
  const { db, base, register } = await startApp(t);
  await register('st-shop');
  const first = await say(base, 'st-shop', 'سلام');
  const c = db.prepare('SELECT status, handler, unread, last_message_at FROM conversations WHERE id = ?').get(first.body.conversationId);
  assert.deepEqual({ status: c.status, handler: c.handler, unread: c.unread }, { status: 'open', handler: 'ai', unread: 1 });
  assert.ok(c.last_message_at);
  const ctx = JSON.parse(db.prepare("SELECT context_json FROM messages WHERE role = 'assistant'").get().context_json);
  assert.equal(ctx.mode, 'offline');
});

test('after takeover the AI stays silent and staff replies reach the customer', async (t) => {
  let aiCalls = 0;
  const { base, register } = await startApp(t, { ask: async () => { aiCalls++; return 'AI here'; } });
  const { call } = await register('take-shop');
  const first = await say(base, 'take-shop', 'سلام');
  const id = first.body.conversationId;
  assert.equal(aiCalls, 1);
  assert.equal((await call('POST', `/api/app/conversations/${id}/takeover`)).status, 200);
  const second = await say(base, 'take-shop', 'یک انسان لطفاً', id);
  assert.equal(second.body.reply, null);
  assert.equal(second.body.source, 'human');
  assert.match(second.body.notice, /همکاران/);
  assert.equal(aiCalls, 1);

  const history = await fetch(`${base}/api/chat/take-shop/history/${id}`).then((r) => r.json());
  const lastId = history.at(-1).id;
  assert.equal((await call('POST', `/api/app/conversations/${id}/messages`, { content: 'سلام، من مریم هستم' })).status, 201);
  const fresh = await fetch(`${base}/api/chat/take-shop/history/${id}?after=${lastId}`).then((r) => r.json());
  assert.deepEqual(fresh.map((m) => [m.role, m.content]), [['staff', 'سلام، من مریم هستم']]);

  assert.equal((await call('POST', `/api/app/conversations/${id}/release`)).status, 200);
  await say(base, 'take-shop', 'ممنون', id);
  assert.equal(aiCalls, 2);
});

test('a staff reply takes over automatically; closing and a new message reopens', async (t) => {
  const { db, base, register } = await startApp(t);
  const { call } = await register('close-shop');
  const { body: { conversationId: id } } = await say(base, 'close-shop', 'سلام');
  await call('POST', `/api/app/conversations/${id}/messages`, { content: 'در خدمتم' });
  assert.equal(db.prepare('SELECT handler FROM conversations WHERE id = ?').get(id).handler, 'human');
  await call('POST', `/api/app/conversations/${id}/close`);
  assert.equal(db.prepare('SELECT status FROM conversations WHERE id = ?').get(id).status, 'closed');
  await say(base, 'close-shop', 'یک سؤال دیگر', id);
  assert.equal(db.prepare('SELECT status FROM conversations WHERE id = ?').get(id).status, 'open');
});

test('inbox list, filters, detail marks read, notes and customer name', async (t) => {
  const { base, register } = await startApp(t);
  const { call } = await register('ib-shop');
  const a = (await say(base, 'ib-shop', 'قیمت فرش؟')).body.conversationId;
  await say(base, 'ib-shop', 'سلام');
  const list = (await call('GET', '/api/app/conversations')).body;
  assert.equal(list.total, 2);
  assert.equal(list.items[0].unread, true);
  assert.ok(list.items.find((c) => c.id === a).lastMessage);
  assert.equal((await call('GET', `/api/app/conversations?q=${encodeURIComponent('فرش')}`)).body.total, 1);

  const detail = (await call('GET', `/api/app/conversations/${a}`)).body;
  assert.deepEqual(detail.messages.map((m) => m.role), ['user', 'assistant']);
  assert.equal((await call('GET', '/api/app/conversations?unread=1')).body.total, 1);

  assert.equal((await call('POST', `/api/app/conversations/${a}/notes`, { body: 'مشتری ویژه' })).status, 201);
  assert.equal((await call('PUT', `/api/app/conversations/${a}`, { customerName: 'سارا' })).status, 200);
  const again = (await call('GET', `/api/app/conversations/${a}`)).body;
  assert.equal(again.notes[0].body, 'مشتری ویژه');
  assert.equal(again.customerName, 'سارا');
  const notesNotPublic = await fetch(`${base}/api/chat/ib-shop/history/${a}`).then((r) => r.json());
  assert.ok(notesNotPublic.every((m) => m.content !== 'مشتری ویژه'));
});

test('inbox routes refuse another workspace\'s conversation', async (t) => {
  const { base, register } = await startApp(t);
  await register('ib-a');
  const b = await register('ib-b');
  const id = (await say(base, 'ib-a', 'سلام')).body.conversationId;
  for (const [method, path, body] of [['GET', ''], ['PUT', '', { customerName: 'x' }], ['POST', '/takeover'], ['POST', '/release'], ['POST', '/close'], ['POST', '/reopen'], ['POST', '/messages', { content: 'x' }], ['POST', '/notes', { body: 'x' }]]) {
    assert.equal((await b.call(method, `/api/app/conversations/${id}${path}`, body)).status, 404, `${method} ${path}`);
  }
  assert.equal((await b.call('GET', '/api/app/conversations')).body.total, 0);
});

test('widget config: allowed origins get CORS and a sighting; others are refused', async (t) => {
  const { db, base, register } = await startApp(t);
  const { call, storeId } = await register('wid-shop');
  await call('PUT', `/api/app/stores/${storeId}`, { name: 'Shop wid-shop', domain: 'wid.ir' });
  const ok = await fetch(`${base}/api/chat/wid-shop/config`, { headers: { Origin: 'https://www.wid.ir' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('access-control-allow-origin'), 'https://www.wid.ir');
  const config = await ok.json();
  assert.equal(config.name, 'Shop wid-shop');
  assert.ok(['left', 'right'].includes(config.position));
  const bad = await fetch(`${base}/api/chat/wid-shop/config`, { headers: { Origin: 'https://evil.example' } });
  assert.equal(bad.status, 403);
  assert.equal(bad.headers.get('access-control-allow-origin'), null);
  await fetch(`${base}/api/chat/wid-shop/config`, { headers: { Origin: 'https://www.wid.ir' } });
  const sighting = db.prepare('SELECT origin, hits FROM widget_sightings WHERE store_id = ?').get(storeId);
  assert.deepEqual({ ...sighting }, { origin: 'https://www.wid.ir', hits: 2 });
  const frame = (await fetch(`${base}/chat/wid-shop`)).headers.get('content-security-policy');
  assert.match(frame, /frame-ancestors 'self' https:\/\/wid\.ir/);
  assert.equal((await call('GET', '/api/app/stores')).body.items[0].sightings[0].origin, 'https://www.wid.ir');
});
