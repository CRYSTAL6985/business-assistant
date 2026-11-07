// Inbox: the workspace's conversations, human takeover, staff replies and internal notes.
// "Waiting" = the last message is the customer's and nobody (AI or staff) has answered it yet.
const express = require('express');
const validate = require('../../validate');
const { requestStores } = require('../../scope');
const { parsePaging, pageResult, likePattern } = require('../../paging');
const { addStaffReply, takeOver } = require('../../inbox');

const NOT_FOUND = { error: 'گفتگو پیدا نشد' };
const MAX_REPLY = 2000;
const MAX_NOTE = 1000;
const marks = (ids) => ids.map(() => '?').join(',');
const LAST = '(SELECT id FROM messages WHERE conversation_id = c.id ORDER BY id DESC LIMIT 1)';

function conversationRoutes(db) {
  const router = express.Router();

  /** The conversation by id, only if it belongs to one of the workspace's stores. */
  const own = (req) => db.prepare(`SELECT c.*, s.name AS store_name, s.slug AS store_slug FROM conversations c JOIN stores s ON s.id = c.store_id
    WHERE c.id = ? AND s.workspace_id = ?`).get(String(req.params.id), req.workspaceId);
  const withOwn = (handler) => (req, res) => {
    const conversation = own(req);
    if (!conversation) return res.status(404).json(NOT_FOUND);
    handler(req, res, conversation);
  };

  router.get('/', (req, res) => {
    const stores = requestStores(db, req);
    if (!stores) return res.status(404).json({ error: 'فروشگاه پیدا نشد' });
    const paging = parsePaging(req.query);
    if (!stores.length) return res.json(pageResult([], 0, paging));
    const where = [`c.store_id IN (${marks(stores)})`];
    const params = stores.map((s) => s.id);
    if (req.query.status === 'open' || req.query.status === 'closed') { where.push('c.status = ?'); params.push(req.query.status); }
    if (req.query.status === 'waiting') where.push(`c.status = 'open' AND last.role = 'user'`);
    if (req.query.handler === 'ai' || req.query.handler === 'human') { where.push('c.handler = ?'); params.push(req.query.handler); }
    if (req.query.unread === '1') where.push('c.unread = 1');
    if (req.query.q) {
      where.push(`(c.customer_name LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM messages q WHERE q.conversation_id = c.id AND q.content LIKE ? ESCAPE '\\'))`);
      params.push(likePattern(req.query.q), likePattern(req.query.q));
    }
    const from = `FROM conversations c JOIN stores s ON s.id = c.store_id LEFT JOIN messages last ON last.id = ${LAST} WHERE ${where.join(' AND ')}`;
    const { total } = db.prepare(`SELECT COUNT(*) AS total ${from}`).get(...params);
    const rows = db.prepare(`SELECT c.id, c.store_id AS storeId, s.name AS storeName, c.customer_name AS customerName, c.status, c.handler, c.unread,
        COALESCE(c.last_message_at, c.created_at) AS lastMessageAt, last.content AS lastMessage, last.role AS lastRole, last.source AS lastSource
      ${from} ORDER BY COALESCE(c.last_message_at, c.created_at) DESC, c.rowid DESC LIMIT ? OFFSET ?`).all(...params, paging.per, paging.offset);
    res.json(pageResult(rows.map((r) => ({ ...r, unread: Boolean(r.unread), waiting: r.status === 'open' && r.lastRole === 'user' })), total, paging));
  });

  router.get('/:id', withOwn((req, res, c) => {
    db.prepare('UPDATE conversations SET unread = 0 WHERE id = ?').run(c.id);
    const messages = db.prepare(`SELECT m.id, m.role, m.content, m.source, m.created_at AS createdAt, m.context_json AS contextJson, u.name AS author
      FROM messages m LEFT JOIN users u ON u.id = m.user_id WHERE m.conversation_id = ? ORDER BY m.id`).all(c.id)
      .map(({ contextJson, ...m }) => ({ ...m, context: contextJson ? JSON.parse(contextJson) : null }));
    const notes = db.prepare(`SELECT n.id, n.body, n.created_at AS createdAt, u.name AS author FROM conversation_notes n
      LEFT JOIN users u ON u.id = n.user_id WHERE n.conversation_id = ? ORDER BY n.id`).all(c.id);
    const orders = db.prepare('SELECT id, total, status, created_at AS createdAt FROM orders WHERE conversation_id = ? ORDER BY id').all(c.id);
    res.json({
      id: c.id, storeId: c.store_id, storeName: c.store_name, storeSlug: c.store_slug, customerName: c.customer_name,
      status: c.status, handler: c.handler, createdAt: c.created_at, lastMessageAt: c.last_message_at, messages, notes, orders,
    });
  }));

  router.put('/:id', withOwn((req, res, c) => {
    const name = validate.text(req.body?.customerName ?? '', 0, 80);
    if (name === null) return res.status(400).json({ error: 'نام مشتری حداکثر ۸۰ حرف' });
    db.prepare('UPDATE conversations SET customer_name = ? WHERE id = ?').run(name, c.id);
    res.json({ ok: true });
  }));

  const setState = (sql) => withOwn((req, res, c) => { db.prepare(sql).run(c.id); res.json({ ok: true }); });
  router.post('/:id/takeover', withOwn((req, res, c) => { takeOver(db, c.id); res.json({ ok: true }); }));
  router.post('/:id/release', setState("UPDATE conversations SET handler = 'ai' WHERE id = ?"));
  router.post('/:id/close', setState("UPDATE conversations SET status = 'closed', unread = 0 WHERE id = ?"));
  router.post('/:id/reopen', setState("UPDATE conversations SET status = 'open' WHERE id = ?"));

  router.post('/:id/messages', withOwn((req, res, c) => {
    const content = validate.text(req.body?.content, 1, MAX_REPLY);
    if (!content) return res.status(400).json({ error: `پاسخ باید بین ۱ تا ${MAX_REPLY} حرف باشد` });
    res.status(201).json({ id: addStaffReply(db, c.id, content, req.userId) });
  }));

  router.post('/:id/notes', withOwn((req, res, c) => {
    const body = validate.text(req.body?.body, 1, MAX_NOTE);
    if (!body) return res.status(400).json({ error: `یادداشت باید بین ۱ تا ${MAX_NOTE} حرف باشد` });
    const info = db.prepare('INSERT INTO conversation_notes (conversation_id, user_id, body) VALUES (?, ?, ?)').run(c.id, req.userId, body);
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  }));

  return router;
}

module.exports = { conversationRoutes };
