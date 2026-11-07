# دستیار هوشمند کسب‌وکار — AI Business Assistant

A web platform where any business signs up, enters its own products and FAQs, and gets an
AI chat assistant for its customers. The assistant answers questions, introduces products,
and **takes orders**. Revenue model: monthly subscription plans that cap assistant replies.

Demo business: **بوتیک ابریشم (ABRISHAM)**, with its 9 real products.

---

## Run it

```bash
npm install
cp .env.example .env          # optional — without an API key it runs in offline mode
DEMO_PASSWORD=abrisham-demo npm run seed
npm start                     # http://localhost:3000
npm test                      # 21 automated tests
```

| Page | URL |
|---|---|
| Landing page | `/` |
| Customer chat | `/chat/abrisham` |
| Owner panel | `/panel` — login `demo@abrisham.local` / the `DEMO_PASSWORD` you chose |

### Turning the AI on (free)
1. Make a free key at https://openrouter.ai/keys (needs a VPN from Iran).
2. In `.env` set `AI_API_KEY=` to the key and `AI_MODEL=` to any model id ending in `:free`
   from https://openrouter.ai/models?q=free.
3. OpenRouter blocks Iranian IPs, so also uncomment `NODE_USE_ENV_PROXY=1` and
   `HTTPS_PROXY=http://127.0.0.1:10808` (your v2rayN port).

Any OpenAI-compatible API works the same way. Change `AI_BASE_URL` to switch provider.

---

## Tech stack (and why)

| Part | Choice | Why |
|---|---|---|
| Server | Node.js + Express | One language front and back; Express is the most common Node web framework |
| Database | SQLite via `node:sqlite` (built into Node) | No database server to install; one file; real SQL |
| Frontend | Plain HTML/CSS/JS, Persian RTL | No build step; every line is readable |
| AI | Any OpenAI-compatible chat API | Provider can change with one setting; free models available |
| Tests | `node:test` (built into Node) | No test library to install |

The only installed package is `express`.

---

## Folder map

```
src/
  server.js        entry point; createApp() connects all routes
  db.js            database schema (7 tables)
  assistant.js     the "brain": prompt building, AI call, order checking, offline answers
  auth.js          password hashing, login sessions, brute-force lockout
  plans.js         subscription plans and monthly usage
  validate.js      input checks for everything that comes from a browser
  seed.js          creates the ABRISHAM demo business
  routes/
    chat.js        public customer chat API
    panel.js       owner dashboard API (requires login)
    account.js     register / login / logout
public/
  index.html       landing page
  chat.html/.js    customer chat page (restores the conversation after a reload)
  panel.html/.js   owner dashboard
  ui.js            shared helpers: safe element builder, icons, toasts, confirm dialog, bidi fix
  style.css        design system: colour tokens (light + dark), components, motion
  icons.svg        icon sprite (Lucide, ISC licence)
  fonts/           Vazirmatn variable font, self-hosted (OFL licence) so it works offline
  widget.js        one-line embed: a chat bubble for any website
  widget-demo.html a plain "other website" with the widget on it, for the demo
test/
  assistant.test.js  unit tests for the brain
  api.test.js        full HTTP tests with an in-memory database and a fake AI
```

---

## Database (src/db.js)

| Table | Holds |
|---|---|
| `businesses` | each shop: slug (its chat URL), name, description, tone of voice, login email, password hash, plan |
| `products` | name, description, price (toman), in stock — belongs to one business |
| `faqs` | question + answer — belongs to one business |
| `conversations` | one chat session with one customer |
| `messages` | every message, with `role` (user/assistant) and `source` (ai/offline) |
| `orders` | customer name, phone, address, items snapshot, total, status |
| `sessions` | login tokens for business owners |

**Multi-tenancy:** every table has a `business_id`. Every panel query includes
`WHERE business_id = ?` using the logged-in owner's id, so one shop can never see or edit
another shop's data. A test proves it (`api.test.js`: "cannot touch another shop's product").

---

## How one customer message flows (src/routes/chat.js → handleMessage)

1. Browser sends `POST /api/chat/abrisham` with `{ conversationId, message }`.
2. Server finds the business by slug, checks the message (1–1000 characters).
3. Opens the conversation, or creates a new one with a random UUID.
4. **Plan check**: has the business used up this month's replies? If yes, send a polite "not available" message.
5. Save the customer's message.
6. Load this business's products and FAQs and build the **system prompt** (`buildSystemPrompt`).
   The prompt tells the AI to answer only from that data.
7. Send the system prompt plus the last 12 messages to the AI (`askModel`).
8. If the reply contains a hidden `<order>{...}</order>` block, take it out and **check it**
   (`validateOrder`). If it's valid, save the order and add "✅ order #N saved".
9. If the AI fails (no key, network down, timeout), use **offline mode** instead (`offlineAnswer`).
10. Save the assistant's reply and send it back.

### How ordering works, and why the AI isn't trusted
The AI can only *propose* an order, in this format:
`<order>{"items":[{"id":3,"qty":1}],"name":"…","phone":"…","address":"…"}</order>`.
The server then checks it against the database:
- every product id must belong to **this** business and be in stock
- quantity must be a whole number from 1 to 10
- the phone must be a valid Iranian mobile (`normalizePhone` accepts +98, Persian digits, spaces)
- **prices and the total come from the database, never from the AI.** If the AI
  hallucinates a price, nothing changes.

### Offline mode (no AI)
`offlineAnswer` normalizes the text (Arabic ي/ك → Persian ی/ک, Persian digits → 0-9, removes
punctuation), drops common words ("و", "از", "چی"…), and counts how many keywords the question
shares with each FAQ. The best FAQ wins. If someone asks about prices or products, it lists
the in-stock products. Otherwise it says it doesn't know. The chat still works during a
network outage, which matters in Iran.

### Why not a vector database / RAG?
A small business has tens of products and FAQs. That fits easily in the prompt, so the AI
sees *all* the data on every message. Embeddings and a vector database would add complexity
with no benefit at this size. They would be the next step for a shop with thousands of items.

### Design decisions worth knowing
- **Right-to-left with English product names:** the browser's bidi algorithm reorders mixed
  Persian/English lines ("۴٬۹۰۰٬۰۰۰ — Sand Bomber تومان"). `bidiText` in `ui.js` wraps every
  English run in a `<bdi>` element so each line reads correctly.
- **Self-hosted font:** Google Fonts can be slow or blocked in Iran, so Vazirmatn ships with the app.
- **Accessibility:** every button has a label, focus rings are visible, tabs work with arrow keys,
  dialogs trap focus and close on Esc, and `prefers-reduced-motion` turns animations off.
- **No innerHTML for data:** everything from the server is inserted as text (`el()` in `ui.js`),
  so a message containing `<script>` is shown, never run.

---

## Security

| Threat | Protection | Where |
|---|---|---|
| Stolen password database | scrypt hashing with a random salt per password | `auth.js` hashPassword |
| Password guessing | 5 wrong tries → that email is locked for 15 minutes | `auth.js` createLoginLimiter |
| Timing attacks on login | `crypto.timingSafeEqual` | `auth.js` verifyPassword |
| Session theft by scripts | HttpOnly cookie | `auth.js` setSessionCookie |
| CSRF | SameSite=Lax cookie + API accepts JSON only | `auth.js`, `server.js` |
| One shop editing another's data | every query filtered by `business_id`; 404 otherwise | `routes/panel.js` |
| SQL injection | only parameterized queries (`?` placeholders) | everywhere |
| XSS (script injection via chat) | the browser uses `textContent`, never `innerHTML` | `chat.js`, `panel.js` |
| AI making up prices or orders | server re-checks every order against the DB | `assistant.js` validateOrder |
| Clickjacking the panel | `frame-ancestors 'self'` (only the chat page can be embedded) | `server.js` |
| Error details leaking | generic "server error" to the browser, details only in the server log | `server.js` |

Known limits: the login lockout lives in memory, so it resets on restart. There's no
per-IP rate limit on the public chat; the monthly plan cap is the only brake.

---

## Revenue model (src/plans.js)

| Plan | Replies per month |
|---|---|
| free | 100 |
| pro | 5,000 |

Usage is counted from the `messages` table (assistant replies since the 1st of the month).
The panel shows a usage bar. Payment isn't built: the plan is changed in the database.
A payment gateway (ZarinPal) is the obvious next step.

---

## Likely defense questions

- **What happens if the AI service is down?** Offline keyword mode answers from the FAQs (step 9).
- **Can the AI invent a price or a product?** It can say something wrong in text, but it
  cannot create a wrong *order*: `validateOrder` uses database prices and ids.
- **How do you stop the AI from answering off-topic?** The system prompt limits it to the
  business data. Low temperature (0.3) keeps it close to the facts.
- **How is one business's data kept separate?** `business_id` on every row plus
  `WHERE business_id = ?` on every query, with a test that proves it.
- **Why SQLite and not MySQL?** Zero setup and a single file, which is enough for a small SaaS.
  The SQL is standard, so moving to PostgreSQL later is straightforward.
- **How does a shop put the bot on its own website?** One `<script>` line (`widget.js`) adds a
  chat bubble that opens `/chat/<slug>` in an iframe.
- **How is it tested?** 21 automated tests: the brain's logic (orders, phone numbers, offline
  answers, the AI HTTP call against a fake server) and the full HTTP API (tenant isolation,
  login lockout, AI failure fallback, plan limit).
