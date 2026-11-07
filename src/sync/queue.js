// Runs WooCommerce syncs off the request path: one job per store at a time (a second request while
// one runs gets the same promise), network failures retried with backoff, auth/config errors not.
// Every run is recorded in sync_runs; the outcome lands on the integration for the owner to see.
const { wooClient, tomanFactor, productRow, orderRow, WooError } = require('./woocommerce');
const { upsertProducts, upsertOrders } = require('./upsert');
const { toSqlite } = require('../time');

const FIRST_IMPORT_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;
const RETRY_DELAYS_MS = [2_000, 10_000];
const GENERIC_ERROR = 'همگام‌سازی به خطای غیرمنتظره خورد. دوباره امتحان کنید.';

const isoOf = (sqlite) => `${sqlite.replace(' ', 'T')}Z`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {{ db, cipher, fetch?: typeof fetch, retryDelays?: number[] }} deps
 */
function createSyncQueue({ db, cipher, fetch: doFetch = fetch, retryDelays = RETRY_DELAYS_MS }) {
  const running = new Map(); // storeId -> Promise

  const integrationOf = (storeId) => db.prepare("SELECT * FROM integrations WHERE store_id = ? AND type = 'woocommerce'").get(storeId);

  function clientFor(integration) {
    const { key, secret } = JSON.parse(cipher.decrypt(integration.credentials_enc));
    return wooClient({ siteUrl: integration.site_url, key, secret, fetch: doFetch });
  }

  async function importAll(storeId, client, factor, cursor, counts) {
    const add = (r) => { counts.created += r.created; counts.updated += r.updated; };
    const since = cursor ? { modified_after: isoOf(cursor) } : {};
    for await (const page of client.pages('/products', since)) {
      const rows = [];
      for (const p of page) {
        if (p.type === 'variable') {
          if (p.status && p.status !== 'publish') continue;
          for await (const variations of client.pages(`/products/${p.id}/variations`)) rows.push(...variations.map((v) => productRow(v, factor, p)));
        } else {
          rows.push(productRow(p, factor));
        }
      }
      add(upsertProducts(db, storeId, rows.filter(Boolean), 'woocommerce'));
    }
    const orderQuery = cursor ? { modified_after: isoOf(cursor) } : { after: new Date(Date.now() - FIRST_IMPORT_DAYS * DAY_MS).toISOString().slice(0, 19) };
    for await (const page of client.pages('/orders', orderQuery)) {
      add(upsertOrders(db, storeId, page.map((o) => orderRow(o, factor)), 'woocommerce', { announce: Boolean(cursor) }));
    }
  }

  async function attempt(storeId, integration, counts) {
    const client = clientFor(integration);
    const currency = await client.currency();
    const factor = tomanFactor(currency);
    db.prepare('UPDATE integrations SET currency = ? WHERE id = ?').run(currency, integration.id);
    await importAll(storeId, client, factor, integration.last_sync_at, counts);
  }

  async function runOnce(storeId) {
    const integration = integrationOf(storeId);
    if (!integration) return null;
    const startedAt = toSqlite(Date.now());
    const kind = integration.last_sync_at ? 'incremental' : 'full';
    const runId = Number(db.prepare('INSERT INTO sync_runs (store_id, kind, started_at) VALUES (?, ?, ?)').run(storeId, kind, startedAt).lastInsertRowid);
    const counts = { created: 0, updated: 0 };
    let error = null;
    for (let i = 0; ; i++) {
      try {
        await attempt(storeId, integration, counts);
        error = null;
        break;
      } catch (err) {
        error = err;
        const retry = err instanceof WooError && err.retryable && i < retryDelays.length;
        if (!retry) break;
        await sleep(retryDelays[i]);
      }
    }
    if (error && !(error instanceof WooError)) console.error(`[sync] store ${storeId}:`, error);
    const message = error ? (error instanceof WooError ? error.message : GENERIC_ERROR) : null;
    db.prepare("UPDATE sync_runs SET status = ?, finished_at = datetime('now'), created = ?, updated = ?, error = ? WHERE id = ?")
      .run(error ? 'error' : 'ok', counts.created, counts.updated, message, runId);
    if (error) {
      db.prepare("UPDATE integrations SET status = 'error', last_error = ? WHERE id = ?").run(message, integration.id);
    } else {
      // Next incremental run asks for changes since this run started (rows changed during it are re-read).
      db.prepare("UPDATE integrations SET status = 'ok', last_error = NULL, last_ok_at = datetime('now'), last_sync_at = ? WHERE id = ?").run(startedAt, integration.id);
    }
    return { runId, ok: !error, ...counts, error: message };
  }

  return {
    /** Starts (or joins) the store's sync. Resolves with the run summary; never rejects. */
    run(storeId) {
      if (!running.has(storeId)) {
        running.set(storeId, runOnce(storeId)
          .catch((err) => { console.error(`[sync] store ${storeId} crashed:`, err); return null; })
          .finally(() => running.delete(storeId)));
      }
      return running.get(storeId);
    },
    isRunning: (storeId) => running.has(storeId),
    clientFor,
  };
}

module.exports = { createSyncQueue };
