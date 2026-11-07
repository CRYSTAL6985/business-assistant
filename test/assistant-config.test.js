// Assistant configuration: defaults, validation, prompt effects, draft/publish API, test chat.
const test = require('node:test');
const assert = require('node:assert/strict');
const { defaults, normalize, validateDraft } = require('../src/assistantConfig');
const { buildSystemPrompt, offlineReply } = require('../src/assistant');
const { startApp } = require('./helpers');

test('missing keys get defaults that mention the store', () => {
  const c = normalize({ tone: 'رسمی' }, 'Rug House');
  assert.equal(c.tone, 'رسمی');
  assert.match(c.assistantName, /Rug House/);
  assert.equal(c.orderTaking, true);
  assert.deepEqual(c.languages, ['fa']);
  assert.equal(defaults('X').position, 'left');
});

test('validateDraft rejects bad colours, positions and oversized text', () => {
  assert.equal(validateDraft({ ...defaults('S'), color: 'red' }).ok, false);
  assert.equal(validateDraft({ ...defaults('S'), position: 'top' }).ok, false);
  assert.equal(validateDraft({ ...defaults('S'), instructions: 'x'.repeat(5001) }).ok, false);
  assert.equal(validateDraft({ ...defaults('S'), languages: ['fa', 'klingon'] }).ok, false);
  const ok = validateDraft({ ...defaults('S'), color: '#AABBCC', launcherText: 'سؤال دارید؟' });
  assert.equal(ok.ok, true);
  assert.equal(ok.value.color, '#aabbcc');
});

test('prompt carries instructions and policies; order section only when order taking is on', () => {
  const profile = { ...defaults('Shop'), name: 'Shop', instructions: 'Always greet warmly', policies: 'Returns within 7 days' };
  const on = buildSystemPrompt(profile, [], []);
  assert.match(on, /Always greet warmly/);
  assert.match(on, /Returns within 7 days/);
  assert.match(on, /<order>/);
  const off = buildSystemPrompt({ ...profile, orderTaking: false }, [], []);
  assert.doesNotMatch(off, /<order>/);
  assert.match(off, /Do not take orders/);
});

test('offlineReply reports what it matched and uses the custom fallback', () => {
  const faqs = [{ id: 4, question: 'هزینه ارسال چقدر است؟', answer: 'رایگان' }];
  const hit = offlineReply('ارسال چقدر هزینه داره؟', [], faqs);
  assert.deepEqual({ text: hit.text, matched: hit.matched, faqId: hit.faqId }, { text: 'رایگان', matched: 'faq', faqId: 4 });
  const miss = offlineReply('ساعت کاری؟', [], faqs, { fallbackMessage: 'با ۰۲۱۱۲۳۴ تماس بگیرید' });
  assert.equal(miss.matched, 'none');
  assert.equal(miss.text, 'با ۰۲۱۱۲۳۴ تماس بگیرید');
});

test('draft is private until published; discard restores the published config', async (t) => {
  const { base, register } = await startApp(t);
  const { call, storeId } = await register('cfg-shop');
  const start = (await call('GET', `/api/app/assistant?store=${storeId}`)).body;
  assert.equal(start.hasChanges, false);
  const draft = { ...start.draft, welcome: 'خوش آمدید به فروشگاه ما', color: '#123456' };
  assert.equal((await call('PUT', `/api/app/assistant/${storeId}/draft`, { config: draft })).status, 200);
  let cfg = await fetch(`${base}/api/chat/cfg-shop/config`).then((r) => r.json());
  assert.notEqual(cfg.welcome, 'خوش آمدید به فروشگاه ما');
  assert.equal((await call('GET', `/api/app/assistant?store=${storeId}`)).body.hasChanges, true);
  assert.equal((await call('POST', `/api/app/assistant/${storeId}/publish`)).status, 200);
  cfg = await fetch(`${base}/api/chat/cfg-shop/config`).then((r) => r.json());
  assert.equal(cfg.welcome, 'خوش آمدید به فروشگاه ما');
  assert.equal(cfg.color, '#123456');
  await call('PUT', `/api/app/assistant/${storeId}/draft`, { config: { ...draft, welcome: 'نسخهٔ آزمایشی' } });
  await call('POST', `/api/app/assistant/${storeId}/discard`);
  assert.equal((await call('GET', `/api/app/assistant?store=${storeId}`)).body.draft.welcome, 'خوش آمدید به فروشگاه ما');
  assert.equal((await call('PUT', `/api/app/assistant/${storeId}/draft`, { config: { ...draft, color: 'blue' } })).status, 400);
});

test('test chat uses the draft and writes nothing', async (t) => {
  let seenPrompt = '';
  const ai = async (prompt) => {
    seenPrompt = prompt;
    const id = Number(prompt.match(/#(\d+) \| Rug/)[1]);
    return `باشه <order>{"items":[{"id":${id},"qty":2}],"name":"Sara","phone":"09121234567","address":"Tehran, Azadi 10"}</order>`;
  };
  const { db, register } = await startApp(t, { ask: ai });
  const { call, storeId } = await register('tst-shop');
  await call('POST', '/api/app/products', { storeId, name: 'Rug', price: 100 });
  const { body: cfg } = await call('GET', `/api/app/assistant?store=${storeId}`);
  await call('PUT', `/api/app/assistant/${storeId}/draft`, { config: { ...cfg.draft, instructions: 'DRAFT-ONLY-RULE' } });
  const res = await call('POST', `/api/app/assistant/${storeId}/test`, { history: [], message: 'دو تا فرش می‌خوام' });
  assert.equal(res.status, 200);
  assert.match(seenPrompt, /DRAFT-ONLY-RULE/);
  assert.equal(res.body.context.order.ok, true);
  assert.equal(res.body.context.order.total, 200);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM orders').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM conversations').get().n, 0);
});

test('with order taking off the server ignores order blocks', async (t) => {
  const ai = async (prompt) => {
    const id = Number((prompt.match(/#(\d+) \| Rug/) ?? [0, 1])[1]);
    return `ok <order>{"items":[{"id":${id},"qty":1}],"name":"Sara","phone":"09121234567","address":"Tehran, Azadi 10"}</order>`;
  };
  const { db, base, register } = await startApp(t, { ask: ai });
  const { call, storeId } = await register('noord-shop');
  await call('POST', '/api/app/products', { storeId, name: 'Rug', price: 100 });
  const { body: cfg } = await call('GET', `/api/app/assistant?store=${storeId}`);
  await call('PUT', `/api/app/assistant/${storeId}/draft`, { config: { ...cfg.draft, orderTaking: false } });
  await call('POST', `/api/app/assistant/${storeId}/publish`);
  const reply = await fetch(`${base}/api/chat/noord-shop`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'بله' }) }).then((r) => r.json());
  assert.equal(reply.orderId, null);
  assert.doesNotMatch(reply.reply, /<order>/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM orders').get().n, 0);
});

test('assistant settings of another workspace are 404', async (t) => {
  const { register } = await startApp(t);
  const a = await register('cfg-a');
  const b = await register('cfg-b');
  assert.equal((await b.call('GET', `/api/app/assistant?store=${a.storeId}`)).status, 404);
  for (const path of ['publish', 'discard']) assert.equal((await b.call('POST', `/api/app/assistant/${a.storeId}/${path}`)).status, 404);
  assert.equal((await b.call('PUT', `/api/app/assistant/${a.storeId}/draft`, { config: {} })).status, 404);
  assert.equal((await b.call('POST', `/api/app/assistant/${a.storeId}/test`, { message: 'hi' })).status, 404);
});
