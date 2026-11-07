// Records activity-feed events. Callers pass the store; the workspace is looked up here so a caller
// can never file an event under the wrong workspace.

/** @param {{ storeId: number, type: string, refId?: string|number, summary?: string }} event */
function recordEvent(db, { storeId, type, refId = null, summary = '' }) {
  db.prepare(`
    INSERT INTO events (workspace_id, store_id, type, ref_id, summary)
    SELECT workspace_id, id, ?, ?, ? FROM stores WHERE id = ?
  `).run(type, refId === null ? null : String(refId), summary, storeId);
}

module.exports = { recordEvent };
