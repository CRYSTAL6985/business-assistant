# Phase 5 — AI assistant configuration Implementation Plan

**Goal:** Per-store assistant settings (identity, tone, instructions, policies, languages, order taking, fallback, appearance) edited as a draft, tried in a test chat that uses the draft, then published; every reply can show what it was based on.

**Spec:** §8 AI assistant, §5 (AI never invents prices/stock/orders; server validates orders).

## Decisions
- Config JSON keys: `assistantName, tone, description, instructions, policies, languages (['fa'] | ['fa','en']), welcome, orderTaking (bool), fallbackMessage, color (#rrggbb), position (left|right), launcherText`. Missing keys → defaults (`src/assistantConfig.js`).
- `orderTaking=false`: prompt drops the ordering section and the server ignores any order block (context records why).
- Offline mode returns which FAQ / products it matched (`offlineReply`), stored in `context_json`; `fallbackMessage` replaces the default "I don't know" line.
- Test chat (`POST /api/app/assistant/:storeId/test`) runs against the draft, writes nothing (no conversation, no order — the order is validated and the result shown), returns the context.
- The classic panel's `PUT /api/panel/business` merges into the config instead of overwriting it.

## Tasks
1. `src/assistantConfig.js` (`defaults(storeName)`, `normalize(raw, storeName)`, `validateDraft(input) -> {ok, value} | {ok:false, error}`) + `assistant.buildSystemPrompt(profile, …)` using the new keys + `offlineReply`. Tests in `test/assistant.test.js`, `test/assistant-config.test.js`.
2. API `/api/app/assistant` (GET ?store, PUT /:storeId/draft, POST publish, discard, test) + chat uses published config (orderTaking, fallback). Tests: draft vs published, publish, discard, isolation, test chat writes nothing, orderTaking off ignores orders.
3. Page `pages/assistant.js`: store picker, grouped sections, unsaved/unpublished status, live preview (widget launcher + first bubble with name/welcome/colour/side), test chat with «این پاسخ بر اساس چه بود؟» per reply; the inbox shows the same context per AI message.
