// Subscription plans — the revenue model. A plan caps how many assistant replies a business
// gets per calendar month; past the cap the bot politely stops and the owner is asked to upgrade.

const PLAN_LIMITS = {
  free: 100,
  pro: 5000,
};

/** Assistant replies this business has used since the 1st of the current month (UTC). */
function monthlyUsage(db, businessId) {
  const row = db.prepare(`
    SELECT COUNT(*) AS used
    FROM messages m JOIN conversations c ON c.id = m.conversation_id
    WHERE c.business_id = ? AND m.role = 'assistant'
      AND m.created_at >= strftime('%Y-%m-01 00:00:00', 'now')
  `).get(businessId);
  return row.used;
}

function usageFor(db, business) {
  const limit = PLAN_LIMITS[business.plan] ?? PLAN_LIMITS.free;
  const used = monthlyUsage(db, business.id);
  return { plan: business.plan, used, limit, reached: used >= limit };
}

module.exports = { PLAN_LIMITS, usageFor };
