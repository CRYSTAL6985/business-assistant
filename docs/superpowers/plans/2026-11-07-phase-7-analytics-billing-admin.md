# Phase 7 — Analytics, Billing, Settings, Operator admin Implementation Plan

**Goal:** Owners compare stores over a date range, see their plan / usage / payments, manage profile, password and workspace; the operator runs the business from `/admin` without ever seeing a customer's data.

**Spec:** §8 Analytics, Billing, Settings, Operator admin; §14 (plan expiry, metadata-only wall).

## Decisions
- Analytics reuses the Overview range rules (Tehran days, `today|7d|30d|custom`). Per store: orders, revenue (confirmed + sent), conversations, AI rate (AI ÷ all assistant replies), offline rate, takeovers (`conversation.takeover` events — explicit takeover or first staff reply). Daily series for the workspace (or the chosen store). Rates with no replies are «—», never 0 %.
- Billing shows what is real: effective plan, usage this month, paid-until, expired state, payments the operator recorded, `SUPPORT_CONTACT` for upgrading. No gateway, no fake "upgrade" button.
- Password change needs the current password, then signs out every other session. Deleting a workspace needs its exact name; it removes the stores and all their data, and the user too when they belong to no other workspace and are not the operator.
- Sessions may have no workspace (migration 007 rebuilds `sessions`; everyone signs in again once). Such a session is the operator's: `/api/app/*` answers 403, `/api/admin/*` needs `is_operator`.
- First operator from `OPERATOR_EMAIL` / `OPERATOR_PASSWORD` at startup when no operator exists.
- Operator API returns metadata only: workspace, owner email, plan, paid-until, status, usage, store names/domains/platform, widget sightings, payments, row counts. A test seeds customer names / phones / messages and asserts none of them appears in any admin response.
- Payment = amount + period end (+ note): sets plan pro and `paid_until` to the end of that Tehran day. Suspended workspace: chat answers a neutral «unavailable» line (free, no AI), the panel shows why.

## Tasks
1. Migration 007 (payments, nullable session workspace, events index), auth (`requireOperator`, operator login), `ensureOperator`.
2. `src/analytics.js` + `/api/app/analytics`; `/api/app/billing`; `/api/app/settings` (profile, password, workspace, delete) + tests.
3. `/api/admin` (workspaces, stores, detail, plan, payment, suspend/reactivate) + suspension in chat + hard-wall tests.
4. Pages: analytics, billing, settings; admin shell + pages; login sends the operator to `/admin`; suspended banner. The «later» placeholder page is removed — every section exists.
