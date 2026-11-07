# Phase 3 — Stores, Products, Knowledge base, Orders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Real management pages for stores (add / edit / disconnect / reconnect / delete within plan limits), products, FAQs and orders — searchable, filterable, paginated, store-aware — replacing the classic panel for these sections.

**Architecture:** Migration 004 adds sync-ready columns (products: `external_id, source, category, stock_qty, synced_at`; orders: `external_id, source, updated_at`) with `UNIQUE(store_id, external_id)`. One router file per resource under `src/routes/app/` mounted by `src/routes/app.js`. A shared `src/paging.js` parses `page`/`per` (max 100) and returns `{ items, total, page, pages }`. Every write checks ownership with `scope.storeFor` (store ids) or an `... AND store_id IN (SELECT id FROM stores WHERE workspace_id = ?)` clause (row ids). Client pages in `public/js/app/pages/` reuse a small `table.js` (toolbar, table/list switch at <768, pager) and `form.js` (dialog forms with inline validation).

**Spec:** §7.1, §8 (Stores, Products, Knowledge base, Orders), §14 (store limits, disconnect/delete semantics, synced data read-only).

## Global Constraints

- Store limit per effective plan: free 1, pro 5; disconnected stores don't count. Over the limit → 403 «سقف فروشگاه‌های پلن شما پر است».
- Disconnect = soft (`disconnected_at`), chat answers 404, data kept; reconnect clears it (limit re-checked). Delete store requires body `{ confirm: <exact store name> }`; cascades.
- A workspace keeps at least one connected store: disconnecting/deleting the last one → 409.
- Products/orders with `source != 'local'`/`'assistant'` are read-only in the panel for price, stock, items and status → 409 «این مورد از <منبع> همگام‌سازی می‌شود؛ آن را در همان‌جا تغییر دهید».
- Lists paginate (`per` default 20, max 100), sort whitelist only, search is a parameterized `LIKE`.
- Order revenue/total remain server-computed; panel cannot edit totals or items.

## Review Focus

1. Row ids from another workspace on every PUT/DELETE → 404 (tests per resource).
2. `per=100000`, `page=-1`, `sort=;drop` → clamped/ignored, never 500.
3. Deleting the last store / exceeding the plan's store count → 409 / 403 with a clear message.
4. Search with `%` or `_` must match literally (escape LIKE wildcards).
5. Creating a product with `storeId` of another workspace → 404.

---

### Task 1: migration 004 + paging helper
Files: `src/migrations/004-sync-columns.js`, `src/paging.js`, tests in `test/migrations.test.js`, `test/paging.test.js`.
- [ ] Tests: `existing products become source=local, orders source=assistant`; `duplicate (store_id, external_id) rejected, NULLs allowed`; `paging clamps per to 1..100 and page to >=1`; `likePattern escapes % and _`.
- [ ] Implement `parsePaging(query) -> { page, per, offset }`, `pageResult(items, total, { page, per })`, `likePattern(q) -> string` (used with `ESCAPE '\'`). Commit.

### Task 2: stores API
Files: `src/routes/app/stores.js`, tests `test/stores-api.test.js`.
Produces: `GET /api/app/stores` (all incl. disconnected, with `limit`, `used`), `POST /api/app/stores {name, slug, domain}`, `PUT /api/app/stores/:id {name, domain}`, `POST /:id/disconnect`, `POST /:id/reconnect`, `DELETE /:id {confirm}`. New stores get an `assistant_configs` row (same defaults as sign-up). Domain normalized to host only (`https://Shop.ir/x` → `shop.ir`), empty allowed.
- [ ] Tests: limit (free: second store 403; pro: 5 ok, 6th 403); slug taken 409; disconnect hides from `/me` and makes `/api/chat/:slug` 404; last store 409; delete needs exact name; other workspace 404. Implement. Commit.

### Task 3: products + knowledge API
Files: `src/routes/app/products.js`, `src/routes/app/faqs.js`, tests `test/catalog-api.test.js`.
Produces: `GET /api/app/products?store&q&category&stock(in|out)&source&sort(name|price|-price|updated)&page&per` → paged rows with `storeName`; `GET /api/app/products/categories?store`; `POST /api/app/products {storeId, name, description, price, inStock, category}`; `PUT /:id`; `DELETE /:id` (synced → 409). FAQs: `GET /api/app/faqs?store&q&page&per`, `POST {storeId, question, answer}`, `PUT /:id`, `DELETE /:id`.
- [ ] Tests: isolation on every write; synced product edit 409; filters and search (incl. literal `%`); categories distinct per store. Implement. Commit.

### Task 4: orders API
Files: `src/routes/app/orders.js`, tests `test/orders-api.test.js`.
Produces: `GET /api/app/orders?store&status&source&q(name|phone|#id)&from&to&sort(-created|created|-total|total)&page&per`; `GET /api/app/orders/:id` (items parsed, conversationId); `PUT /api/app/orders/:id/status {status}` (records `order.status` event, sets `updated_at`; synced → 409).
- [ ] Tests: filters, search by phone and by `#12`, isolation, synced 409, event recorded. Implement. Commit.

### Task 5: shared client building blocks
Files: `public/js/app/table.js` (`dataView({ columns, row, mobileRow, fetchPage, filters, emptyState })` renders toolbar + table/list + pager, keeps filters in the URL), `public/js/app/form.js` (`formDialog({ title, fields, initial, submitLabel, onSubmit })` with labels, hints, inline errors, focus first invalid, Esc/cancel), `public/css/pages/data.css`.
- [ ] Verified through Tasks 6–7 pages. Commit with Task 6.

### Task 6: Products and Knowledge pages
Files: `public/js/app/pages/products.js`, `public/js/app/pages/knowledge.js`.
Products: search, category select, stock filter, source badge (محلی / ووکامرس / API), price in Toman, add/edit dialog (store select when «همه فروشگاه‌ها»), delete with confirm, synced rows show a lock note instead of edit. Knowledge: FAQ list with search, add/edit/delete.
- [ ] ui-check at 1440/375 both themes, no errors/overflow. Commit.

### Task 7: Orders and Stores pages
Orders: table (number, customer, store, items count, total, date, status, source), filters (status segmented, source, date range), search, sort, pager; row opens a drawer dialog with items, address, phone (tap-to-call link), status changer (local orders only), link to the conversation. Stores: cards list incl. disconnected (muted), plan usage line («۱ از ۵ فروشگاه»), add-store dialog (name, slug with live `/chat/<slug>` preview, domain), edit, disconnect/reconnect, delete with typed-name confirm, widget snippet with copy button, link to the customer chat page.
- [ ] ui-check; remove these four sections from `later.js`. Commit, push.
