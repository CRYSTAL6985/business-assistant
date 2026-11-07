# دستیار هوشمند کسب‌وکار — multi-store platform and redesign

Date: 2026-11-07 · Branch: `feat/platform` · Status: approved direction, ready to plan

## 1. Intent

Today the app is a single-business demo (uni final project): one owner, one shop, one
chat page. The owner wants to (1) show it to the head of the university and then
(2) **sell it to Iranian online shops** as a subscription. It has to become a real,
multi-store SaaS that a shop owner can run every day, and that the operator (the app's
owner, "me" below) can run as a business.

Sources: the owner's three pasted briefs (product transformation, dashboard visual brief,
master UI/UX redesign) and the decisions made in chat on 2026-11-07, recorded here.

## 2. Decisions made in conversation (the owner's)

- **Market: Iran only.** Persian UI, RTL, Toman, Persian numerals. Shopify is out
  (unusable for Iranian businesses). Instagram is out "for now — only websites".
- **Channels:** shops that have a website. Connect via WooCommerce, via a REST API for
  custom-built sites, or with only the chat widget.
- **Two panels.** Shop owners get their own panel showing only their own data. The
  operator gets a separate admin panel that only they can open: every workspace, which
  websites actually use the widget, usage, plans.
- **Payments by hand for now.** No payment gateway. The operator records payments and
  switches plans in the admin panel.
- **Finish properly**, not to a deadline; still wants it done.
- **Visual direction:** dark-first, deep charcoal, restrained electric-blue accent, muted
  emerald / amber / red for status, Vazirmatn. Linear / Stripe / Vercel / Shopify as
  references, original identity. Less crowded than the first mockup; no logos/icons on
  store cards — the store name, bold, is the identity. Apple-style hierarchy (weight +
  size, few dividers, depth from surfaces, press feedback). A complete light theme too.
- **Strict avoid-list** (from the briefs): gradient overload, purple neon, glassmorphism
  everywhere, glowing cards, oversized radii, decorative charts/illustrations, fake
  statistics, buttons that do nothing, fake filters.

The accepted mockup is `.superpowers/brainstorm/*/content/dashboard-dark-v5.html`
(not committed; screenshots in the session scratchpad). The third brief adds to it: an
«نیازمند توجه» attention center, a filterable activity feed, small real trend lines on
metrics, grouped sidebar with labels, a refresh action, per-store context menus.

## 3. Goals

A first-time shop owner can, without help:
1. sign up and get a workspace; 2. connect a store; 3. sync its products;
4. configure that store's assistant; 5. install the widget; 6. watch conversations and
take over from the AI; 7. manage incoming orders; 8. compare performance across stores.

The operator can: see all workspaces and stores, see which websites really load the
widget, see each workspace's usage, change plans, record manual payments, suspend.

## 4. Non-goals (this round)

Shopify, Instagram/Telegram/Bale bots, online payment gateway, team invitations UI
(the data model supports members; no invite flow yet), multiple workspaces per user in
the UI (model supports it; UI shows a switcher only if >1), pushing chat-created orders
back into WooCommerce (later), native mobile app, email/SMS notifications.

## 5. Anti-goals — failure even if it "works"

- Any number on screen that is not computed from real rows. Empty → an honest empty state.
- A store shown as "connected" because a URL was typed. Connection = a successful
  authenticated API call (WooCommerce/custom) or a real widget load seen from that origin.
- One workspace ever seeing another's data. Every query is scoped; tests prove it.
- The AI stating a price, stock level or order that is not in the database.
- Integration secrets in plaintext, in logs, or sent to the browser.
- Breaking existing embeds: today's `/chat/<slug>` links and `widget.js?data-business=`
  snippets must keep working after migration.
- A UI control that looks clickable and does nothing.

## 6. Constraints

- Keep Node ≥22 + Express 4 + `node:sqlite` + vanilla JS. No frontend framework, no ORM.
  New runtime dependencies only with a strong reason (none expected).
- Must run on Parspack PaaS like the owner's other apps (single process, SQLite on a disk).
- The AI call stays OpenAI-compatible (any base URL). OpenRouter is blocked from Iran;
  the production provider is an operator choice made in `.env` (see §13).
- Persian everywhere in the UI; code, comments and commit messages in English.
- Existing 21 tests keep passing (adapted to the new model), and every feature adds tests.
- The README doubles as the owner's study guide; it must be updated with the new
  architecture.

## 7. Architecture

### 7.1 Data model (SQLite, numbered migrations)

Add a `schema_migrations` table and `src/migrations/NNN-name.js` files run in order at
startup inside a transaction. Migration 002 converts existing data: each `businesses`
row → one `users` row + one `workspaces` row + one `stores` row that **keeps the same
slug**, and re-points products/faqs/conversations/orders to the new store.

| Table | Purpose / key columns |
|---|---|
| `users` | id, email (unique), password_hash, name, is_operator (0/1), created_at |
| `workspaces` | id, name, plan (`free`/`pro`/…), paid_until, status (`active`/`suspended`), created_at |
| `workspace_members` | workspace_id, user_id, role (`owner`/`member`) — PK both |
| `sessions` | token, user_id, active_workspace_id, expires_at |
| `stores` | id, workspace_id, slug (unique, public id for chat/widget), name, domain, platform (`widget`/`woocommerce`/`custom`), created_at, disconnected_at |
| `assistant_configs` | store_id, draft_json, published_json, published_at — name, tone, welcome, instructions, languages, policies, order_taking, fallback, appearance (color, position, launcher text) |
| `integrations` | id, store_id, type, credentials_enc (AES-256-GCM), status (`pending`/`ok`/`error`), last_ok_at, last_error, webhook_secret_enc |
| `sync_runs` | id, store_id, kind (`products`/`orders`/`full`), status, started_at, finished_at, created/updated counts, error |
| `products` | + store_id, external_id, source (`local`/`woocommerce`/`api`), category, stock_qty (nullable), synced_at; UNIQUE(store_id, external_id) |
| `orders` | + store_id, number, external_id, source (`assistant`/`woocommerce`/`api`); UNIQUE(store_id, external_id) |
| `conversations` | + store_id, customer_name, status (`open`/`waiting`/`closed`), handler (`ai`/`human`), last_message_at, unread (0/1) |
| `messages` | role adds `staff`; + context_json (what the answer was based on) |
| `conversation_notes` | id, conversation_id, user_id, body, created_at (internal, never shown to customer) |
| `faqs` | + store_id (knowledge base: FAQs + policies) |
| `api_keys` | id, store_id, prefix, key_hash (SHA-256), label, created_at, last_used_at, revoked_at |
| `webhooks` | id, store_id, url, secret_enc, events, active, last_status |
| `widget_sightings` | store_id, origin, first_seen_at, last_seen_at, hits — written when widget.js asks for config |
| `events` | id, workspace_id, store_id, type, ref_id, summary, created_at — the activity feed |
| `payments` | id, workspace_id, amount, note, period_end, recorded_by, created_at (manual) |

Indexes on every `store_id`, on `(store_id, created_at)` for orders/conversations/events,
and on `messages(conversation_id)`. All list endpoints paginate (cursor or page+limit,
max 100).

**Tenant isolation:** one helper `storeScope(req)` resolves the store ids the signed-in
user may touch (via `workspace_members`). Every panel query joins through it; a route
never trusts a store id from the client without that check. Tests create two
workspaces and assert every endpoint returns 404 for the other's ids.

### 7.2 Server layout

```
src/
  server.js            createApp({ db, ask, clock, fetch }) — injectable for tests
  db.js, migrations/   open + migrate
  auth.js              users, sessions, login limiter, requireUser, requireOperator
  crypto.js            encrypt/decrypt secrets (AES-256-GCM, key = SECRET_KEY env, required at startup)
  ratelimit.js         in-memory token buckets (login, public chat, public API)
  scope.js             storeScope / workspace checks
  assistant.js         prompt, askModel, extractOrder, validateOrder, offlineAnswer (kept)
  plans.js             limits per plan, monthly usage per workspace
  events.js            record activity events
  attention.js         derive «نیازمند توجه» items from real state
  sync/                queue.js (one job per store at a time, retries w/ backoff, never blocks requests)
                       woocommerce.js, upsert.js (idempotent by external_id)
  routes/
    account.js         register/login/logout/me/password
    app.js             owner panel API: overview, stores, products, orders, conversations, notes,
                       knowledge, assistant config (draft/publish/test), integrations, api keys,
                       webhooks, analytics, billing, settings
    chat.js            public chat + widget config (records widget_sightings)
    publicApi.js       /api/v1/* for custom sites (Bearer API key)
    webhooks.js        inbound WooCommerce webhooks (HMAC verified)
    admin.js           operator API
```

### 7.3 Frontend

- Pages: `/` landing, `/app/*` owner panel (one HTML shell + ES-module pages, History-API
  router, Express serves the shell for any `/app/*`), `/admin/*` operator panel (same
  design system, own shell), `/chat/:slug` customer chat, `widget.js`.
- `public/css/tokens.css` (color, type, space, radius, shadow, motion tokens for dark and
  light), `components.css` (buttons, inputs, select, segmented, tabs, table, list,
  badge/pill, card, menu, dialog, drawer, toast, skeleton, empty state), `shell.css`.
- `public/js/`: `ui.js` (existing el/icon/toast/confirm/withBusy/bidiText, extended),
  `router.js`, `api.js`, `store-context.js` (current store / "all stores", persisted),
  `pages/*.js` one module per section. Text only via `textContent` (existing XSS rule).
- Theme: system default, user override persisted (`localStorage`, wrapped in try/catch);
  light theme designed on its own (warm-neutral paper surfaces, same accent family), not
  inverted.
- Responsive: ≥1280 full sidebar; 768–1279 collapsible icon rail; <768 drawer + compact
  header; tables become two-line lists on mobile. No horizontal page scroll.
- Motion: 150–300 ms, transform/opacity only, press feedback on pointer-down,
  `prefers-reduced-motion` and `prefers-reduced-transparency` honored.
- Navigation (sidebar groups): عمومی — نمای کلی، فروشگاه‌ها · عملیات — گفتگوها، سفارش‌ها،
  محصولات · هوش مصنوعی — دستیار هوشمند، پایگاه دانش · مدیریت — یکپارچه‌سازی‌ها،
  تحلیل و گزارش‌ها، صورتحساب، تنظیمات. Counts only for unanswered conversations and new
  orders.
- Global store switcher in the header: «همه فروشگاه‌ها» or one store. Every page respects
  it; workspace-wide numbers are labelled as such. The choice lives in the URL (`?store=`)
  so filters survive reloads and links.

## 8. Pages (what each must do)

**Overview.** Title «نمای کلی فضای کاری», subtitle «وضعیت عملکرد فروشگاه‌ها و دستیارهای
هوشمند شما», date range (امروز / ۷ روز / ۳۰ روز / دلخواه) and refresh. Four metrics:
revenue (confirmed+sent orders only, Toman, labelled), orders, conversations, AI
response rate (= AI-answered replies ÷ all assistant replies). Each with previous-period
comparison and a small sparkline drawn from daily buckets — omitted when <2 data points.
Stores section: compact cards, name bold (no logo), platform + domain, status, last sync,
orders, revenue, AI rate, pending issues; menu: manage, orders, conversations, assistant,
disconnect (confirm). «اتصال فروشگاه جدید» primary action. **«نیازمند توجه»**: derived
items with severity, one-line explanation and a direct action — integration auth error,
failed/stale sync, store with no widget sighting after setup, unanswered conversations
(handler=human or AI fallback, waiting > N min), new orders not reviewed, AI usage ≥80%
of plan, plan expired. Nothing → a calm success state. **Activity feed** from `events`,
filter by type and store.

**Stores.** List + detail drawer: identity, platform, domain, connection health,
widget install snippet with live "seen on <origin> <time>" status, sync history.
Add-store wizard: name/domain → pick platform → (WooCommerce keys | API key | widget
only) → verify → first sync with progress → done.

**Conversations.** Three panels: list (search, filters: store, status, handler, unread)
· thread (customer/AI/staff bubbles with an «AI» / «پاسخ آفلاین» marker; takeover
toggles handler to human and the AI stops replying; staff reply box) · side panel
(customer, store, related orders, internal notes). Customer chat page polls for staff
replies while open.

**Orders.** Table: number, customer, store, items count, verified total, date, status,
source. Search, sort, filters (store, status, source, date), pagination, detail drawer
with items and status change. Chat-created totals are always recomputed server-side
(existing `validateOrder` rule kept).

**Products.** Table with search, category, price, stock, availability, store, source
badge (محلی / ووکامرس / API), external id, last synced. Synced products are read-only
for price/stock (edit in the source); local products are editable.

**AI assistant (per store).** Sections: هویت، لحن، دستورالعمل‌ها، دانش (products/FAQs
counts + links), رفتار گفتگو (languages, fallback/handoff), ثبت سفارش (on/off, required
fields), ظاهر (color, position left/right, welcome, launcher text), انتشار. Edits go to
draft; a live preview + test chat run against the draft; «انتشار» copies draft →
published. Each assistant reply in the test chat (and in the inbox) can show
«این پاسخ بر اساس چه بود؟» from `context_json`: the products/FAQs given to the model,
the matched FAQ in offline mode, and whether an order was validated or rejected and why.

**Knowledge base.** FAQs and policies per store, search, add/edit/delete.

**Integrations.** Per store: WooCommerce (site URL + consumer key/secret → test call →
store webhook secret → register webhooks or fall back to scheduled sync), Custom API
(create/revoke keys, shown once; docs page with endpoints and examples; outbound
webhook URLs with signing secret), Widget (snippet + sightings). Each shows real state
and last error in plain Persian with a retry.

**Analytics.** Per-store comparison table and daily series for the chosen range: orders,
revenue, conversations, AI rate, offline-answer rate, takeover count. Only real data.

**Billing.** Current plan, usage this month, paid-until, payment history (recorded by
operator), how to upgrade (operator contact from `SUPPORT_CONTACT` env).

**Settings.** Profile, password change, workspace name, theme, danger zone.

**Operator admin (`/admin`, `is_operator` only).** Workspaces table (owner email, stores,
plan, paid-until, status, usage this month), store list with platform and widget
sightings (origin + last seen), workspace detail: change plan, record payment (sets
paid_until), suspend/reactivate (suspended → chat replies with a neutral "unavailable"
message, panel shows why). First operator is created from `OPERATOR_EMAIL` /
`OPERATOR_PASSWORD` env on startup if none exists.

## 9. Integrations — behaviour

- **WooCommerce:** REST API v3 over HTTPS, Basic auth with consumer key/secret. Import
  products (+ variations as separate sellable items, `per_page=100`, paginated), stock,
  orders (last 90 days, then incremental by `modified_after`). Webhooks
  (`product.created/updated/deleted`, `order.created/updated`) verified with
  `X-WC-Webhook-Signature` = base64 HMAC-SHA256 of the raw body. Scheduled incremental
  sync every 15 min as a safety net.
- **Custom API (`/api/v1`)**: Bearer key per store. `PUT /products/:externalId`,
  `DELETE /products/:externalId`, `PUT /orders/:externalId`, `GET /conversations`,
  `GET /conversations/:id`, `POST /conversations/:id/messages` (staff reply),
  `GET/POST/DELETE /webhooks`. Outbound events (`order.created`, `conversation.waiting`)
  POSTed with `X-Signature` HMAC-SHA256, retried with backoff.
- **Sync rules:** upsert by `(store_id, external_id)` → idempotent and retryable; a
  failed run never deletes or half-writes (each page in a transaction); errors land on
  the integration and the attention center; jobs run off the request path in a queue.
- **Widget:** widget.js fetches `/api/chat/:slug/config` (branding, position, welcome);
  the server records `Origin` in `widget_sightings`. That sighting is the only thing that
  marks a widget-only store as "installed".

## 10. Security

Scrypt passwords (kept), HttpOnly SameSite=Lax session cookie (kept), login lockout
(kept, plus IP rate limit), CSRF: state-changing panel routes require JSON +
same-origin `Origin` check, AES-256-GCM for every integration secret with `SECRET_KEY`
validated at startup, API keys stored hashed and shown once, HMAC verification with
timing-safe compare, rate limits on public chat and public API, CSP tightened for app
pages, errors never leak internals (kept), operator routes behind `requireOperator`.

## 11. Testing

`node --test`. Keep and adapt the 21 tests. Add: migration of a v1 database (slug and
data preserved), tenant isolation on every owner endpoint, operator-only access,
crypto round-trip and tamper detection, WooCommerce client against a fake HTTP server
(pagination, auth error, partial failure → no corruption, idempotent re-run), webhook
signature accept/reject, public API auth + upsert, attention-center derivation,
analytics numbers from seeded rows, takeover stops AI replies, draft vs published
config. A browser smoke check (headless Chrome) of each page at 375 / 768 / 1440 in both
themes: no console errors, no horizontal overflow.

## 12. Build order (each phase ends green and usable)

1. Foundation — migrations, users/workspaces/stores model, data migration, scope helper,
   auth/session changes, existing features working on the new model, isolation tests.
2. Design system + app shell — tokens (dark+light), components, sidebar/header/store
   switcher/drawer, router; Overview with real metrics, stores, attention, activity.
3. Stores, Products, Knowledge base, Orders pages.
4. Conversations inbox: statuses, takeover, staff replies, notes; chat page + widget
   (config endpoint, branding, position, polling, sightings).
5. AI assistant config: draft/publish, preview, test chat, context inspector.
6. Integrations: crypto, sync queue, WooCommerce connector + webhooks, custom API +
   keys + outbound webhooks.
7. Analytics, Billing, Settings; operator admin panel.
8. Hardening: rate limits, CSRF/CSP, accessibility and responsive passes, performance
   (indexes, pagination checks), README/study-guide rewrite.

## 13. Open — left to the builder or the operator

- **AI provider in production:** any OpenAI-compatible service reachable from Iran
  (an Iranian gateway billed in Toman is the likely choice). Operator decision, `.env`
  only; offline mode keeps the product usable meanwhile.
- WooCommerce testing uses the owner's local demo shop (`~/Coding/bridal-shoes-wp`,
  his own) rather than the client's rug shop.

## 14. Decisions after the builder check (2026-11-07)

**The owner's answers**
- **Plan expiry:** when `paid_until` passes, the workspace drops to the free plan
  automatically (no suspension). Panel shows «پلن شما به پایان رسیده» with the operator
  contact; the attention center lists it.
- **Plans stay simple:** Pro = more AI replies. Free = 100 AI replies/month, 1 store,
  widget only. Pro = 3,000 AI replies/month (owner's example; one constant in
  `plans.js`), up to 5 stores, WooCommerce + custom API. Only real AI replies count
  toward the limit; offline answers and "unavailable" replies are free.
- **Operator sees metadata only:** counts, usage, stores, domains, widget sightings,
  plans, payments. No route lets the operator read conversations, customer names,
  phones, addresses or order contents — a hard wall, with tests.

**Builder calls (mine)**
- **Widget locked to the store's domains.** Each store has an allowlist of domains
  (its main domain, editable). `/api/chat/:slug/config` and chat POSTs from an
  `Origin` outside the list are refused; `/chat/:slug` gets a per-store
  `frame-ancestors`; sightings are recorded only for allowed origins. The direct
  `/chat/:slug` link (opened as a page, no Origin/embedding) keeps working.
- **Takeover:** customer sees «یکی از همکاران ما به‌زودی پاسخ می‌دهد»; AI stays off for
  that conversation until the owner hands it back or closes it. "Waiting" = last
  message is from the customer and unanswered for 10 minutes (constant).
- **Disconnect store** = soft: chat stops answering, sync stops, data kept, doesn't
  count toward the store limit; reconnect restores it. **Delete store** and **delete
  workspace** are separate hard deletes behind a typed-name confirmation.
- **WooCommerce status map:** pending/on-hold → new, processing → confirmed,
  completed → sent, cancelled/refunded/failed → cancelled. Synced orders are read-only
  in the panel (change them in WooCommerce). Store currency is read from WooCommerce
  settings; IRR prices are divided by 10 to Toman, anything else is refused with a
  clear error.
- **`PUBLIC_BASE_URL`** becomes a required env var in production (webhook URLs, widget
  snippet); defaults to `http://localhost:PORT` in development.
