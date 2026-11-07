# Phase 2 — Design system, app shell, Overview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A new owner panel at `/app` with the approved dark design (and a full light theme), sidebar + header + store switcher + mobile drawer, and an Overview page whose every number comes from the database.

**Architecture:** Server: migration 003 adds an `events` table (activity feed) and backfills it; `src/overview.js` computes metrics/series/store summaries for a date range and store filter; `src/attention.js` derives «نیازمند توجه» items; `src/routes/app.js` serves `GET /api/app/me`, `/overview`, `/activity`. Client: `public/app.html` shell + ES modules in `public/js/app/` + CSS in `public/css/` (tokens → components → shell → pages). The old `/panel` keeps working until Phase 3–4 replace its sections.

**Tech Stack:** Express, node:sqlite, vanilla ES modules, CSS custom properties. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-07-platform-redesign-design.md` §2, §7.3, §8 Overview. Visual reference: `.superpowers/brainstorm/*/content/dashboard-dark-v5.html`.

## Global Constraints

- Every number on screen is computed from rows; no data → honest empty state. No decorative charts: a sparkline only when the range has ≥2 days with data.
- Revenue = sum of `orders.total` with status `confirmed` or `sent`, labelled «تومان».
- AI response rate = assistant messages with `source='ai'` ÷ all assistant messages in range; null (shown «—») when there are none.
- Ranges: `today`, `7d`, `30d`, `custom` (`from`,`to` as `YYYY-MM-DD`, max 366 days). Previous period = same length immediately before.
- Store filter `?store=<id>` passes through `scope.storeFor`; absent = all stores of the workspace, labelled «همه فروشگاه‌ها».
- No store logos on cards; store name bold. No letter-spacing on Persian text. Motion 150–300 ms transform/opacity only; reduced-motion and reduced-transparency honored.
- Text into the DOM via `textContent`/`el()` only.
- Nav items for sections built in later phases open an honest «این بخش در مرحلهٔ بعدی ساخته می‌شود» page with a link to the old panel where that feature exists today — never a dead button.

## Review Focus

1. A workspace with zero orders/conversations must render the Overview with «—»/zero states and no NaN, no broken sparkline — test in Task 2.
2. `?store=` of another workspace on `/api/app/overview` must 404 — test in Task 3.
3. `custom` range with `from > to`, bad dates or >366 days must 400, not 500 — test in Task 3.
4. Timezone: day buckets in Asia/Tehran (+03:30), so an order at 23:00 Tehran counts on that Tehran day — test in Task 2.
5. 375 px wide: no horizontal overflow, drawer opens/closes with keyboard (Esc) — checked in Task 6.

---

### Task 1: events table + recording

**Files:** Create `src/migrations/003-events.js`, `src/events.js`; modify `src/migrations/index.js`, `src/routes/chat.js`, `src/routes/panel.js` (order status change); Test `test/events.test.js`.

**Interfaces — Produces:** table `events(id, workspace_id, store_id, type, ref_id TEXT, summary TEXT, created_at)` + index `(workspace_id, created_at)`; types: `order.created`, `order.status`, `conversation.started`. `recordEvent(db, { storeId, type, refId, summary })` (looks up workspace_id from store). Migration backfills `order.created` from orders and `conversation.started` from conversations with their `created_at`.

- [ ] Tests: `backfill creates one event per existing order and conversation`; `a chat order records order.created with the store's workspace`; `new conversation records conversation.started once`; `order status change records order.status`.
- [ ] Run → fail. Implement. Run → pass. Commit `feat: activity events`.

### Task 2: overview + attention computations

**Files:** Create `src/overview.js`, `src/attention.js`, `src/time.js`; Test `test/overview.test.js`.

**Interfaces — Produces:**
- `time.resolveRange({ range, from, to }, now) -> { start, end, prevStart, prevEnd, days: string[] } | { error }` — instants as SQLite UTC strings; `days` = Tehran calendar days `YYYY-MM-DD`.
- `overview.metrics(db, storeIds: number[], range) -> { revenue, orders, conversations, aiRate }` each `{ value: number|null, previous: number|null, series: number[] }` (series aligned to `range.days`).
- `overview.storeSummaries(db, stores, range) -> Array<{ id, name, slug, domain, platform, orders, revenue, aiRate, lastActivityAt }>`.
- `attention.items(db, workspace, stores, now) -> Array<{ id, severity: 'high'|'medium'|'low', title, detail, action: { label, href } }>` — rules: plan expired (pro with past paid_until), AI usage ≥80% (≥100% high), new orders waiting >24 h, conversations whose last message is from the customer with no reply for 10 min. Empty array when nothing.
- `overview.activity(db, storeIds, { type?, before?, limit = 20 }) -> { items, nextBefore }`.

- [ ] Tests: `empty workspace gives zeros and null aiRate`; `revenue counts only confirmed and sent`; `previous period is the same length right before`; `tehran day bucket` (order at `2026-11-06 20:00:00` UTC = 23:30 Tehran lands on 2026-11-06, at `2026-11-06 21:00:00` UTC lands on 2026-11-07); `aiRate ignores user messages`; `attention: usage at 85% is medium, 100% is high`; `attention: expired pro listed`; `attention: none → []`; `activity filters by type and pages by before`.
- [ ] Run → fail. Implement. Run → pass. Commit `feat: overview metrics and attention center`.

### Task 3: /api/app routes

**Files:** Create `src/routes/app.js`; modify `src/server.js` (mount `/api/app`, serve `app.html` for `/app` and `/app/*`); Test `test/app-api.test.js`.

**Interfaces — Produces:** `GET /api/app/me -> { user:{name,email}, workspace:{id,name,plan,paidUntil}, usage, stores:[{id,name,slug,domain,platform}] }`; `GET /api/app/overview?range&from&to&store -> { range:{days}, scope:{storeId|null}, metrics, stores, attention }`; `GET /api/app/activity?type&store&before -> { items, nextBefore }`.

- [ ] Tests: `401 without session`; `me lists only own stores`; `overview with another workspace's store id is 404`; `bad custom range is 400` (from>to, invalid date, 400 days); `overview numbers match seeded rows`.
- [ ] Run → fail. Implement. Run → pass. Commit `feat: owner app API`.

### Task 4: design system CSS

**Files:** Create `public/css/tokens.css` (dark default + `[data-theme=light]` + `prefers-color-scheme` when theme=system), `public/css/components.css` (btn variants primary/secondary/ghost/danger + sizes, input, select, segmented, tabs, pill/badge, card, list, table, menu, dialog, drawer, toast, skeleton, empty, kbd, sparkline), `public/css/shell.css` (sidebar, header, drawer < 768 px, icon rail 768–1279 px). Extend `public/icons.svg` with Lucide: dashboard, store, message-square, shopping-bag, package, sparkles, book-open, plug, bar-chart, credit-card, settings, search, bell, chevron-down, chevron-left, refresh, calendar, more-horizontal, menu, sun, moon, monitor, log-out, external-link, alert-triangle, check-circle.
- [ ] Verification: page `public/styleguide.html` rendering every component in both themes; headless-Chrome screenshot at 1440 and 375 in dark and light shows no overflow (`document.documentElement.scrollWidth <= innerWidth`). Commit `feat: design system tokens and components`.

### Task 5: app shell + router

**Files:** Create `public/app.html`, `public/js/app/main.js` (boot, auth redirect to `/panel` login when 401), `router.js` (History API, `data-link` clicks, focus `<main>` on route change), `api.js` (fetch JSON, error → toast), `shell.js` (sidebar groups per spec §7.3 with counts, header: store switcher menu «همه فروشگاه‌ها» + stores, search box opening a «به‌زودی» hint is NOT allowed → search filters nav items and stores only until Phase 3 adds global search; notifications bell shows attention count and opens the attention list; theme menu system/dark/light persisted in localStorage with try/catch; profile menu with logout), `pages/later.js` (honest placeholder with old-panel link), reuse `/ui.js` helpers as an ES module wrapper `js/app/ui.js`.
- [ ] Verification: headless Chrome loads `/app` logged in, no console errors; Esc closes drawer and menus; Tab order header → sidebar → main. Commit `feat: app shell, router, theme`.

### Task 6: Overview page

**Files:** Create `public/js/app/pages/overview.js`, `public/css/pages/overview.css`.

Layout from the v5 mockup + third brief: title «نمای کلی فضای کاری», subtitle «وضعیت عملکرد فروشگاه‌ها و دستیارهای هوشمند شما», segmented range (امروز / ۷ روز / ۳۰ روز / دلخواه → two date inputs), refresh button; 4 compact metrics (درآمد، سفارش‌ها، گفتگوها، نرخ پاسخ هوشمند) with previous-period delta and inline SVG sparkline; stores grid (name bold, platform + domain, status pill, orders/revenue/AI rate, last activity, «⋯» menu: مدیریت، سفارش‌ها، گفتگوها، دستیار — later-phase targets go to their honest pages; no disconnect until Phase 3); «اتصال فروشگاه جدید» primary button → Stores page (later.js until Phase 3); «نیازمند توجه» list with severity dot + action link, or a calm success state; activity feed with type filter (همه / سفارش / گفتگو) and «بیشتر» paging. Skeletons while loading; error state with retry.
- [ ] Verification: screenshots 1440 dark, 1440 light, 375 dark of the seeded demo; empty workspace screenshot shows empty states; `scrollWidth` check passes; no console errors. Commit `feat: overview page`.
