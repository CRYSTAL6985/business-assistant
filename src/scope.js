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

module.exports = { workspaceStores, storeFor };
