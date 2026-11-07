# Phase 1 — Foundation (workspaces + stores) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the one-row-per-business model with users → workspaces → stores, migrate existing databases in place, and keep every current feature (signup, login, panel, chat, widget, orders) working on the new model.

**Architecture:** Numbered migrations run at `openDb()`. Migration 002 rebuilds tenant tables so `business_id` becomes `store_id`, reusing the old business id as the user, workspace and store id so no row needs re-mapping. A `scope.js` helper is the single place that decides which stores a signed-in user may touch; the existing `/api/panel` routes resolve one store through it (the current panel UI keeps working until Phase 2 replaces it).

**Tech Stack:** Node ≥22.13, Express 4, `node:sqlite`, `node:test`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-07-platform-redesign-design.md` (§7.1 data model, §14 decisions)

**Roadmap:** Phases 2–8 (spec §12) each get their own plan file in this folder, written when the previous phase is green.

## Global Constraints

- No new runtime dependencies. CommonJS, same style as existing `src/`.
- Every tenant query is filtered through `scope.js`; a store id from the client is never trusted unchecked.
- Existing public contracts unchanged: `POST /api/auth/register {name, slug, email, password}`, `POST /api/auth/login`, `/chat/:slug`, `GET/POST /api/chat/:slug`, `widget.js data-business=<slug>`, `GET /api/panel` response shape `{business, products, faqs, stats, usage}`.
- Plan limits: `free` = 100 AI replies/month, 1 store, no integrations; `pro` = 3000 AI replies/month, 5 stores, integrations. Only `messages.source = 'ai'` counts. Expired `paid_until` → treated as `free`.
- Persian user-facing error strings, English code/comments.
- `npm test` green at the end of every task.

## Review Focus

1. A migration that throws halfway must leave the database exactly as before (one transaction) — pinned in Task 1.
2. Opening an already-migrated database must not re-run or duplicate anything — pinned in Task 1.
3. A session cookie issued before the migration must get a clean 401 (log in again), never a 500 — pinned in Task 3.
4. Registering a slug or email that exists in the new tables must still return 409 — pinned in Task 3.
5. A business with no products, FAQs or conversations must migrate without errors — pinned in Task 2.

---

### Task 1: Migration runner + baseline schema

**Files:**
- Create: `src/migrations/index.js`, `src/migrations/001-initial.js`
- Modify: `src/db.js` (drop inline `SCHEMA`; `openDb` calls `migrate`)
- Test: `test/migrations.test.js`

**Interfaces:**
- Produces: `migrate(db, { to?: number }) -> number` (returns the version reached); each migration module exports `{ version: number, name: string, up(db) }`. `openDb(file)` unchanged signature, now migrates to latest.

- [ ] **Step 1: Write failing tests** in `test/migrations.test.js`:
  - `fresh database reaches the latest version` — `openDb(':memory:')`, assert `SELECT MAX(version) FROM schema_migrations` equals the highest migration version.
  - `re-running migrate is a no-op` — call `migrate(db)` twice; row count of `schema_migrations` unchanged, no throw.
  - `a failing migration rolls back` — `migrate(db, { migrations: [okMigration, throwingMigration] })` (accept an optional `migrations` array for tests); assert it throws, the table created by the failing migration's first statement does not exist, and `schema_migrations` holds only the ok one.
- [ ] **Step 2:** `npm test` → the new tests fail (`migrate` not defined).
- [ ] **Step 3: Implement.** `001-initial.js` = today's `SCHEMA` verbatim (all `CREATE … IF NOT EXISTS`, so existing v1 files adopt version 1 harmlessly). `migrate`: create `schema_migrations(version INTEGER PRIMARY KEY, name TEXT, applied_at TEXT DEFAULT (datetime('now')))`; for each pending migration: `PRAGMA foreign_keys = OFF` → `BEGIN` → `up(db)` → insert version → `PRAGMA foreign_key_check` (throw if rows) → `COMMIT` → `PRAGMA foreign_keys = ON`; on error `ROLLBACK`, restore foreign_keys, rethrow. (`foreign_keys` cannot change inside a transaction, hence outside.)
- [ ] **Step 4:** `npm test` → all pass (the 21 old tests too).
- [ ] **Step 5:** `git commit -m "feat: numbered database migrations"`

### Task 2: Migration 002 — users, workspaces, stores

**Files:**
- Create: `src/migrations/002-workspaces.js`
- Test: `test/migrations.test.js` (add)

**Interfaces:**
- Produces tables (spec §7.1): `users(id, email UNIQUE, password_hash, name, is_operator DEFAULT 0, created_at)`, `workspaces(id, name, plan DEFAULT 'free', paid_until TEXT NULL, status DEFAULT 'active', created_at)`, `workspace_members(workspace_id, user_id, role DEFAULT 'owner', PK(workspace_id,user_id))`, `stores(id, workspace_id, slug UNIQUE, name, domain DEFAULT '', platform DEFAULT 'widget', created_at, disconnected_at NULL)`, `assistant_configs(store_id PK, draft_json, published_json, published_at)`, `sessions(token, user_id, active_workspace_id, expires_at)`. `products`, `faqs`, `conversations`, `orders` get `store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE` instead of `business_id`. `businesses` is dropped. Indexes: `idx_products_store`, `idx_faqs_store`, `idx_orders_store_created(store_id, created_at)`, `idx_conversations_store_created(store_id, created_at)`, `idx_stores_workspace`, `idx_members_user`.
- Assistant config JSON shape (draft and published identical after migration): `{ "description": string, "tone": string }` — later phases add keys; readers must default missing keys.

- [ ] **Step 1: Write failing tests:**
  - `v1 database migrates with ids, slug and data preserved` — `migrate(db, {to: 1})`, insert a business (slug `old-shop`, email, hash, description `D`, tone `T`, plan `pro`) plus one product, one FAQ, one conversation with one message, one order; `migrate(db)`; assert `users`, `workspaces`, `stores` each have a row with the business's id; `stores.slug = 'old-shop'`; `workspaces.plan = 'pro'`; the product/FAQ/conversation/order rows have `store_id` = that id; message still joined to its conversation; `JSON.parse(published_json)` equals `{description:'D', tone:'T'}`; table `businesses` no longer exists.
  - `empty business migrates` — business with no child rows → one store, zero products, no throw.
  - `old sessions are dropped` — a v1 session row → after migrate, `sessions` is empty.
- [ ] **Step 2:** run → fail.
- [ ] **Step 3: Implement `up(db)`:** create new tables; `INSERT INTO users/workspaces/stores/workspace_members/assistant_configs SELECT … FROM businesses` with `id` copied from `businesses.id`; rebuild each child table (create `x_new` with `store_id`, `INSERT INTO x_new SELECT …, business_id AS store_id`, drop `x`, rename); drop and recreate `sessions` with the new columns; drop `businesses`; create indexes.
- [ ] **Step 4:** run → pass. Old api tests will now fail — expected until Task 3.
- [ ] **Step 5:** commit with Task 3 (tests must be green before committing). Do not commit a red tree.

### Task 3: Auth, scope and plans on the new model

**Files:**
- Create: `src/scope.js`
- Modify: `src/auth.js`, `src/plans.js`, `src/routes/account.js`, `src/seed.js`
- Test: `test/api.test.js` (adapt), `test/plans.test.js` (new)

**Interfaces:**
- `auth.createSession(db, userId, workspaceId) -> token`; `auth.requireUser(db)` middleware sets `req.userId`, `req.workspaceId`; unknown/expired token → 401 `{error:'ابتدا وارد شوید'}`. (`requireAuth` is renamed; update imports.)
- `scope.workspaceStores(db, workspaceId) -> Array<{id, slug, name, domain, platform}>` (excludes disconnected).
- `scope.storeFor(db, req, storeId?: number) -> store | null` — returns the store only if it belongs to `req.workspaceId` and is not disconnected; with no `storeId`, the workspace's first store by id.
- `plans.PLAN_LIMITS = { free: { replies: 100, stores: 1, integrations: false }, pro: { replies: 3000, stores: 5, integrations: true } }`.
- `plans.effectivePlan(workspace, now = new Date()) -> 'free' | 'pro'` — `pro` only if `plan === 'pro'` and (`paid_until` is null or `paid_until` > now).
- `plans.usageFor(db, workspace, now?) -> { plan, used, limit, reached }` — `used` = assistant messages with `source = 'ai'` this calendar month (UTC) across all the workspace's stores.
- Register: one transaction creates user, workspace (`name` = business name), member (`owner`), store (`slug`, `name`), assistant_config (`{description:'', tone:'دوستانه و محترمانه'}` in both draft and published); 409 if email in `users` or slug in `stores`.

- [ ] **Step 1: Write failing tests:**
  - `plans.test.js`: `expired pro counts as free` (`paid_until` yesterday → `'free'`, limit 100); `pro with no paid_until stays pro` (limit 3000); `offline replies do not count toward usage` (2 `ai` + 3 `offline` messages → `used === 2`).
  - `api.test.js`: keep every existing test; add `pre-migration session cookie gets 401` (send `Cookie: sid=deadbeef` → 401 JSON, not 500) and `duplicate slug returns 409` / `duplicate email returns 409` against the new tables.
- [ ] **Step 2:** run → fail.
- [ ] **Step 3: Implement** the interfaces above; login looks up `users`, picks the user's first workspace (`workspace_members` ordered by workspace_id) as `active_workspace_id`. Seed creates the ABRISHAM demo through the same register transaction helper (`createAccount(db, {name, slug, email, passwordHash})` exported from `account.js`) and inserts products/FAQs with `store_id`.
- [ ] **Step 4:** run → only panel/chat tests still failing (fixed in Task 4).
- [ ] **Step 5:** no commit yet (tree red) — continue to Task 4.

### Task 4: Panel and chat routes on stores + isolation tests

**Files:**
- Modify: `src/routes/panel.js`, `src/routes/chat.js`, `src/assistant.js` (prompt reads a profile object)
- Test: `test/isolation.test.js` (new), `test/api.test.js`, `test/assistant.test.js`

**Interfaces:**
- Consumes: `requireUser`, `storeFor`, `usageFor`, `effectivePlan`.
- Panel: middleware resolves `req.store = storeFor(db, req, Number(req.query.store) || undefined)`; null → 404 `{error:'فروشگاه پیدا نشد'}`. Every query uses `req.store.id`. `GET /api/panel` keeps its shape: `business = { id: store.id, slug, name, description, tone, email: user.email, plan: effectivePlan(workspace) }`; `usage` from `usageFor(db, workspace)`. `PUT /api/panel/business` updates `stores.name` and writes `{description, tone}` into both `draft_json` and `published_json` (Phase 5 splits them).
- Chat: `findStore(db, slug)` → `{ id, slug, name, workspace_id, profile: {name, description, tone} }` from `published_json`, null if missing or disconnected. Limit check uses the workspace's `usageFor`.
- `assistant.buildSystemPrompt(profile, products, faqs)` — `profile = {name, description, tone}`; text of the prompt unchanged.

- [ ] **Step 1: Write failing tests** in `test/isolation.test.js` (two accounts A and B via register):
  - `owner B cannot update, delete or see A's products` — A creates a product; B's `PUT`/`DELETE /api/panel/products/:id` → 404; B's `GET /api/panel` products list excludes it.
  - same pattern for FAQs and for `PUT /api/panel/orders/:id` (order inserted directly for A's store).
  - `?store= of another workspace is refused` — B calls `GET /api/panel?store=<A's store id>` → 404.
  - `chat for A never sees B's products` — offline answer for A's slug asked for B's product name does not contain it.
- [ ] **Step 2:** run → fail.
- [ ] **Step 3: Implement** the interfaces; keep every existing validation and message.
- [ ] **Step 4:** `npm test` → everything green (old 21 + new).
- [ ] **Step 5: Manual check:** `rm -f /tmp/ba-check.db && DB_FILE=/tmp/ba-check.db DEMO_PASSWORD=abrisham-demo npm run seed && DB_FILE=/tmp/ba-check.db PORT=3100 npm start`; log in at `http://localhost:3100/panel` with `demo@abrisham.local`; add a product, chat at `/chat/abrisham`, confirm the reply mentions it. Then copy the owner's existing `data/assistant.db` to `/tmp/ba-v1.db`, start with `DB_FILE=/tmp/ba-v1.db` and confirm the panel loads after login (real v1 → v2 migration).
- [ ] **Step 6:** `git commit -m "feat: workspaces and stores replace single-business model"` (includes Tasks 2–4).
