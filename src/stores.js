// Store creation and plan limits, shared by sign-up and the stores API.
const { PLAN_LIMITS, effectivePlan } = require('./plans');

const DEFAULT_TONE = 'دوستانه و محترمانه';
const HOST_PATTERN = /^(localhost|([a-z0-9-]+\.)+[a-z]{2,})$/;

/** Inserts a store and its assistant config (draft = published). Call inside a transaction. */
function insertStore(db, { workspaceId, slug, name, domain = '', description = '', tone = DEFAULT_TONE }) {
  const storeId = Number(db.prepare('INSERT INTO stores (workspace_id, slug, name, domain) VALUES (?, ?, ?, ?)').run(workspaceId, slug, name, domain).lastInsertRowid);
  const config = JSON.stringify({ description, tone });
  db.prepare("INSERT INTO assistant_configs (store_id, draft_json, published_json, published_at) VALUES (?, ?, ?, datetime('now'))").run(storeId, config, config);
  return storeId;
}

/** "https://WWW.Shop.ir/x" -> "www.shop.ir"; '' stays ''; anything that isn't a host name -> null. */
function normalizeDomain(input) {
  const raw = typeof input === 'string' ? input.trim() : '';
  if (!raw) return '';
  try {
    const host = new URL(raw.includes('://') ? raw : `https://${raw}`).hostname.toLowerCase();
    return HOST_PATTERN.test(host) ? host : null;
  } catch {
    return null; // not parseable as a URL: the caller answers 400
  }
}

/** How many connected stores the workspace has and may have on its current plan. */
function storeAllowance(db, workspace) {
  const { used } = db.prepare('SELECT COUNT(*) AS used FROM stores WHERE workspace_id = ? AND disconnected_at IS NULL').get(workspace.id);
  return { used, limit: PLAN_LIMITS[effectivePlan(workspace)].stores };
}

module.exports = { insertStore, normalizeDomain, storeAllowance, DEFAULT_TONE };
