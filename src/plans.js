// Subscription plans — the revenue model. Pro means more AI replies (and more stores).
// Only real AI replies count toward the monthly limit; offline answers cost nothing and are free.
// Payments are recorded by hand: a pro workspace whose paid_until has passed drops back to free.

const PLAN_LIMITS = {
  free: { replies: 100, stores: 1, integrations: false },
  pro: { replies: 3000, stores: 5, integrations: true },
};

/** SQLite "YYYY-MM-DD HH:MM:SS" (UTC) -> Date. */
const fromSqlite = (value) => new Date(`${value.replace(' ', 'T')}Z`);

/** The plan a workspace actually gets right now: 'pro' only while paid (or with no expiry set). */
function effectivePlan(workspace, now = new Date()) {
  if (workspace.plan !== 'pro') return 'free';
  if (workspace.paid_until && fromSqlite(workspace.paid_until) <= now) return 'free';
  return 'pro';
}

/** AI replies this workspace has used since the 1st of the current month (UTC), across all its stores. */
function monthlyUsage(db, workspaceId) {
  return db.prepare(`
    SELECT COUNT(*) AS used
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    JOIN stores s ON s.id = c.store_id
    WHERE s.workspace_id = ? AND m.role = 'assistant' AND m.source = 'ai'
      AND m.created_at >= strftime('%Y-%m-01 00:00:00', 'now')
  `).get(workspaceId).used;
}

/** @returns {{ plan: 'free'|'pro', used: number, limit: number, reached: boolean }} */
function usageFor(db, workspace, now = new Date()) {
  const plan = effectivePlan(workspace, now);
  const limit = PLAN_LIMITS[plan].replies;
  const used = monthlyUsage(db, workspace.id);
  return { plan, used, limit, reached: used >= limit };
}

module.exports = { PLAN_LIMITS, effectivePlan, usageFor };
