# 10 — System architecture

Audited from `agentify-erp/` (Node 22, Express 4, `node:sqlite`, React 18 + Vite 5, Recharts, PDFKit, ExcelJS). ~28k lines of application code (server + client + shared), 45 page files (40 + 5 console), 34 shared components, 31 route files, 42 service files, 122 end-to-end tests.

## One-picture view

```
Browser (React SPA, PWA)                         Public website (/site, same SPA bundle, tenant-themed)
   │  fetch + cookie (erp_token, httpOnly) + header X-Requested-With: ERP         │ GET /api/site/*  (no auth, rate-limited, honeypot)
   ▼                                                                              ▼
Express app ── helmet/CSP ─ json(2mb) ─ cookies
   ├─ /api/platform/*        control plane: signup, tenants, billing, console   (NOT tenant-scoped)
   ├─ maintenanceGate ─ tenantContext(host → tenant)  ──►  AsyncLocalStorage { tenant, db }
   ├─ /api/public/*          key-authenticated, CORS-open website integration
   ├─ rateLimit(900/min) ─ authenticate ─ csrfGuard ─ billingGuard
   └─ /api/<module> routers  ──►  services/*  ──►  db.js (sync SQLite, per-tenant connection)
                                       └─► accounting.postJournal (single posting engine)
Background: setInterval(30 min) per tenant → reminders, goal nudges, content reminders; hourly platform snapshot; scheduled backups.
Storage:  data/platform.db + data/tenants/<slug>/erp.db (WAL) + uploads/tenants/<slug>/
```

## Layering rules (strictly followed in the reference)

| Layer | Folder | Allowed to | Never |
|---|---|---|---|
| Route | `server/src/routes/*.js` | parse/validate input, call `can(module, action)`, apply row scope (`ownerId`), shape JSON, `audit()` | contain business rules or multi-step writes |
| Service | `server/src/services/*.js` | own **all** business logic and every multi-statement write, wrapped in `tx()`; call `postJournal`, `notify`, `activity` | read `req` beyond `req.user`/`req.ip` for audit |
| Data | `db.js`, `schema.js` | `all/get/run/val/tx/insert/update/nextNo/getSetting/setSetting` | be bypassed by raw connection use in routes |
| Shared | `shared/*.js` | pure functions imported by **both** client and server (e.g. `installmentPlan.js`, `sectionStyle.js`, `constructionTools.js`) | import anything environment-specific |
| Client page | `client/src/pages/*.jsx` | compose components, call `api`, own screen state | format money/dates inline, hard-code colours |
| Client component | `client/src/components/*.jsx` | reusable UI; consume `context.jsx` hooks | call a different module's endpoints |

**"Shared pure module" rule:** whenever the screen shows a computed result that the server later re-derives (installment schedule, section CSS, calculators), put the algorithm in `shared/` so the two can never disagree. Example: the website calculator and `POST /api/site/installment-plan[/pdf]` import the same `installmentPlan.js`.

## Repository layout to replicate

```
<erp>/
  server/  src/{index,db,schema,rbac,audit,context,platform,util,filters,seed,env}.js
           src/routes/*.js  src/services/*.js  test/*.test.js  .env.example  package.json
  client/  index.html  vite.config.js  public/{sw.js,manifest.webmanifest,icons}
           src/{main,App,api,context,theme,brand,format,printPdf,celebrate,supabase}.js(x)
           src/components/ src/pages/ src/site/ src/styles.css styles2.css styles3.css
  shared/  *.js (pure)
  mobile/  Capacitor wrapper (loads the hosted ERP)
  supabase/schema.sql  (optional Postgres mirror — see 30-sync)
  docs/    ARCHITECTURE.md README.md
  .github/workflows/ci.yml   (npm ci → server tests → client build)
  package.json  (install:all, seed, dev:server, dev:client, build, start, test)
```

## Runtime & build facts

* **No ORM, no migrations framework.** Schema is a single idempotent `CREATE TABLE IF NOT EXISTS` string run on every open; changes are additive `addCol(table, col, def)` in `db.js migrate()` plus one-time rebuilds guarded by `PRAGMA table_info` checks. Backfills (`backfillIds`) are idempotent and also run at open.
* **Synchronous DB** (`node:sqlite`): handlers are plain functions; `asyncH` wraps only for async I/O (PDF, mail, exports). Transactions are `tx(fn)` with `BEGIN IMMEDIATE` and **savepoint nesting** (`sp<depth>`), so a service can call another service inside its own transaction safely.
* **Pragma set:** `journal_mode=WAL; foreign_keys=ON; busy_timeout=5000`.
* **Vite dev proxy** forwards `/api` and `/uploads` to :4000 and injects `x-forwarded-host` so tenant subdomains (`acme.localhost:5173`) work in dev.
* **Prod serving:** Express serves `client/dist` and falls back to `index.html` for non-API/non-upload paths; `/health` returns `{ok, db}`.
* **CSP (helmet):** `default 'self'`; img `self data: blob: https:`; style `self 'unsafe-inline' fonts.googleapis.com`; font `self fonts.gstatic.com data:`; script `self` only; frames limited to YouTube/Google Maps/OpenStreetMap; HSTS + `upgradeInsecureRequests` only when `NODE_ENV=production`.
* **Config:** `server/.env` via `env.js` (real env vars win). Secrets for third-party keys saved from the console are encrypted with `ERP_SECRETS_KEY`.
* **Node features relied on:** `node:sqlite`, `node:test`, `AsyncLocalStorage`, `fetch`, `AbortSignal.timeout`. Requires **Node ≥ 22**.

## Cross-cutting services (reusable as-is)

| Concern | File(s) | Notes |
|---|---|---|
| Audit trail | `audit.js audit()` | every state change: who, what, entity, id, detail, ip, PKT time; append-only by convention |
| Timeline | `audit.js activity()` | per-contact feed with `field/prev/next`; bumps `last_activity_at` |
| Notifications | `audit.js notify / notifyPerm` | in-app row + web-push; `dedupe` key + `INSERT OR IGNORE` gives once-a-day reminders for free |
| Counters / numbering | `db.js nextNo(key, prefix, width)` | atomic upsert on `counters`: `SL-00001`, `JV-000123`, `CUS-0001`, `REG-0001`, `VND-0001` |
| Settings KV | `getSetting/setSetting` | `settings(key,value)`; JSON for structured values (`site_config`) |
| Exports | `routes/helpers.js sendTable` | one function → xlsx/csv/pdf/json for any list |
| PDF | `services/pdf.js`, `voucherPdf.js`, `receiptSheet.js` | branded letterhead, repeating headers, totals, page numbers, landscape > 6 cols |
| Uploads | `helpers.js uploader(dir, kind, maxMb)` | ext + MIME whitelist, random names, per-tenant folder, context restored for multer |
| Filtering | `filters.js` | smart-list rule engine (AND/OR) compiled to parameterised SQL |
| Mail | `services/mailer.js` | Resend API; without key prints to log and returns link to the admin |
| Push | `services/push.js` | VAPID keys auto-generated into settings |
| Backup | `services/backup.js` | scheduled snapshots of platform + every tenant DB (+ optional uploads), retention N |
| Maintenance/errors | `services/maintenance.js` | global read-only/maintenance gate; 500s recorded for the console |
| Rich text | `services/richText.js` | sanitiser for editor HTML |
| TOTP | `services/totp.js` | RFC 6238, replay-protected (`totp_last_step`), hashed recovery codes |

## Change-impact map (what to touch when adding a module)

1. `schema.js` tables (+ `migrate()` for old DBs) → 2. `services/<module>.js` → 3. `routes/<module>.js` + mount in `index.js` → 4. `rbac.js MODULES` + `seed.js` role grants + `upgradePermissions()` → 5. `Layout.jsx NAV` → 6. `App.jsx` route wrapped in `G(module, …)` → 7. `insights.js` today-card + `NOTE_META` entry → 8. export columns → 9. `test/<module>.test.js` → 10. docs (`ARCHITECTURE.md` section, README).
