# Next steps — from built to live

Written 2026-11-08. All 8 build phases are done on `feat/platform` (pushed, 118 tests).
Nothing below is started yet. Rough order: 1 → 2 → 3 → 4; the rest whenever.

## 1. Decide what goes on `main`
- [ ] Tag the current `main` as `uni-v1` (the university version stays findable forever).
- [ ] Merge `feat/platform` into `main` — Parspack deploys `main`, like the other two apps.

## 2. Pick a real AI provider
The code is ready: three lines in `.env` (`AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`), any
OpenAI-compatible service. Without a key it keeps running in offline mode.
- [ ] Test on the laptop first: free OpenRouter key + the two proxy lines in `.env.example`
      (v2rayN on). Chat with the demo shop, try placing an order, open «این پاسخ بر اساس چه بود؟».
- [ ] Watch whether the model sends the order block correctly; tune the prompt if not.
- [ ] Choose a provider that works **from Iran** (Parspack servers are in Iran; OpenRouter and
      OpenAI block Iranian IPs) — most likely an Iranian gateway billed in Toman. Compare price
      per reply and Persian quality.
- [ ] Work out the cost of one AI reply → check the plan prices cover it (free plan = 100 replies/month per shop).

## 3. Put it on Parspack
- [ ] Check whether Parspack can stop an app without paying (look for توقف/خاموش on the rates
      app, or ask support). Creating an app starts it — and the billing — right away.
- [ ] Your own account (top of the panel must say **Ali Mahmoudi**, not the uncle's).
- [ ] New Node.js app from `CRYSTAL6985/business-assistant`, small size like the rates app
      (~100 MB RAM used locally), **1 GB disk at `/data`** — without it the database is wiped on every deploy.
- [ ] Settings:

  | Name | Value |
  |---|---|
  | `NODE_ENV` | `production` |
  | `DB_FILE` | `/data/assistant.db` |
  | `SECRET_KEY` | `openssl rand -base64 48` — keep a copy somewhere safe; losing it makes saved WooCommerce keys unreadable |
  | `PUBLIC_BASE_URL` | the app's https address, no trailing slash |
  | `OPERATOR_EMAIL`, `OPERATOR_PASSWORD` | your admin login |
  | `SUPPORT_CONTACT` | phone / Telegram shown on the billing page |
  | `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL` | from step 2 |

- [ ] GitHub webhook so a push to `main` deploys (same as the rates app).
- [ ] After it is up, check from outside: pages load, operator login works, data survives a
      restart, and rate limits see real visitor IPs (not Parspack's proxy).
- Cost estimate: about the same as the rates app with its disk, ~140,000 تومان/month.

## 4. Put it on ABRISHAM (www.abrishambtq.ir)
- [ ] **Ask Mehdi first** — his shop, and his customers' messages and phone numbers go through this app.
- [ ] In the hosted app: sign up for the shop, set the domain to `www.abrishambtq.ir`, add products and FAQs
      (by hand, or later have the boutique send them through `/api/v1`, which needs the pro plan + some code).
- [ ] **ABRISHAM blocks it today:** its security header (`boutiqueProject/server/security.js`) only allows
      its own scripts. Add the assistant's address to `script-src`, `connect-src` and `frame-src`.
- [ ] Add the one-line `<script src=".../widget.js" data-business="..." defer>` before `</body>`.
- [ ] Check the integrations page shows "seen on www.abrishambtq.ir".

## 5. Test with a real WooCommerce shop
- [ ] Needs an **https** WooCommerce site (WooCommerce refuses key login over plain http, so the
      local bridal-shoes demo can't be used). Only a fake shop has been tested so far.

## Later / known gaps
- Add-store step-by-step wizard (spec item; today: a dialog + the integrations page).
- WooCommerce deletions arrive only by webhook; a missed one leaves the item in the catalogue.
- Online payment gateway (payments are recorded by hand in `/admin` for now).
- Terms of service / privacy text before real shops sign up (it stores their customers' data).

## Trying it locally
```bash
DB_FILE=data/demo.db DEMO_PASSWORD=abrisham-demo node src/seed.js   # fresh demo database
node data/fake-woocommerce.js                                       # fake shop on :3120 (optional)
DB_FILE=data/demo.db PORT=3100 OPERATOR_EMAIL=admin@demo.local OPERATOR_PASSWORD=admin-demo-123 npm start
```
Owner `demo@abrisham.local` / `abrisham-demo` · operator `admin@demo.local` / `admin-demo-123` ·
fake WooCommerce: `http://127.0.0.1:3120`, `ck_demo_key_123`, `cs_demo_secret_123`.
(`data/` is not in git, so the fake shop file and demo database exist only on this laptop.)
