# دستیار هوشمند کسب‌وکار — AI Business Assistant

A multi-store SaaS for Iranian online shops. A shop owner signs up, connects their website
(WooCommerce, their own site through an API, or just a chat widget), and gets an AI assistant
that answers customers from the shop's real products and FAQs and **takes orders**. Owners
watch every conversation, take over from the AI, and manage orders. The operator (the
platform's owner) runs the business from a separate admin panel: plans, manual payments,
suspension — without ever seeing a customer's data.

Revenue model: monthly plans. **Pro means more AI replies** (and more stores and integrations).

Demo shop: **بوتیک ابریشم (ABRISHAM)** with its real products.

---

## Run it

```bash
npm install
cp .env.example .env               # optional in development
DEMO_PASSWORD=abrisham-demo npm run seed
npm start                          # http://localhost:3000
npm test                           # 118 automated tests, about 1 second
```

| Page | URL | Who |
|---|---|---|
| Landing page | `/` | everyone |
| Customer chat | `/chat/abrisham` | customers (also inside the widget) |
| Owner panel | `/app` (sign in at `/panel`) | shop owners — `demo@abrisham.local` / your `DEMO_PASSWORD` |
| Operator panel | `/admin` | the operator (`OPERATOR_EMAIL` / `OPERATOR_PASSWORD` in `.env`) |
| Widget demo | `/widget-demo.html` | a pretend shop website with the widget on it |
| Classic panel | `/panel?next=panel` | the original single-shop panel (still works) |

### Settings (`.env`)

| Variable | What it does | Production |
|---|---|---|
| `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL` | any OpenAI-compatible chat API. Empty key = offline mode | optional |
| `SECRET_KEY` | encrypts integration secrets (≥32 chars, `openssl rand -base64 48`) | **required** |
| `PUBLIC_BASE_URL` | the app's public address (WooCommerce webhooks are sent here) | **required** |
| `SUPPORT_CONTACT` | shown on the billing page: how owners reach you to upgrade | recommended |
| `OPERATOR_EMAIL`, `OPERATOR_PASSWORD` | creates the first operator account at startup | once |
| `NODE_ENV=production` | turns on the checks above, HSTS, and the SSRF guard | yes |

OpenRouter blocks Iranian IPs; for AI calls from Iran use a provider reachable from Iran, or
`NODE_USE_ENV_PROXY=1` + `HTTPS_PROXY=http://127.0.0.1:10808` through a local VPN. Without any
key the assistant still works in **offline mode** (answers from the FAQs and product list).

---

## Tech stack (and why)

| Part | Choice | Why |
|---|---|---|
| Server | Node.js 22+ + Express 4 | one language front and back; the most common Node framework |
| Database | SQLite via `node:sqlite` (built into Node), numbered migrations | no database server; one file; real SQL |
| Frontend | plain HTML/CSS/ES modules, Persian RTL, no build step | every line is readable; nothing to compile |
| AI | any OpenAI-compatible chat API | provider changes with one setting |
| Tests | `node:test` (built in) + headless Chrome smoke checks | no test library to install |

The only installed package is still `express`. Encryption, hashing, HMAC, HTTP calls and the
database all come from Node itself.

---

## The big picture

```
 customer ── /chat/<slug> or widget.js ──►  chat API ──► assistant (AI or offline) ──► reply
                                               │                 │
                                               │                 └─ order proposal ─► validateOrder ─► orders
 shop owner ── /app ──► owner API (/api/app) ──┤ every query scoped to the owner's workspace
                                               │
 WooCommerce ─ REST API ◄── sync queue ────────┤ products / orders imported, kept fresh
 WooCommerce ─ signed webhooks ──► /api/webhooks
 shop's own site ── Bearer key ──► /api/v1 ────┤
                    ◄── signed outbound webhooks (order.created, conversation.waiting)
 operator ── /admin ──► admin API (/api/admin) ── metadata only, never customer data
```

### Tenants: users → workspaces → stores

- A **user** signs in. A **workspace** is the paying customer (plan, paid-until, status).
  A workspace has one or more **stores**; each store is one website with its own products,
  FAQs, orders, conversations, assistant settings and integrations.
- **Isolation lives in one file, `src/scope.js`.** Every owner route asks it which stores the
  signed-in user may touch; a store id from the browser is never used without passing
  through `storeFor()`. Tests create two workspaces and check that every endpoint answers
  404 for the other one's ids (`test/isolation.test.js`, plus a check in each feature's tests).

---

## Folder map

```
src/
  server.js          createApp(): wires everything; configFromEnv() checks production settings
  db.js              opens SQLite and runs migrations
  migrations/        001 … 008, applied in order at startup, each in a transaction
  auth.js            scrypt passwords, sessions, login lockout, requireUser / requireOperator
  security.js        CSP and other headers, CSRF guard for cookie APIs
  ratelimit.js       per-IP token buckets (login, sign-up, chat, public API)
  scope.js           tenant isolation: which stores a request may touch
  assistant.js       the "brain": prompt, AI call, order extraction + validation, offline answers
  assistantConfig.js per-store assistant settings: defaults, validation (draft vs published)
  plans.js           free / pro limits, effective plan (expired pro = free), monthly usage
  overview.js        overview metrics, store summaries, activity feed, sidebar counts
  analytics.js       per-store comparison for a date range
  attention.js       «نیازمند توجه»: problems derived from real state
  events.js          activity events (order created, takeover, …)
  inbox.js           takeover and staff replies (shared by the panel and the public API)
  crypto.js          AES-256-GCM for secrets, HMAC, constant-time compare
  safeUrl.js         SSRF guard for URLs the server calls
  apiKeys.js         API keys: created once, stored as SHA-256
  outbound.js        signed webhooks to the shop's own system, with retries
  scheduler.js       every minute: due WooCommerce syncs, conversation.waiting
  sync/woocommerce.js  WooCommerce client + mapping (currency, variations, status map)
  sync/upsert.js     idempotent writes keyed by (store_id, external_id)
  sync/queue.js      one sync per store at a time, retries, sync history
  routes/
    chat.js          public chat + widget config (domain lock, sightings, suspension)
    account.js       sign-up / login / logout
    app.js + app/*   owner panel API: stores, products, faqs, orders, conversations,
                     assistant, integrations, settings, overview, analytics, billing
    publicApi.js     /api/v1 for shops' own websites (Bearer key)
    webhooks.js      inbound WooCommerce webhooks (HMAC verified)
    admin.js         operator API (metadata only)
    panel.js         the classic single-shop panel API
public/
  app.html + js/app/       owner panel: shell, router, one ES module per page
  admin.html + js/admin/   operator panel
  css/                     tokens (dark + light), components, shell, one file per page group
  chat.html/.js, widget.js customer chat page and the one-line website embed
  ui.js                    safe element builder, icons, toasts, dialogs, bidi fix, Persian dates
test/                      one file per feature; helpers.js starts a real app on a random port
docs/superpowers/          the design spec and the plan for each of the 8 build phases
```

---

## Database (migrations in `src/migrations/`)

| Table | Holds |
|---|---|
| `users` | email, scrypt password hash, name, `is_operator` |
| `workspaces` | name, plan, `paid_until`, status (`active` / `suspended`) |
| `workspace_members` | which user belongs to which workspace (role) |
| `sessions` | login tokens; workspace is empty for the operator's own login |
| `stores` | slug (public id for chat/widget), name, domain, platform, disconnected_at |
| `assistant_configs` | per store: `draft_json` (being edited), `published_json` (what customers get) |
| `products`, `faqs` | catalogue and knowledge base; synced products carry `external_id` + `source` |
| `conversations`, `messages` | chats; messages have role (user / assistant / staff), source (ai / offline / staff) and `context_json` (what an answer was based on) |
| `conversation_notes` | internal notes, never shown to the customer |
| `orders` | customer, items snapshot, server-computed total, status, source (assistant / woocommerce / api) |
| `integrations`, `sync_runs` | WooCommerce connection (encrypted keys) and sync history |
| `api_keys`, `webhooks` | the shop's API keys (hashed) and outbound webhooks (encrypted secret) |
| `widget_sightings` | which website origins really loaded the widget |
| `events` | activity feed |
| `payments` | manual payments recorded by the operator |

**Migrations:** `schema_migrations` records the version; pending steps run in order at
startup, each inside a transaction with a foreign-key check, so a failed step leaves the
database exactly as it was. Migration 002 converted the original one-shop database into
users/workspaces/stores while **keeping every slug**, so old chat links and widget snippets
still work (`test/migrations.test.js`).

---

## How one customer message flows (`routes/chat.js`)

1. `POST /api/chat/<slug>` with `{ conversationId, message }`. Rate limit: 30/min per IP.
2. Find the store by slug (connected only). A request from another website is refused unless
   it comes from the store's own domain (`origins.js`).
3. Open the conversation, or start one with a random UUID.
4. **Human handling it?** If the owner took over, save the message and tell the customer
   «یکی از همکاران ما به‌زودی پاسخ می‌دهد». The AI stays silent.
5. **Suspended workspace?** A neutral «not available» line; nothing counted.
6. **Plan limit reached?** A polite "not available" line (offline answers never count).
7. Build the system prompt from the store's **published** assistant settings, products and FAQs.
8. Ask the AI with the last 12 messages. If the reply holds an `<order>{…}</order>` block,
   **validate it against the database** (`validateOrder`) — ids, stock, quantities, phone —
   and save it with prices and total **from the database**. If ordering is off in the
   settings, the block is ignored even if the model sends one.
9. AI unavailable (no key, error, timeout)? **Offline mode** answers from the FAQs / products.
10. Save the reply with `context_json` (which products/FAQs it saw, which FAQ matched, whether
    an order was accepted and why not) — the panel shows it as «این پاسخ بر اساس چه بود؟».

### Why the AI is never trusted with orders
The AI can only *propose* an order. The server rebuilds it from the database: every product
must belong to this store and be in stock, quantities 1–10, the phone a valid Iranian mobile,
and **prices and the total always come from the database**. The public API follows the same
rule: `PUT /api/v1/orders/:id` ignores any total it is sent and computes it from the lines.

### Offline mode
`offlineReply` normalizes text (Arabic ي/ك → Persian ی/ک, Persian digits, punctuation), drops
common words, and picks the FAQ sharing the most keywords; questions about prices or products
list what is in stock. The shop keeps answering during an AI or network outage.

---

## The owner panel (`/app`)

One HTML shell, a History-API router and one ES module per page. The store switcher in the
header («همه فروشگاه‌ها» or one store) lives in the URL (`?store=`), so reloads and links keep it.

| Page | What it does |
|---|---|
| نمای کلی | revenue (confirmed + sent orders only), orders, conversations, AI rate, each with the previous period and a sparkline; stores; «نیازمند توجه»; activity feed |
| فروشگاه‌ها | add within the plan limit, domain, disconnect (soft) / reconnect, delete (typed name), widget snippet + where it was really seen |
| گفتگوها | inbox: filters, takeover, staff replies (the customer page polls for them), notes, related orders |
| سفارش‌ها / محصولات | search, filters, paging; synced rows are read-only (change them in WooCommerce) |
| دستیار هوشمند | draft → live preview + test chat (runs on the draft, saves nothing) → publish |
| پایگاه دانش | FAQs and policies |
| یکپارچه‌سازی‌ها | WooCommerce connect + sync history, API keys + docs, outbound webhooks, widget |
| تحلیل و گزارش‌ها | daily chart + per-store comparison (AI rate, offline rate, takeovers) |
| صورتحساب | effective plan, usage, paid-until, payments, how to upgrade |
| تنظیمات | profile, password (signs out other devices), workspace name, theme, delete workspace |

Every number is computed from rows. With no data a page says so; it never shows a placeholder.

---

## Integrations

**WooCommerce** (`sync/`). The owner pastes the site URL and a REST key pair. *Connected*
means WooCommerce really answered with those keys — not that a URL was typed. Then:
- Products are imported page by page (100 per page, each page in its own transaction).
  Variable products become one sellable item per variation (`<parent>:<variation>`).
- Orders from the last 90 days, then only what changed since the last good sync.
- Currency: IRT ×1, IRR ÷10, IRHT ×1000, IRHR ×100 → Toman. Anything else is refused with a clear message.
- Status map: pending/on-hold → new, processing → confirmed, completed → sent, cancelled/refunded/failed → cancelled.
- Every write is keyed by `(store_id, external_id)`, so running a sync twice changes nothing
  (idempotent). A failed run keeps the pages it finished, records the error, and does not move
  the "changed since" cursor, so the next run re-reads what was missed.
- Webhooks (`product.*`, `order.*`) keep it instant; each is verified with
  `X-WC-Webhook-Signature` (base64 HMAC-SHA256 of the raw body). A scheduled sync every
  15 minutes is the safety net. Problems appear in the attention center.
- WooCommerce only accepts key authentication over **HTTPS**; real shops use HTTPS.

**Own website (`/api/v1`)** — `Authorization: Bearer ba_<prefix>_<secret>`. Keys are shown
once and stored as SHA-256, so a database leak leaks no working key. Endpoints: upsert/delete
products, upsert orders, read conversations, reply as staff, manage webhooks. 120 requests/min per key.

**Outbound webhooks** — `order.created` (an order the assistant took) and
`conversation.waiting` (a customer unanswered for 10 minutes, sent once per wait). Each POST is
signed `X-Signature: sha256=<hex HMAC>`; three attempts (now, +5 s, +30 s); last status shown.

**Widget** — `widget.js` asks `/api/chat/<slug>/config` for branding; that request's `Origin`
is recorded in `widget_sightings`. That sighting — not a typed domain — is what shows the
widget as installed.

---

## Plans and the operator

| Plan | AI replies / month | Stores | Integrations |
|---|---|---|---|
| free | 100 | 1 | widget only |
| pro | 3,000 | 5 | WooCommerce, API, webhooks |

Only real AI replies count. A pro workspace whose `paid_until` has passed drops to free
automatically (no suspension); the billing page and attention center say so.

Payments are by hand: the operator records amount + "paid until" in `/admin`, which sets the
plan to pro until the end of that day (Tehran time). The operator can change plans and
suspend / reactivate a workspace (its assistants then answer a neutral "not available").

**The wall:** the operator API returns metadata only — owner email, plan, usage, store names,
domains, widget sightings, payments, row counts. No route returns conversations, customer
names, phones, addresses or order contents. A test seeds such data and checks that none of it
appears in any admin response (`test/admin-billing.test.js`).

---

## Security

| Threat | Protection | Where |
|---|---|---|
| Stolen password database | scrypt with a random salt per password | `auth.js` |
| Password guessing | 5 wrong tries lock that email 15 min; 10 logins/min per IP | `auth.js`, `server.js` |
| Session theft by scripts | HttpOnly, SameSite=Lax cookie | `auth.js` |
| CSRF | writes must come from our own origin and be JSON (a form on another site can be neither) | `security.js` |
| Script injection (XSS) | text only through `textContent`; CSP allows only our own scripts (no inline) | `ui.js`, `security.js` |
| Clickjacking | `frame-ancestors 'self'`; the chat page only on the store's own domain (any site until a domain is set) | `security.js`, `origins.js` |
| One shop reading another's data | every owner query through `scope.js`; tests for every endpoint | `scope.js` |
| SQL injection | parameterized queries only | everywhere |
| Leaked integration secrets | AES-256-GCM with `SECRET_KEY`; never sent back to the browser; API keys only hashed | `crypto.js`, `apiKeys.js` |
| Forged webhooks | HMAC-SHA256 checked with a constant-time compare | `routes/webhooks.js` |
| Server tricked into calling internal addresses (SSRF) | https only; host must resolve to a public address (production) | `safeUrl.js` |
| Flooding the AI / API | per-IP limits on chat, per-key limit on `/api/v1`, monthly plan cap | `ratelimit.js` |
| AI inventing prices or orders | server re-checks every order against the database | `assistant.js` |
| Operator seeing customer data | admin API is metadata only, with a test | `routes/admin.js` |
| Error details leaking | generic message to the browser, details only in the server log | `server.js` |

Known limits (written next to the code as `shortcut:` comments): login lockout and rate
limits live in memory (they reset on restart and assume one server process); the SSRF check
resolves DNS once before a request (DNS rebinding is not covered); WooCommerce deletions arrive
only through the delete webhook — the scheduled sync adds and updates but never deletes, so a
missed delete webhook (or a deleted variation) leaves that item in the catalogue.

---

## Testing

`npm test` runs every file in `test/` against a real app on a random port with an in-memory
database and a fake AI / fake WooCommerce server / fake webhook receiver. Highlights:
tenant isolation on every endpoint, v1 → current database migration, order validation,
draft vs published assistant, takeover silences the AI, WooCommerce pagination / variations /
currency / auth error / partial failure / idempotent re-run, webhook signatures both ways,
API keys shown once, the operator wall, CSRF / CSP / rate limits, production config checks.

Each phase also ended with a headless-Chrome pass over every page at 375 / 768 / 1440 px in
dark and light: no console or CSP errors, no horizontal scroll, no unnamed buttons or
unlabelled inputs.

---

## Likely defense questions

- **What happens if the AI service is down?** Offline mode answers from the FAQs and the
  product list; the shop keeps working.
- **Can the AI invent a price or an order?** It can say something wrong in text, but it cannot
  create a wrong *order*: the server rebuilds every order from database prices and ids.
- **How is one shop's data kept from another?** One module (`scope.js`) decides which stores a
  request may touch, every query goes through it, and tests try every endpoint with another
  workspace's ids.
- **How does a WooCommerce shop connect, and what if a sync fails halfway?** A REST key pair,
  tested with a real call. Writes are keyed by external id, so a re-run is safe; a failed run
  keeps finished pages and retries the rest next time.
- **How do you know a webhook really came from WooCommerce?** It is signed with a secret only we
  and that shop know; we recompute the HMAC over the raw body and compare in constant time.
- **Where are the shops' WooCommerce keys stored?** Encrypted with AES-256-GCM; the key is in
  the server's environment, not the database. API keys we issue are only stored hashed.
- **How do you know the widget is really installed?** Its config request carries the site's
  `Origin`; we record that. A typed domain alone never counts as installed.
- **Can you, the operator, read customers' chats?** No. The admin API returns metadata only,
  and a test fails if any customer name, phone, address or message appears in it.
- **How do you get paid?** Manually for now: the operator records the payment and the plan runs
  until the end of the paid day. An Iranian payment gateway is the next step.
- **Why SQLite?** Zero setup, a single file, enough for this scale; the SQL is standard, so
  moving to PostgreSQL later is straightforward.
- **Why no vector database / RAG?** A small shop's catalogue and FAQs fit in the prompt, so the
  AI sees all of it every time. Embeddings become worth it at thousands of items.
