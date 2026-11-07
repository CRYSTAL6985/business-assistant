// Public customer chat: GET store info and widget config, POST a message and get the assistant's
// reply, GET history (and new messages since an id, for staff replies). No login — anyone with the
// link can chat; requests from other websites are only accepted from the store's own domain.
const crypto = require('node:crypto');
const express = require('express');
const { buildSystemPrompt, extractOrder, validateOrder, offlineAnswer, formatToman } = require('../assistant');
const { usageFor } = require('../plans');
const { recordEvent } = require('../events');
const { originAllowed, isOwnOrigin } = require('../origins');
const validate = require('../validate');

const HISTORY_LIMIT = 12; // how many earlier messages the AI sees — keeps prompts small and cheap
const HISTORY_REDRAW_LIMIT = 100;
const MAX_MESSAGE_LENGTH = 1000;
const LIMIT_REACHED_REPLY = 'دستیار این فروشگاه فعلاً در دسترس نیست. لطفاً مستقیم با فروشگاه تماس بگیرید.';
const HUMAN_NOTICE = 'یکی از همکاران ما به‌زودی پاسخ می‌دهد.';
const DEFAULT_COLOR = '#2f6fe4';
const NOT_FOUND = { error: 'کسب‌وکار پیدا نشد' };
const FOREIGN = { error: 'این دستیار برای این سایت فعال نیست' };

/** Connected store by public slug, with the assistant profile customers get (published config). */
function findStore(db, slug) {
  const row = db.prepare(`
    SELECT s.id, s.slug, s.name, s.domain, s.workspace_id, c.published_json
    FROM stores s LEFT JOIN assistant_configs c ON c.store_id = s.id
    WHERE s.slug = ? AND s.disconnected_at IS NULL
  `).get(slug);
  if (!row) return null;
  const config = JSON.parse(row.published_json ?? '{}');
  return {
    id: row.id, slug: row.slug, name: row.name, domain: row.domain, workspace_id: row.workspace_id, config,
    profile: { name: row.name, description: config.description ?? '', tone: config.tone ?? '' },
  };
}

function workspaceOf(db, store) {
  return db.prepare('SELECT id, plan, paid_until FROM workspaces WHERE id = ?').get(store.workspace_id);
}

/** Reuses the customer's conversation if it belongs to this store, otherwise starts a new one. */
function openConversation(db, storeId, requestedId) {
  if (typeof requestedId === 'string') {
    const existing = db.prepare('SELECT id, handler FROM conversations WHERE id = ? AND store_id = ?').get(requestedId, storeId);
    if (existing) return existing;
  }
  const id = crypto.randomUUID();
  db.prepare("INSERT INTO conversations (id, store_id, last_message_at) VALUES (?, ?, datetime('now'))").run(id, storeId);
  recordEvent(db, { storeId, type: 'conversation.started', refId: id });
  return { id, handler: 'ai' };
}

function saveMessage(db, conversationId, role, content, { source = null, context = null } = {}) {
  db.prepare('INSERT INTO messages (conversation_id, role, content, source, context_json) VALUES (?, ?, ?, ?, ?)')
    .run(conversationId, role, content, source, context ? JSON.stringify(context) : null);
}

/** A customer wrote: the conversation is (re)opened, unread for the owner, and sorted to the top. */
function saveCustomerMessage(db, conversationId, content) {
  saveMessage(db, conversationId, 'user', content);
  db.prepare("UPDATE conversations SET last_message_at = datetime('now'), unread = 1, status = 'open' WHERE id = ?").run(conversationId);
}

function recentHistory(db, conversationId) {
  const rows = db.prepare(`
    SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ?
  `).all(conversationId, HISTORY_LIMIT);
  // Staff replies are shown to the model as assistant turns so it knows what the shop already said.
  return rows.reverse().map((r) => ({ role: r.role === 'user' ? 'user' : 'assistant', content: r.content }));
}

/** Validates the AI's order block and saves it; returns the line appended to the reply. */
function placeOrder(db, store, conversationId, order, products) {
  const result = validateOrder(order, products);
  if (!result.ok) return { note: `⚠️ سفارش ثبت نشد: ${result.error}`, orderId: null, error: result.error };

  const { name, phone, address, items, total } = result.value;
  const info = db.prepare(`
    INSERT INTO orders (store_id, conversation_id, customer_name, phone, address, items_json, total)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(store.id, conversationId, name, phone, address, JSON.stringify(items), total);
  const orderId = Number(info.lastInsertRowid);
  recordEvent(db, { storeId: store.id, type: 'order.created', refId: orderId, summary: name });
  db.prepare("UPDATE conversations SET customer_name = CASE WHEN customer_name = '' THEN ? ELSE customer_name END WHERE id = ?").run(name, conversationId);
  return { note: `✅ سفارش شما با شمارهٔ ${orderId} ثبت شد. مبلغ کل: ${formatToman(total)}`, orderId, error: null };
}

/** One customer message -> one assistant reply. `ask` is the AI call, or null for offline mode. */
async function handleMessage(db, ask, store, conversationId, message) {
  saveCustomerMessage(db, conversationId, message);

  const products = db.prepare('SELECT id, name, description, price, in_stock FROM products WHERE store_id = ? ORDER BY id').all(store.id);
  const faqs = db.prepare('SELECT id, question, answer FROM faqs WHERE store_id = ? ORDER BY id').all(store.id);

  let reply = null;
  let source = 'ai';
  let orderId = null;
  let context = null;

  if (ask) {
    try {
      const raw = await ask(buildSystemPrompt(store.profile, products, faqs), recentHistory(db, conversationId));
      const { text, order, error } = extractOrder(raw);
      reply = text;
      context = { mode: 'ai', productIds: products.map((p) => p.id), faqIds: faqs.map((f) => f.id), order: null };
      if (error) { reply = `${reply}\n\n⚠️ سفارش ثبت نشد: ${error}`; context.order = { ok: false, error }; }
      if (order) {
        const placed = placeOrder(db, store, conversationId, order, products);
        reply = `${reply}\n\n${placed.note}`.trim();
        orderId = placed.orderId;
        context.order = placed.orderId ? { ok: true, orderId } : { ok: false, error: placed.error };
      }
    } catch (err) {
      console.error(`[chat] AI call failed for ${store.slug}, answering offline:`, err.message);
      reply = null;
    }
  }

  if (!reply) {
    reply = offlineAnswer(message, products, faqs);
    source = 'offline';
    context = { mode: 'offline' };
  }

  saveMessage(db, conversationId, 'assistant', reply, { source, context });
  return { reply, source, orderId };
}

function chatRoutes(db, ask) {
  const router = express.Router();

  // Every route below resolves the store and refuses requests from other websites.
  router.param('slug', (req, res, next, slug) => {
    req.store = findStore(db, String(slug));
    if (!req.store) return res.status(404).json(NOT_FOUND);
    if (!originAllowed(req, req.store)) return res.status(403).json(FOREIGN);
    next();
  });

  router.get('/:slug', (req, res) => {
    res.json({ name: req.store.name, description: req.store.profile.description });
  });

  // Branding for widget.js. Answered cross-origin only to the store's own site, which is also
  // where we learn that the widget is really installed.
  router.get('/:slug/config', (req, res) => {
    const { store } = req;
    if (!isOwnOrigin(req)) {
      res.set('Access-Control-Allow-Origin', req.get('origin'));
      res.set('Vary', 'Origin');
      db.prepare(`INSERT INTO widget_sightings (store_id, origin) VALUES (?, ?)
        ON CONFLICT(store_id, origin) DO UPDATE SET last_seen_at = datetime('now'), hits = hits + 1`).run(store.id, req.get('origin'));
    }
    const c = store.config;
    res.json({
      name: store.name,
      welcome: c.welcome || `سلام! من دستیار ${store.name} هستم. دربارهٔ محصولات و قیمت‌ها بپرسید، یا همین‌جا سفارش بدهید.`,
      color: /^#[0-9a-f]{6}$/i.test(c.color ?? '') ? c.color : DEFAULT_COLOR,
      position: c.position === 'right' ? 'right' : 'left',
      launcherText: typeof c.launcherText === 'string' ? c.launcherText.slice(0, 30) : '',
    });
  });

  // Redraws an earlier conversation after a reload; ?after=<id> returns only newer messages (staff
  // replies arriving while the page is open). The id is a random UUID only that browser knows.
  router.get('/:slug/history/:conversationId', (req, res) => {
    const after = validate.id(req.query.after);
    const rows = after
      ? db.prepare(`SELECT m.id, m.role, m.content, m.source FROM messages m JOIN conversations c ON c.id = m.conversation_id
          WHERE c.id = ? AND c.store_id = ? AND m.id > ? ORDER BY m.id LIMIT ?`).all(String(req.params.conversationId), req.store.id, after, HISTORY_REDRAW_LIMIT)
      : db.prepare(`SELECT m.id, m.role, m.content, m.source FROM messages m JOIN conversations c ON c.id = m.conversation_id
          WHERE c.id = ? AND c.store_id = ? ORDER BY m.id DESC LIMIT ?`).all(String(req.params.conversationId), req.store.id, HISTORY_REDRAW_LIMIT).reverse();
    res.json(rows);
  });

  router.post('/:slug', async (req, res, next) => {
    try {
      const { store } = req;
      const message = validate.text(req.body?.message, 1, MAX_MESSAGE_LENGTH);
      if (!message) return res.status(400).json({ error: `پیام باید بین ۱ تا ${MAX_MESSAGE_LENGTH} حرف باشد` });

      const conversation = openConversation(db, store.id, req.body?.conversationId);
      if (conversation.handler === 'human') {
        saveCustomerMessage(db, conversation.id, message);
        return res.json({ conversationId: conversation.id, reply: null, source: 'human', notice: HUMAN_NOTICE, orderId: null });
      }
      if (usageFor(db, workspaceOf(db, store)).reached) {
        saveCustomerMessage(db, conversation.id, message);
        return res.json({ conversationId: conversation.id, reply: LIMIT_REACHED_REPLY, source: 'limit', orderId: null });
      }

      const result = await handleMessage(db, ask, store, conversation.id, message);
      res.json({ conversationId: conversation.id, ...result });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = { chatRoutes, findStore };
