// Tenant isolation lives here. Every owner route asks this module which stores the signed-in user
// may touch; a store id from the browser is never used without passing through storeFor().

const STORE_COLUMNS = 'id, workspace_id, slug, name, domain, platform';

/** Connected stores of a workspace, oldest first. */
function workspaceStores(db, workspaceId) {
  return db.prepare(`SELECT ${STORE_COLUMNS} FROM stores WHERE workspace_id = ? AND disconnected_at IS NULL ORDER BY id`)
    .all(workspaceId);
}

/**
 * The store the request may act on: storeId if it belongs to the user's active workspace,
 * otherwise (no id given) the workspace's first store. Null when not allowed or not found.
 */
function storeFor(db, req, storeId) {
  if (storeId === undefined) return workspaceStores(db, req.workspaceId)[0] ?? null;
  return db.prepare(`SELECT ${STORE_COLUMNS} FROM stores WHERE id = ? AND workspace_id = ? AND disconnected_at IS NULL`)
    .get(storeId, req.workspaceId) ?? null;
}

/**
 * The stores a list request covers: the one named by ?store= (if it is the workspace's own) or all
 * connected stores. Null means ?store= named a store the user may not see -> answer 404.
 */
function requestStores(db, req) {
  const raw = req.query.store;
  if (raw === undefined || raw === '') return workspaceStores(db, req.workspaceId);
  const id = Number(raw);
  const store = Number.isInteger(id) && id > 0 ? storeFor(db, req, id) : null;
  return store ? [store] : null;
}

/** A row of `table` (which has store_id) by id, only if its store belongs to the user's workspace. */
function ownedRow(db, req, table, id) {
  if (!Number.isInteger(id) || id <= 0) return null;
  return db.prepare(`SELECT r.*, s.name AS store_name FROM ${table} r JOIN stores s ON s.id = r.store_id WHERE r.id = ? AND s.workspace_id = ?`)
    .get(id, req.workspaceId) ?? null;
}

module.exports = { workspaceStores, storeFor, requestStores, ownedRow };
