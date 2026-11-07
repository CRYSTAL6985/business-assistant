// Version 5: the inbox. Conversations get a status (open/closed), a handler (ai/human — human means
// the AI stays silent), an unread flag and the customer's name; staff replies are messages with
// role 'staff'; notes are internal and never reach the customer. widget_sightings records where
// the widget is really installed (origin of the page that loaded it).
module.exports = {
  version: 5,
  name: 'inbox',
  up(db) {
    db.exec(`
      ALTER TABLE conversations ADD COLUMN status TEXT NOT NULL DEFAULT 'open';     -- open | closed
      ALTER TABLE conversations ADD COLUMN handler TEXT NOT NULL DEFAULT 'ai';      -- ai | human
      ALTER TABLE conversations ADD COLUMN customer_name TEXT NOT NULL DEFAULT '';
      ALTER TABLE conversations ADD COLUMN last_message_at TEXT;
      ALTER TABLE conversations ADD COLUMN unread INTEGER NOT NULL DEFAULT 0;
      UPDATE conversations SET last_message_at = COALESCE(
        (SELECT MAX(created_at) FROM messages WHERE conversation_id = conversations.id), created_at);
      CREATE INDEX idx_conversations_store_last ON conversations(store_id, last_message_at);

      ALTER TABLE messages ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;  -- staff author
      ALTER TABLE messages ADD COLUMN context_json TEXT;                                        -- what an answer was based on

      CREATE TABLE conversation_notes (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        user_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
        body            TEXT NOT NULL,
        created_at      TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_notes_conversation ON conversation_notes(conversation_id);

      CREATE TABLE widget_sightings (
        store_id      INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
        origin        TEXT NOT NULL,
        first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_seen_at  TEXT NOT NULL DEFAULT (datetime('now')),
        hits          INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY (store_id, origin)
      );
    `);
  },
};
