# Phase 6 — Integrations Implementation Plan

**Goal:** A pro store can connect WooCommerce (keys tested, products + orders imported, kept fresh by webhooks and a 15-minute safety sync) or a custom site through `/api/v1` with its own API keys, and receive signed outbound webhooks. Every state on screen comes from a real call.

**Spec:** §7.1 (integrations, sync_runs, api_keys, webhooks), §9, §10, §14 (status map, currency, read-only synced rows, PUBLIC_BASE_URL).

## Decisions
- `SECRET_KEY` (≥32 chars) encrypts every integration secret with AES-256-GCM (`src/crypto.js`). Required in production; development falls back to a fixed dev key with a warning (dev data is not secret).
- URLs the server calls (WooCommerce site, outbound webhook targets) must be `https` and resolve to public addresses in production (`src/safeUrl.js`, SSRF guard); redirects are not followed. Development allows `http` and private hosts so a local shop / fake server can be used.
- WooCommerce: Basic auth over HTTPS only (WooCommerce itself refuses Basic auth over plain HTTP). Currency: IRT ×1, IRR ÷10, IRHT ×1000, IRHR ×100 → Toman; anything else is refused with a clear error. Variations become separate products (`<parent>:<variation>` external id). Orders: last 90 days on the first run, then `modified_after` the last good run.
- Sync runs one job per store at a time (`src/sync/queue.js`), retries network failures twice with backoff, never retries an auth error, writes each page in its own transaction (a failed run never half-writes or deletes).
- Imported historical orders do not flood the activity feed; orders arriving by webhook / incremental sync do.
- API keys `ba_<prefix>_<secret>`: shown once, stored as SHA-256; only a pro workspace's connected store can use them.
- Outbound events: `order.created` (assistant orders) and `conversation.waiting` (customer unanswered 10 min, sent once per wait). Body signed `X-Signature: sha256=<hex HMAC>`; 3 attempts (now, +5 s, +30 s).
- Scheduler (`src/scheduler.js`, every minute, production process only): due WooCommerce syncs and waiting notifications.

## Tasks
1. Migration 006 + `crypto.js` + `safeUrl.js` (+ tests: round-trip, tamper, private address refusal).
2. `sync/woocommerce.js` client + mappers, `sync/upsert.js`, `sync/queue.js` (+ tests against a fake WooCommerce server: pagination, variations, currency, auth error, partial failure, idempotent re-run).
3. Inbound webhooks route (HMAC verified) + outbound `outbound.js` + scheduler.
4. `/api/v1` public API + owner `/api/app/integrations` API (+ tests: key auth, upsert, isolation, plan gate, shown-once secrets never returned again).
5. Integrations page (WooCommerce, API keys + docs, outbound webhooks, widget) and attention items (integration error, stale sync, widget never seen).
