# Phase 4 — Conversations inbox, takeover, widget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans.

**Goal:** A three-panel inbox where the owner reads chats, takes over from the AI, replies as staff and keeps internal notes; the customer chat shows staff replies live; the widget reads its branding from the server, works only on the store's own domain, and reports where it is really installed.

**Spec:** §8 Conversations, §9 Widget, §14 (takeover behaviour, waiting = 10 min, widget domain lock).

## Decisions (from spec §14)
- Takeover: `handler='human'` → AI never replies in that conversation; customer gets «یکی از همکاران ما به‌زودی پاسخ می‌دهد» (shown, not stored) until a staff message arrives; owner hands back with «واگذاری به دستیار» or closes.
- A staff reply automatically takes over. Closing sets `status='closed'`; a new customer message reopens it.
- Domain lock: allowed origins = the app's own host + `domain` and `www.domain` (both https and http). Empty domain = not locked (attention item «دامنهٔ فروشگاه ثبت نشده» once Phase 6 adds integration health; for now a note on the Stores page). Cross-origin `GET /api/chat/:slug/config` from a disallowed origin → 403 without CORS headers; `/chat/:slug` sends `frame-ancestors 'self' <allowed>`; sightings recorded only for allowed foreign origins.

## Tasks
1. **Migration 005** — conversations: `status, handler, customer_name, last_message_at, unread`; messages: `user_id, context_json`; `conversation_notes`; `widget_sightings(store_id, origin, first_seen_at, last_seen_at, hits, PK)`. Backfill `last_message_at`. Tests: backfill, defaults.
2. **Chat behaviour** — chat.js updates conversation state; human handler skips AI and returns `{ reply: null, source: 'human', notice }`; history endpoint returns `id`, accepts `?after=`; assistant rows store `context_json` (`mode`, `faqIds`, `productIds`, `order`). Tests: takeover stops AI; staff message visible via `?after=`; closed conversation reopens.
3. **Inbox API** — `/api/app/conversations` list (filters: store, status open|closed|waiting, handler, unread, q; paging), detail (marks read; messages, notes, orders), `takeover`, `release`, `close`, `reopen`, `messages` (staff reply), `notes`, `PUT` customer name. Isolation tests on every route.
4. **Widget config + domain lock** — `GET /api/chat/:slug/config` (CORS for allowed origins, sightings), per-store `frame-ancestors`, `widget.js` reads config (color, position, launcher text, welcome). `GET /api/app/stores` includes `sightings`. Tests: allowed vs disallowed origin, sighting upsert, frame-ancestors header.
5. **Inbox UI** — `pages/conversations.js`: list (search, filters, unread dot, waiting badge, AI/human marker) · thread (customer / AI / offline / staff bubbles, takeover/hand back/close, reply box) · side panel (customer name edit, store, related orders, notes). Polls thread every 5 s and list every 20 s while visible. Mobile: list → thread with back button.
6. **Customer chat UI** — `chat.js` polls `?after=` while open, renders staff replies with «پشتیبان فروشگاه», shows the human notice; Stores page shows real widget sightings.
