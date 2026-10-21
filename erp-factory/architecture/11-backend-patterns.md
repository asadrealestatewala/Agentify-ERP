# 11 — Backend patterns

Reference files: `server/src/{db,util,rbac,audit,filters}.js`, `routes/helpers.js`, `services/{sales,payments,expenses,commissions,accounting}.js`.

## 1. The canonical route

```js
const r = Router();

r.get('/sales', can('sales', 'view'), asyncH((req, res) => {
  const where = ['1=1'], params = [];
  const o = ownerId(req);                       // own_scope roles are row-restricted HERE, server-side
  if (o) { where.push('s.agent_id=?'); params.push(o); }
  if (req.query.q) { where.push('(s.sale_no LIKE ? OR c.full_name LIKE ? …)'); params.push(...Array(n).fill(`%${req.query.q}%`)); }
  for (const [k, col] of [['project_id','s.project_id'], ['status','s.status']]) if (req.query[k]) { where.push(`${col}=?`); params.push(req.query[k]); }
  // exports: same query, no paging, extra permission
  const limit = EXPORT ? 100000 : Math.min(int(req.query.limit, 25), 500), page = Math.max(int(req.query.page, 1), 1);
  const total = get(`SELECT COUNT(*) n FROM (${BASE} WHERE ${where.join(' AND ')})`, ...params).n;
  const rows = all(`${BASE} WHERE ${…} ORDER BY s.id DESC LIMIT ? OFFSET ?`, ...params, limit, (page-1)*limit);
  if (EXPORT) { if (!hasPerm(req.user,'sales','export')) throw forbidden(); return sendTable(res, fmt, 'sales', cols, rows); }
  res.json({ rows, total, page, limit });          // ← the universal list envelope
}));

r.post('/sales', can('sales', 'create'), asyncH((req, res) => {
  const out = createSale(req.body, req);           // service does validation + tx + journal + audit
  res.status(201).json(out);
}));
```

Rules extracted:
* **Order of middleware on a route:** `can(module, action)` → `asyncH(handler)`. Authentication/CSRF/billing are mounted globally in `index.js`.
* **List envelope is always `{ rows, total, page, limit }`**; details return the entity (plus related arrays, e.g. `documents`, `receipts`); errors are `{ error: "message" }` (+ extra keys such as `code`).
* **Status codes:** 200/201 · 400 `bad()` validation · 401 unauthenticated · 402 billing locked / module not in plan (with `code`) · 403 `forbidden()` / CSRF · 404 `notFound()` · 409 unique violation (mapped globally from `UNIQUE constraint failed`) · 413 file too large · 500 hidden message + `recordError`.
* **Export = same endpoint with `?format=csv|xlsx|pdf`**, gated by `module:export`, built by `sendTable`. Never write a separate export endpoint.
* **SQL is always parameterised.** Only whitelisted column names are interpolated (`insert(table, data, cols)` / `update()` accept a column whitelist so mass-assignment is impossible).
* **IDs in the URL use a numeric regex** `/:id(\\d+)` so named sub-routes (`/sales/preview`) never collide.
* Row-scope check on detail routes: `assertSaleAccess(req, row)` → 403 "This sale is not yours". Portal routes derive `contact_id` from `req.user`, never from the client.

## 2. `crud()` for simple masters (`routes/helpers.js`)

`crud(router, {table, module, cols, search, filters, json, orderBy, label, select, required, before, after, scope, baseWhere, canDelete})` registers list/get/create/update/delete with permissions, search, equality filters, JSON column (de)serialisation, audit lines, FK-in-use → friendly 400. Use for every table that is "a list of things with a form". Pair with `ResourcePage` on the client.

## 3. Services own the business rules

Pattern used by every money-moving function (`createSale`, `receivePayment`, `voidReceipt`, `createVoucher/approveVoucher/payVoucher`, `payCommission`, payroll):

```js
export function doThing(inp, req) {
  validate(inp)                              // throw bad('…') with a human sentence
  return tx(() => {                          // BEGIN IMMEDIATE / SAVEPOINT — nests safely
    const id = insertRow(…)
    …child rows (installments, allocations)…
    const journalId = postJournal({ refType, refId, lines:[…] })   // balanced or throws
    run('UPDATE parent SET journal_id=?, paid_amount=? …')          // caches that can be re-derived
    activity(contactId, req.user, 'Receipt', {…})                   // timeline
    audit(req, 'Created receipt', 'receipt', id, detail)            // audit
    notify([…ids], type, title, body, link, { dedupe })             // in-app + push
    return id
  })
}
```
* Validation messages are written for end users ("Balloon payments exceed the remaining balance"), not developers; the UI shows `error` verbatim.
* **Everything that changes money, stock, status or access calls `audit()`**; everything customer-visible calls `activity()`; everything someone must act on calls `notify()`.
* **Idempotence guards** on re-entrant operations (`createAssetsFromVoucher` checks `voucher_id`; reminders use `dedupe`; reversals check `reversal_of`).
* **Caches are allowed, truth is derived:** `sales.paid_amount`, `installments.paid/status` are caches; ledger tests assert `SUM(installments.paid) == sales.paid_amount == SUM(receipt_sales)`.

## 4. State machines (explicit, linear, audited)

| Entity | States | Rules |
|---|---|---|
| Lead (configurable) | lookups `lead_stage` with `meta.kind` new/open/lost/won | colours & order are data; "won" triggers confetti and customer conversion |
| Property | draft → available ⇄ featured / reserved / on_hold → sold / cancelled | sold can't be re-sold; reserved only for reserver; draft/cancelled can't be sold |
| Sale | confirmed → cancelled | cancel reverses journal + commission |
| Receipt | valid → void | void = reversing journal, receipt row kept with `void_reason` |
| Expense voucher | created → submitted → approved → partial → paid / rejected | journal at *approved* (accrual) and at each *payment* |
| Commission | pending → approved → partially_paid → paid | separate payable account 2300 |
| Leave | pending → approved / rejected → revoked / cancelled | approver = `hrm:approve` or reporting manager |
| Payment claim | pending → verifying → approved(receipt issued) / rejected | auto-match from payment feed by `txn_norm+amount` |
| Tender | draft → open → closed(auto at `closes_on`) → awarded / cancelled | awarding rejects the rest, notifies all |
| Subscription (tenant) | trialing → active → past_due(7d grace) → read-only locked | append-only `subscription_history` |

## 5. Numbering & codes

`nextNo(key, prefix, width)` (atomic counter upsert): `SL-00001` sale, `JV-000001` journal, `AST-0001` asset, `CLM-00001` claim (derived from id), `CUS-0001` customer code (assigned at first purchase), `REG-0001` property registration (auto if blank; unique case-insensitive), `VND-0001` vendor, tender no, receipt no, voucher no, commission no, payment no. Unique indexes are partial (`WHERE col IS NOT NULL`) so old rows can be backfilled idempotently at start-up.

## 6. Dates, money, JSON in SQLite

* Money = **INTEGER minor-less whole currency units** (PKR rupees). No floats in storage; fractions only in quantity × unit cost then `Math.round`. Last instalment absorbs rounding; every rupee is scheduled.
* Time = text `YYYY-MM-DD HH:MM:SS` in the **tenant's** timezone (`now()` uses `Intl` with `tenantTz()`); dates `YYYY-MM-DD`. Date presets are resolved server-side (`dateRange`) so the browser clock never decides a financial period. `addMonths` clamps to month-end.
* JSON stored as TEXT (`features`, `amenities`, `tags`, `custom`, `boq`, `sections`); parse with `jparse(s, default)`. The `clean()` wrapper in `db.js` JSON-stringifies objects and maps `undefined→null`, `boolean→0/1` so call sites never worry.
* Booleans are `INTEGER 0/1`.

## 7. Search & identifiers

`customerSearchClause()` normalises phone numbers to the last 10 digits and CNIC punctuation so every spelling matches; global search (`/api/search`) returns `{type,id,title,subtitle,badge,link}` rows from many modules, permission-filtered. New modules register their entity type there so the palette/search finds them.

## 8. Background work

No queue system. `setInterval` (30 min, `.unref()`) iterates `forEachTenant(() => { runReminders(); runGoalReminders(); contentReminders(); })`, each wrapped in try/catch and `markJob(name, err)` for the console health page. Idempotent via `notifications.dedupe`. Scheduled backups, hourly platform snapshot + alert generation. **Limit:** single-process; fine for one VM, needs a lock/queue when horizontally scaled.

## 9. Testing pattern (what "done" means)

`node --test` + real server on port 0 + temp DB per file (`ERP_DATA_DIR/ERP_DB` set before importing the app), tiny `client(email)` helper keeping a cookie jar and sending `X-Requested-With: ERP`. 122 tests across: acceptance scenarios (lead → sale → payment → expense → portal → website), **ledger reconciliation invariants** (trial balance debits = credits; AR control account = Σ outstanding; installment/receipt/paid caches agree; vendor payable = open vouchers), RBAC & row isolation (agents vs customers vs vendors), CSRF, void/cancel integrity, multi-tenant isolation (token from tenant A rejected on B), billing lifecycle, super-admin console, onboarding/hardening. Copy the invariant style: **assert the books, not just the HTTP status.**
