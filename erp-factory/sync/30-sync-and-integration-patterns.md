# 30 — Sync & integration patterns

"Sync" in the reference means six distinct things. Name which one you need before designing.

| # | Pattern | Direction | Transport | Source files |
|---|---|---|---|---|
| 1 | **ERP → public website** (source of truth = ERP) | pull (default) + optional push | REST `X-API-Key`, optional webhook | `routes/public.js`, `routes/site.js`, `services/website.js` |
| 2 | **Bank/wallet → ERP** payment matching | push (webhook/import) | `POST /api/payment-feed` `X-Feed-Key`, statement upload | `routes/claims.js`, `services/claims.js` |
| 3 | **Phone/browser → ERP** offline queue | push-later | `localStorage` queue replayed on `online` | `client/src/api.js`, `OfflineBar.jsx` |
| 4 | **Server → clients** live updates & push | pull-poll + Web Push | `/api/notifications` poll 30 s, VAPID push, service worker | `Notifications.jsx`, `services/push.js`, `public/sw.js` |
| 5 | **Billing provider → platform** | inbound webhooks | HMAC-signed JSON | `routes/billing.js`, `services/stripe.js`, `billing.js` |
| 6 | **ERP ⇄ Postgres/Supabase** mirror | one-time schema mirror (runtime not migrated) | SQL file | `supabase/schema.sql`, `client/src/supabase.js` |
| + | **In-app consistency** (UI ⇄ UI) | event bus | `window` events | `context.jsx` |
| + | **Backup / restore** | snapshot | `VACUUM INTO` | `services/backup.js` |

## 1. ERP → website (the "ERP is the source of truth" contract)

* **State mapping** (`websiteState(p)`): `!published → hidden`; `available → published`; `featured → featured`; `reserved → reserved`; `sold → sold`; `draft/on_hold/cancelled → hidden`. The website never stores listing truth; it renders what the API returns.
* **Two audiences, two APIs:**
  * `/api/public/*` — for an *external* website: `X-API-Key` (constant-time compare), CORS `*`, 120 req/min, **projection functions** (`publicProperty(p,{full})`) that whitelist fields. Endpoints: `GET properties | properties/featured | property/:id | projects | project/:id`; `POST lead | inquiry | contact` → CRM ingestion (round-robin agent assignment, manager notification).
  * `/api/site/*` — for the *built-in* tenant site (no key needed, no cookies, rate-limited, honeypot): `bootstrap`, `pages/:slug`, `listings`, `facets`, `listings/:id`, `projects`, `agents`, `posts`, `inquiry`, `installment-plan[/pdf]`, `metrics`, `booking-options`, `bot/message`, `bot/lead`.
* **Push (optional):** `fireWebhook(propertyId, event)` POSTs `{event, property}` to `website_webhook_url` with `X-ERP-Key`, 8 s timeout; outcome (`ok|error|pull`) recorded in `sync_log` (visible in settings). No URL ⇒ logs `pull` and relies on polling. **Webhooks are best-effort notifications; the pull API is the recovery path.**
* **Never leak:** cost, commission, internal notes, drafts, reservation party. Agent contact details only when `listing.show_agent` is on.
* **SEO surface:** `/sitemap.xml`, `/robots.txt` served by the API per tenant; article scoring in `SeoAssistant`.
* **Block-based site config:** `settings.site_config` JSON (brand/theme/header/footer/social/contact/calculators/listing/seo) + `site_pages.sections` JSON. `siteValidate.js` validates every section server-side (`cleanSectionStyle` for per-device styles; image URL regex allows only `media/…`, `/uploads/…`, `/site/…`, `https://…`). Page versions are kept in `site_page_versions` for rollback.
* **Builder preview:** the editor renders the *real* site in an `<iframe>` and sends the draft via `postMessage`; real media queries run inside the frame so "Mobile" is exact.

**Reuse rule:** any ERP with a customer-facing catalogue (products, courses, rooms, listings) copies this: a *state→visibility* function, *projection* functions, a keyed public API, an optional signed webhook, and a `sync_log`.

## 2. Payment-feed matching

```
customer reports payment (claim: txn_id, amount, slip)  ─┐
bank/wallet alert  → POST /api/payment-feed  ────────────┤→ normalise txn (UPPER, strip non-alnum) → UNIQUE(txn_norm, amount)
statement upload (csv)                                    ─┘     match open claim by txn_norm + amount → auto-approve → receivePayment()
```
* Idempotent by unique index: replays and duplicates are ignored; up to 200 entries per request; only **credits** are recorded.
* Key rotation: `sync-settings` endpoint can regenerate `X-Feed-Key`; webhook URL shown in UI.
* Auto-matched rows are flagged (`auto_matched`, `auto_synced`) so finance can audit what the machine approved.

## 3. Offline queue (field actions)

* Allow-list in `api.js QUEUEABLE`: `POST /api/notes`, `POST /api/contacts`, `POST|PUT /api/tasks`, `POST /api/hrm/attendance[/bulk]`, `POST|PUT /api/staff/work-tasks`. Money, approvals and deletes are **never** queued.
* On network failure the request is stored `{id, method, url, body, at}` and the call resolves `{queued:true, offline:true}` so the UI proceeds optimistically.
* `flushQueue()` runs on `online`, 3 s after load, and via "Retry now": FIFO; **network error ⇒ stop and keep**; **HTTP 401 ⇒ stop**; **other HTTP error ⇒ drop the item and report it** (`erp:synced` event `{sent, failed[]}`). No retry storms, no duplicates (items removed one by one after success).
* Known weakness: no idempotency key — if the response is lost after the server committed, a replay can duplicate a note/task. For new ERPs add a client-generated `Idempotency-Key` header and a server table.

## 4. Live updates & notifications

* Pull: bell polls `/api/notifications?limit=60` every **30 s**, on tab visibility, and after actions; highest-seen-id logic raises toasts only for items newer than the first load.
* Push: `notify()` writes the row then `pushTo()` (web-push, VAPID auto-generated into settings; per-device `push_subscriptions`, pruned on 404/410). Service worker `notificationclick` focuses/navigates to the deep link.
* Dedupe: `notifications(user_id, dedupe)` partial-unique ⇒ `INSERT OR IGNORE` ⇒ scheduled reminders are once-per-day without extra state.
* Not used: WebSocket/SSE. Polling is enough for office scale; add SSE for chat-like needs.

## 5. Billing webhooks

Raw body retained only for `/api/platform/billing/webhook/*` (`express.json verify`). Signature checks: generic `X-Signature: sha256=<HMAC(raw, BILLING_WEBHOOK_SECRET)>`; Stripe `Stripe-Signature` verified by hand (no SDK). Events stored in `billing_events UNIQUE(provider, event_id)` ⇒ replay-safe. State changes go through `services/subscriptions.js`, which appends `subscription_history` (immutable) and updates the tenant.

## 6. Supabase / Postgres status (be honest with clients)

* `supabase/schema.sql` = Postgres DDL (56 tables, 33 indexes, RLS on), idempotent, generated from SQLite — **stale: 9 of the 65 live tables are missing** (tenders, tender_bids, payment_claims, payment_feed, bot_kb, bot_chats, site_page_versions, auth_tokens, verify_tokens); `client/src/supabase.js` exposes a client **only** when real `VITE_SUPABASE_URL/ANON_KEY` are set (placeholder detection built in); staff login and all data still go through the Express API.
* **Not done:** moving `db.js` to async Postgres; `DATABASE_URL` is reserved. Anything sold as "Postgres-backed" requires that migration (every `get/all/run` call site becomes `await`, `julianday`/date SQL helpers are replaced, `tx()` becomes a pooled client transaction, ALS keeps the tenant, RLS or schema-per-tenant chosen).

## 7. UI event bus (in-app sync)

`erp:data-changed` → all `useFetch` reload · `erp:unauthorized` → sign-out · `erp:hidden` → undo-delete masks · `erp:queue`/`erp:synced` → offline bar · `erp:appearance` · `erp:palette` · `erp:assistant`. Fire `erp:data-changed` after any successful mutation that other mounted screens may display.

## 8. Backups

`runBackup()` (cron by `BACKUP_EVERY_HOURS`, default 24; keep `BACKUP_KEEP`=14): `VACUUM INTO` consistent snapshot of `platform.db` + every tenant DB while live, `manifest.json` with per-tenant errors, optional uploads copy (`BACKUP_UPLOADS=1`), prune oldest. **Deliberately excludes `ERP_SECRETS_KEY` and the JWT secret** — store them separately; backup + key = full data + stored provider keys. Restore = stop, replace the `.db`, start (schema upgrade is automatic). Test a restore before go-live.

## Integration checklist for a new ERP

- [ ] Which of the patterns 1–6 apply? Write the answer in the project brief.
- [ ] Every inbound endpoint: auth (key/HMAC), rate limit, size cap, idempotency (unique index), audit/log table.
- [ ] Every outbound call: timeout (`AbortSignal.timeout`), failure recorded, never blocks the user transaction (fire after commit).
- [ ] A pull path exists for every push path.
- [ ] Provider-agnostic seam (`BILLING_PROVIDER=manual|generic|stripe`) so the client can start without a paid account.
- [ ] Secrets only in env/encrypted settings; documented in `.env.example`.
