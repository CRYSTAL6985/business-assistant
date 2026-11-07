// Inbox actions shared by the owner panel and the public API.
const { recordEvent } = require('./events');

/** Hands the chat to a person (the AI stops replying). Recorded once per takeover for analytics. */
function takeOver(db, conversationId) {
  const c = db.prepare('SELECT store_id, handler FROM conversations WHERE id = ?').get(conversationId);
  if (!c || c.handler === 'human') return;
  db.prepare("UPDATE conversations SET handler = 'human' WHERE id = ?").run(conversationId);
  recordEvent(db, { storeId: c.store_id, type: 'conversation.takeover', refId: conversationId });
}

/** A person answers the customer: saved as a staff message, and the AI steps back from this chat. */
function addStaffReply(db, conversationId, content, userId = null) {
  takeOver(db, conversationId);
  const info = db.prepare("INSERT INTO messages (conversation_id, role, content, source, user_id) VALUES (?, 'staff', ?, 'staff', ?)").run(conversationId, content, userId);
  db.prepare("UPDATE conversations SET status = 'open', unread = 0, last_message_at = datetime('now'), waiting_notified_at = NULL WHERE id = ?").run(conversationId);
  return Number(info.lastInsertRowid);
}

module.exports = { addStaffReply, takeOver };
