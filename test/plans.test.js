// Plans: limits, expiry and which replies count toward the monthly limit.
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/db');
const { PLAN_LIMITS, effectivePlan, usageFor } = require('../src/plans');

const DAY_MS = 24 * 60 * 60 * 1000;
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

test('expired pro counts as free', () => {
  const now = new Date('2026-11-07T12:00:00Z');
  const workspace = { plan: 'pro', paid_until: isoDay(now.getTime() - DAY_MS) };
  assert.equal(effectivePlan(workspace, now), 'free');
});

test('pro with no paid_until stays pro', () => {
  assert.equal(effectivePlan({ plan: 'pro', paid_until: null }), 'pro');
  assert.equal(PLAN_LIMITS.pro.replies, 3000);
  assert.equal(PLAN_LIMITS.free.replies, 100);
});

test('offline replies do not count toward usage', () => {
  const db = openDb(':memory:');
  db.exec(`INSERT INTO workspaces (id, name) VALUES (1, 'W');
           INSERT INTO stores (id, workspace_id, slug, name) VALUES (1, 1, 'w-shop', 'W');
           INSERT INTO conversations (id, store_id) VALUES ('c', 1);`);
  const add = db.prepare("INSERT INTO messages (conversation_id, role, content, source) VALUES ('c', 'assistant', 'x', ?)");
  for (const source of ['ai', 'ai', 'offline', 'offline', 'offline']) add.run(source);
  const usage = usageFor(db, { id: 1, plan: 'free', paid_until: null });
  assert.equal(usage.used, 2);
  assert.equal(usage.limit, 100);
  assert.equal(usage.reached, false);
});
