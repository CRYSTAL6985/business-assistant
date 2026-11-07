// Public customer chat: GET store info, POST a message and get the assistant's reply.
// No login — anyone with the link can chat. The flow of one message is in handleMessage().
const crypto = require('node:crypto');
const express = require('express');
const { buildSystemPrompt, extractOrder, validateOrder, offlineAnswer, formatToman } = require('../assistant');
const { usageFor } = require('../plans');
const { recordEvent } = require('../events');
const validate = require('../validate');

const HISTORY_LIMIT = 12; // how many earlier messages the AI sees — keeps prompts small and cheap
const HISTORY_REDRAW_LIMIT = 100;
const MAX_MESSAGE_LENGTH = 1000;
const LIMIT_REACHED_REPLY = 'دستیار این فروشگاه فعلاً در دسترس نیست. لطفاً مستقیم با فروشگاه تماس بگیرید.';

/** Connected store by public slug, with the assistant profile customers get (published config). */
function findStore(db, slug) {
  const row = db.prepare(`
    SELECT s.id, s.slug, s.name, s.workspace_id, c.published_json
    FROM stores s LEFT JOIN assistant_configs c ON c.store_id = s.id
    WHERE s.slug = ? AND s.disconnected_at IS NULL
  `).get(slug);
  if (!row) return null;
  const config = JSON.parse(row.published_json ?? '{}');
  return {
    id: row.id, slug: row.slug, name: row.name, workspace_id: row.workspace_id,
    profile: { name: row.name, description: config.description ?? '', tone: config.tone ?? '' },
  };
}

function workspaceOf(db, store) {
  return db.prepare('SELECT id, plan, paid_until FROM workspaces WHERE id = ?').get(store.workspace_id);
}

/** Reuses the customer's conversation if it belongs to this store, otherwise starts a new one. */
function openConversation(db, storeId, requestedId) {
  if (typeof requestedId === 'string') {
    const existing = db.prepare('SELECT id FROM conversations WHERE id = ? AND store_id = ?').get(requestedId, storeId);
    if (existing) return existing.id;
  }
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO conversations (id, store_id) VALUES (?, ?)').run(id, storeId);
  recordEvent(db, { storeId, type: 'conversation.started', refId: id });
  return id;
}

function saveMessage(db, conversationId, role, content, source = null) {
  db.prepare('INSERT INTO messages (conversation_id, role, content, source) VALUES (?, ?, ?, ?)')
    .run(conversationId, role, content, source);
}

function recentHistory(db, conversationId) {
  const rows = db.prepare(`
    SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ?
  `).all(conversationId, HISTORY_LIMIT);
  return rows.reverse().map((r) => ({ role: r.role, content: r.content }));
}

/** Validates the AI's order block and saves it; returns the line appended to the reply. */
function placeOrder(db, store, conversationId, order, products) {
  const result = validateOrder(order, products);
  if (!result.ok) return { note: `⚠️ سفارش ثبت نشد: ${result.error}`, orderId: null };

  const { name, phone, address, items, total } = result.value;
  const info = db.prepare(`
    INSERT INTO orders (store_id, conversation_id, customer_name, phone, address, items_json, total)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(store.id, conversationId, name, phone, address, JSON.stringify(items), total);
  const orderId = Number(info.lastInsertRowid);
  recordEvent(db, { storeId: store.id, type: 'order.created', refId: orderId, summary: name });
  return { note: `✅ سفارش شما با شمارهٔ ${orderId} ثبت شد. مبلغ کل: ${formatToman(total)}`, orderId };
}

/** One customer message -> one assistant reply. `ask` is the AI call, or null for offline mode. */
async function handleMessage(db, ask, store, conversationId, message) {
  saveMessage(db, conversationId, 'user', message);

  const products = db.prepare('SELECT id, name, description, price, in_stock FROM products WHERE store_id = ? ORDER BY id').all(store.id);
  const faqs = db.prepare('SELECT question, answer FROM faqs WHERE store_id = ? ORDER BY id').all(store.id);

  let reply = null;
  let source = 'ai';
  let orderId = null;

  if (ask) {
    try {
      const raw = await ask(buildSystemPrompt(store.profile, products, faqs), recentHistory(db, conversationId));
      const { text, order, error } = extractOrder(raw);
      reply = text;
      if (error) reply = `${reply}\n\n⚠️ سفارش ثبت نشد: ${error}`;
      if (order) {
        const placed = placeOrder(db, store, conversationId, order, products);
        reply = `${reply}\n\n${placed.note}`.trim();
        orderId = placed.orderId;
      }
    } catch (err) {
      console.error(`[chat] AI call failed for ${store.slug}, answering offline:`, err.message);
      reply = null;
    }
  }

  if (!reply) {
    reply = offlineAnswer(message, products, faqs);
    source = 'offline';
  }

  saveMessage(db, conversationId, 'assistant', reply, source);
  return { reply, source, orderId };
}

function chatRoutes(db, ask) {
  const router = express.Router();

  router.get('/:slug', (req, res) => {
    const store = findStore(db, String(req.params.slug));
    if (!store) return res.status(404).json({ error: 'کسب‌وکار پیدا نشد' });
    res.json({ name: store.name, description: store.profile.description });
  });

  // Lets the chat page redraw an earlier conversation after a reload. The id is a random UUID,
  // so only the browser that started the conversation knows it.
  router.get('/:slug/history/:conversationId', (req, res) => {
    const store = findStore(db, String(req.params.slug));
    if (!store) return res.status(404).json({ error: 'کسب‌وکار پیدا نشد' });
    const messages = db.prepare(`
      SELECT m.role, m.content, m.source FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE c.id = ? AND c.store_id = ? ORDER BY m.id DESC LIMIT ?
    `).all(String(req.params.conversationId), store.id, HISTORY_REDRAW_LIMIT);
    res.json(messages.reverse());
  });

  router.post('/:slug', async (req, res, next) => {
    try {
      const store = findStore(db, String(req.params.slug));
      if (!store) return res.status(404).json({ error: 'کسب‌وکار پیدا نشد' });

      const message = validate.text(req.body?.message, 1, MAX_MESSAGE_LENGTH);
      if (!message) return res.status(400).json({ error: `پیام باید بین ۱ تا ${MAX_MESSAGE_LENGTH} حرف باشد` });

      const conversationId = openConversation(db, store.id, req.body?.conversationId);
      if (usageFor(db, workspaceOf(db, store)).reached) {
        saveMessage(db, conversationId, 'user', message);
        return res.json({ conversationId, reply: LIMIT_REACHED_REPLY, source: 'limit', orderId: null });
      }

      const result = await handleMessage(db, ask, store, conversationId, message);
      res.json({ conversationId, ...result });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = { chatRoutes };
