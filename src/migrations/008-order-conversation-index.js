// Version 8: the inbox shows each conversation's orders; without this index that lookup scans every order.
module.exports = {
  version: 8,
  name: 'order-conversation-index',
  up(db) {
    db.exec('CREATE INDEX idx_orders_conversation ON orders(conversation_id)');
  },
};
