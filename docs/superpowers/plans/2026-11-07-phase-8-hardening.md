# Phase 8 — Hardening Implementation Plan

**Goal:** Close the remaining gaps before real shops use it: abuse limits, CSRF, CSP, accessibility and responsive passes, indexes, and a README that explains the new system.

**Spec:** §10 Security, §11 Testing (browser smoke), §12 step 8.

## Decisions
- Per-IP token buckets (`ratelimit.js`): login 10/min, sign-up 2/min (burst 5), customer chat 30/min (burst 20); `/api/v1` 120/min per key. In production the app trusts one proxy hop so the limits see the real client IP behind Parspack.
- CSRF (`security.js`): POST/PUT/DELETE on cookie APIs (`/api/auth`, `/api/panel`, `/api/app`, `/api/admin`) must come from our own origin (or `PUBLIC_BASE_URL`) and carry JSON. Public chat, `/api/v1` and webhooks are excluded: they are cross-origin by design and authenticated otherwise.
- CSP on every page: own scripts only, no inline scripts (the theme boot script moved to `/js/theme-boot.js`); inline style attributes allowed (styles cannot run code); `frame-ancestors 'self'`, or the store's domains for `/chat/<slug>`. HSTS and Permissions-Policy in production.
- `configFromEnv`: production refuses to start without `SECRET_KEY` and `PUBLIC_BASE_URL`, and turns off private-address URLs.
- Index for the inbox's orders-by-conversation lookup (migration 008); all other hot queries already use indexes (checked with EXPLAIN QUERY PLAN).
- Browser smoke: every owner page, chat, landing, widget demo, classic panel and admin at 375 / 768 / 1440 in dark and light — no console/CSP errors, no horizontal scroll, no literal null/undefined/NaN, and a small accessibility audit (named controls, labelled inputs, unique ids, an h1).

## Tasks
1. `security.js`, rate limits wired in `createApp`, migration 008 + `test/security.test.js`.
2. Smoke + accessibility pass; fix what it finds.
3. README / study guide rewrite and `.env.example` for the new settings.
