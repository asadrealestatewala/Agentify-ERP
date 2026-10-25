# Expert Marketing & Developers ERP — Architecture

One integrated system: **Frontend (React SPA) → REST API (Express) → business-logic services → one SQLite database** (`node:sqlite`, WAL, foreign keys ON).
The public website and the customer portal use the same API layer (`/api/public/*`, `/api/portal/*`).

* Currency: PKR, stored as **integer rupees** (no float drift). Currency code lives in settings so others can be added.
* Time: every timestamp is stored in **Asia/Karachi** wall-clock (`YYYY-MM-DD HH:MM:SS`), dates as `YYYY-MM-DD`. Date presets are computed server-side in PKT.
* Demo rows are flagged `is_demo=1`; the UI shows a "DEMO DATA" marker.

## 1. Entity relationships

```
lookups (stages, sources, types, amenities, methods, categories…)      custom_fields
users ─ roles ─ role_permissions                         employees ─ payroll / attendance / leaves
contacts(lead→customer) ──< activities, notes, tasks, documents
   │  agent_id/manager_id → users
   └──< sales >── properties(unit) >── projects ──< dev_items, dev_updates, media
          │             │
          │             └ media (cover/gallery/site plan/map/dev/video)
          ├──< installments (booking | advance | installment | balloon)
          ├──< receipts ──< receipt_allocations >── installments
          ├──< commissions ──< commission_payments
          └ journal (Dr Receivable / Cr Property Sales)
accounts (chart of accounts, tree) ──< journal_lines >── journals(ref_type, ref_id)
vendors ──< expense_vouchers ──< vendor_payments           (lines carry project_id / vendor_id / contact_id)
smart_lists, notifications, audit_log, reconciliations, sync_log, settings, counters
```

## 2. Accounting logic (single posting engine: `services/accounting.js`)

Nothing writes balances. Every financial event is a **balanced journal**; reports, ledgers, dashboards and the portal are all queries over `journal_lines` + the sub-ledgers.

| Event | Debit | Credit |
|---|---|---|
| Sale confirmed | 1300 Customer Receivable (customer) | 4100 Property Sales (project) |
| Receipt (≤ outstanding) | Cash/Bank/Till (chosen) | 1300 Receivable |
| Receipt excess (flagged overpayment) | Cash/Bank | 2200 Customer Advances |
| Refund | 1300 Receivable | Cash/Bank |
| Expense voucher approved | Expense account (project) | 2100 Vendor Payables (vendor) |
| Vendor payment | 2100 Vendor Payables | Cash/Bank/Custody |
| Treasury transfer / custody | destination | source |
| Commission approved | 5700 Commission Expense | 2300 Commission Payable |
| Commission paid | 2300 | Cash/Bank |
| Salary paid | 5300 Salaries | Cash/Bank |
| Void | reversing journal (never delete) | |

Project income = sales booked to the project; collections = receipts; receivable = sales − collections; expense = project-tagged expense lines.

## 3. Transaction flows (all inside one DB transaction)

* **Sale**: validate property not sold → create sale → generate installment schedule → property `sold` → contact → customer (stage Closed) → journal → commission by rule → optional booking receipt → activity + audit + notifications + portal login.
* **Receipt**: validate ≤ outstanding (or overpayment) → pick installments (preferred kind, oldest first) → allocations → installment status → sale paid cache → journal → activity/audit/notification.
* **Expense**: created → submitted → approved (journal) → paid (vendor payment journal). Credit purchases stay payable with due date/aging.
* **Property → website**: status/publish/feature drive `website_state`; `/api/public/*` serves ERP data; optional webhook notifies the site on change.

## 4. RBAC

Modules × actions (`view create edit delete approve export print`) per role in `role_permissions`; Super Admin bypasses. Roles with `own_scope` (Sales Agent) are row-restricted in the service layer (own leads/customers/sales/commission) and are denied finance modules. Customers are `portal` users bound to one `contact_id`; portal routes never take an id from the client for scoping.

## 5. API map

`/api/auth` · `/api/settings` (users, roles, lookups, custom-fields, system) · `/api/contacts` `/api/smart-lists` `/api/tasks` `/api/notes` `/api/pipeline` · `/api/agents` `/api/commissions` · `/api/properties` `/api/projects` `/api/dev` · `/api/sales` `/api/customers` · `/api/receipts` `/api/installments` · `/api/accounting` (coa, journals, treasury, statements) · `/api/vendors` `/api/expenses` · `/api/hrm` · `/api/reports` `/api/dashboard` `/api/search` `/api/documents` `/api/notifications` `/api/audit` · `/api/portal` · `/api/public` (key-protected) · `/api/goals` `/api/push` · `/api/assistant` · `/api/site` (public website, no auth) · `/api/site-admin` (website editor) · `/api/staff` (my space, work tasks, assets) · `/api/content` (content calendar) · `/api/promos` (portal promotions).

## 6. Frontend routes / components

Sidebar groups from the brief (collapsible). Shared components: `DataTable` (search/sort/paginate/column visibility/export/bulk), `FilterPanel` (AND/OR), `Modal`, `Drawer`, `Tabs`, `StatusBadge`, `Timeline`, `Kanban`, `CurrencyInput`, `FileUploader`/`ImageUploader` (drag-order), `LedgerTable`, `DashboardCard`, `Chart`, `ConfirmDialog`, `DateRangeFilter`, `ResourcePage` (config-driven list+form for simple masters).

## 7. Validation & security

Server-side validators per route, parameterised SQL only, bcrypt hashing, JWT in httpOnly SameSite cookie + `X-Requested-With` CSRF guard, helmet, rate limits, upload whitelist (type/size) with authenticated document download, React escaping against XSS, audit log on every important action.

## 8. Construction contracts, bundles and schedules

```
sales(kind: property|construction, title, property_id NULL for contracts, bundle_id, linked_sale_id)
sale_bundles ──< sales          one combined plan per customer (plot + house)
receipts ──< receipt_sales >── sales      one voucher, one share per sale (+ receipt_allocations per installment)
project_tasks(project_id, sale_id NULL = shared, parent_id, predecessor_id, planned/actual dates, progress, weight)
expense_vouchers.sale_id        cost tagged to a contract
```

* Journals: contract revenue `Dr 1300 / Cr 4150`; a split receipt is `Dr cash` and one `Cr 1300` line **per sale** (tagged with that sale and its project).
* Ledgers are derived from `receipt_sales` (credits) and the sale itself (debit); the bundle ledger is the same query over all sales of the bundle.
* `services/schedule.js` computes planned %, actual %, status, delay, forecast finish (progress rate, or planned duration slid forward; finish-to-start predecessors propagate) and a health rating — nothing is stored, so delays appear and clear automatically.

## 9. Gamification, notifications and push

```
agent_goals(user_id NULL = team default, period daily|monthly, leads, followups, conversions, sales_value)
notifications(type, dedupe UNIQUE per user)     INSERT OR IGNORE makes reminders once-a-day
push_subscriptions(user_id, endpoint, keys)     VAPID keys auto-generated into settings
```

* `services/goals.js`: actuals are queries over contacts/activities/sales (nothing stored). Overall % = average of the metrics whose target > 0; points (lead 10, follow-up 5, conversion 100), streaks, badges, leaderboard and the "leads left to convert" list are derived the same way. Setting goals needs `crm:approve` and is denied to `own_scope` roles.
* `audit.notify()` writes the in-app notification and calls `services/push.js pushTo()` for web/phone push. A scheduled job runs `runGoalReminders` (9 am, 2 pm if < 60 %, 6 pm, PKT).

## 10. Date-driven activities

`project_tasks.progress` is ignored. `schedule.js progressSql/computeSchedule` derive planned % from start/due dates; `actual_end` means completed; overdue activities cap at `OVERDUE_CAP` (95); forecast finish propagates through predecessors; project % is weighted by duration × weight and is what the portal shows. `construction_activity` setting is the activity library.

## 11. PDF and exports

`services/pdf.js sendPdf` (pdfkit) renders a branded letterhead (settings `print_*`), repeating column headers, totals and page numbers; landscape above 6 columns. `routes/helpers.js sendTable` serves csv/xlsx/pdf for every list, report, statement, ledger and balance sheet.

## 12. Assistant

`services/assistant.js ask(question, user)` classifies the question into an intent, extracts a period (today, this month, last 30 days, …) and an entity (project, employee, agent), and runs permission-checked queries. Agents are denied finance/HR intents. `POST /api/assistant/pdf` re-runs the question server-side so the PDF cannot be forged from the client; questions are logged in `chat_log`.

## 13. Public website and editor

```
settings.site_config (JSON)     brand, theme, header, footer, social, contact, calculators, listing, seo
site_pages(slug, sections JSON, published, show_in_menu, seo_*)     block-based pages
site_posts(slug, body markdown, cover, tags, published)
```

* `/api/site/*` is public, rate-limited, honeypot-protected and returns only published data — never commission, cost or drafts. Listing agent contact details appear when `listing.show_agent` is on. `POST /api/site/inquiry` reuses the CRM ingestion (round-robin agent, manager notification).
* `/api/site-admin/*` needs the `website` module permission (Sales Manager: view/create/edit). Sales Agents publish their own properties through `/api/properties` (`owns`/`canPublish`, setting `agents_can_publish`).
* Client: `client/src/site/` (SPA mounted at `/site/*`, theme via CSS variables + Google font injection, section renderers keyed by `SECTION_TYPES`) and `pages/WebsiteEditor.jsx` (schema-driven forms from the same `SECTION_TYPES`, live `SitePreview`).
* Website icons: one approved list of semantic ids (`shared/siteIcons.js`) drawn as Tabler outline icons by `client/src/site/SiteIcon.jsx`; pages store ids, legacy emoji are mapped at render time and normalised on save. Rules and how to add an icon: `docs/website-icons.md`.

## 14. Mobile / PWA

`client/public/manifest.webmanifest` and `sw.js` (app-shell cache, never caches `/api` or `/uploads`; push and notification-click handlers). `Layout.jsx MobileTabs` adds the phone bottom bar and the install prompt. `mobile/` is a Capacitor wrapper that loads the hosted ERP for store builds.

## 15. Employee self-service, attendance, leave and payroll

```
employees(user_id -> users, manager_id -> employees, photo, father_name, employment_type)   login <-> employee link
attendance(employee_id, date, status present|late|half_day|absent|leave)                    marked by HR
leaves(status pending|approved|rejected|revoked|cancelled, decision_note, decided_at)
payroll(commission)   <- commissions(agent_id, status approved|partially_paid) outstanding at generation
```

* `services/hr.js`: `attendanceSummary` (working days = not Sunday/holiday up to today; % = attended / (working days - approved leave)), `createLeave`, `decideLeave` (approve / reject / revoke / cancel; authority = `hrm:approve` or the employee's reporting manager), `commissionDue`.
* `routes/staff.js` serves `/me/*` strictly by `req.user` (never a client id). Payslips are visible only when `status='paid'`.
* Paying a payslip splits the net: the commission part goes through `payCommission` on the oldest approved commissions (Dr Commission Payable / Cr cash), the salary part is Dr Salaries / Cr cash. The commission on the slip may not exceed what is approved and unpaid.

## 16. Work tasks and assets

```
work_tasks(assigned_to, assigned_by, status todo|in_progress|blocked|done) · work_task_updates(note timeline)
assets(asset_no, status in_stock|assigned|repair|retired, employee_id, assigned_date, voucher_id) · asset_history
```

* Assigning requires seniority (`hrm:create`, `crm:approve`, `accounting:approve`, `projects:create`, Super Admin or having direct reports); an assignee can change status/notes but not the brief.
* A purchase is an ordinary expense voucher on account `5800 Assets & Equipment Purchases`, so approval, payment and the funds trail belong to Accounting; `assets.voucher_id` links the two.

## 17. Content calendar

`content_posts(platforms JSON, posted JSON {platform: time}, creative_path)` - creatives live in `uploads/content/` (never statically served; `/api/content/posts/:id/creative` is authenticated). `social_accounts` stores handles and write-only API credentials. The browser hands the creative to the platform (Web Share API on phones, download + clipboard + platform URL on desktops); `POST .../posted` ticks a platform and flips the post to *posted* when all are done.

## 18. Portal additions

`portal_promos` (staff-managed) plus live listings feed `/api/portal/promos`; documents are visible when `portal_visible=1` and the entity is the customer's own contact, sale, property or one of their projects; `/api/portal/pay-to` exposes only bank/wallet details from active payment methods.

## 19. Installment plan generator

`shared/installmentPlan.js` is imported by both the website calculator and `POST /api/site/installment-plan[/pdf]`, so the schedule a visitor sees is exactly what they download. Booking and advance are dated, installments step by N months from the first date, balloons are placed every `balloon_every` installments (default: evenly spread), the last installment absorbs rounding, and every rupee of the payable amount is scheduled.

## 20. Voucher PDFs

`services/voucherPdf.js` builds receipt and expense vouchers on top of `services/pdf.js` (`details` two-column grid, `amount` box, `signatures`, `note`, `watermark`). Customer copies (`forCustomer`) omit the deposit account, receiving staff and sale agent. Downloads are audited; the portal endpoint only serves the signed-in customer's own valid receipts.

## 21. Customer IDs and registration numbers

`contacts.customer_code` (unique, `CUS-0000`) is assigned in `services/customers.js ensureCustomerCode` when a contact first becomes a customer (first confirmed sale); `properties.registration_no` (unique, case-insensitive; auto `REG-0000` when blank) is validated in `routes/properties.js`. `db.js backfillIds()` numbers anything missing at start-up and enforces the unique indexes. `GET /api/properties/lookup?q=` is the counter-side status check (sale status, file status, price; the buyer's name is hidden from own-scope agents). Client: `CustomerPicker` / `PropertyPicker` type-ahead boxes, `components/VoucherPreview.jsx` for the live receipt / expense previews.

## 22. Receipt record and customer lookup

`services/customers.js receiptRecord(contactId, saleId)` is the single source for what a receipt states about the customer and the file (a construction contract resolves to its linked plot); it feeds `loadReceipt`, `GET /api/receipts/record` (live preview), the PDFs and the portal. `customerSearchClause()` normalises phone numbers (last 10 digits) and CNICs so every spelling matches, and powers `GET /api/customers/lookup`, the customer and contact lists. File statuses: Active, Inactive, Paused, Defaulted, Suspended (set manually on the property).

## 23. Asset Library and the voucher "Paid from" option
* An expense voucher on account 5800 (or ticked "buys an asset") carries optional `asset_info` (units, name, category, brand/model, serial, warranty). On **approval**, `createAssetsFromVoucher` files one asset per unit in `assets` (`source='voucher'`, `voucher_id`), taking cost (split across units), purchase date and vendor from the voucher — nothing is typed twice. Re-approval never duplicates (guarded by `voucher_id`).
* Assets missing a category or make/model/serial are flagged `details_missing`; HR or Finance (`libraryAccess`: hrm OR accounting) completes them in `/assets`. Cost and purchase date are locked to the voucher.
* `expense_vouchers.show_paid_from` (default 0) only controls whether "Paid from" prints on the voucher/PDF; the paying account is always recorded. Toggle after the fact via `POST /api/accounting/expenses/:id/show-paid-from`.

## 24. Interactivity layer
* **Appearance** (`client/src/theme.js`, `components/Appearance.jsx`): light/dark/auto, three densities and six accent colours, stored per browser and applied before React renders. Light surfaces in `styles.css` are CSS variables; `styles2.css` holds the dark theme and every newer component's styles. Printed paper (`.vp`, `.print-doc`) always stays white.
* **Undo** (`context.jsx`): `toast.undoable(msg, {commit, onUndo})` runs `commit` after 8 s unless Undo is pressed; pending commits flush on `pagehide`. `useUndoDelete(scope)` hides rows immediately (a global per-scope set, so it survives navigation). The confirm dialogs are unchanged — undo is the second safety net. Used for deletes, bulk delete, leave withdrawal and pipeline stage moves.
* **Command palette** (`components/CommandPalette.jsx`, Ctrl+K): pages (permission-filtered from `NAV`), actions, record search, and phrases like "receipt for ali" that jump into the form with the customer preselected.
* **Today feed** (`routes/insights.js GET /api/insights/today`, `components/TodayFeed.jsx`): role-aware cards built from live queries (tasks, follow-ups, cold leads, overdue/upcoming installments, voucher/commission approvals, assets missing details, leave requests, unmarked attendance, posts due). Each card links to the filtered screen.
* **Customer 360** (`GET /api/insights/customer/:id`, `/customers/:id/360`): one timeline (payments, sales, notes, activity, documents, tasks, overdue/upcoming installments) plus a single *next best action* (overdue → file status → due soon → missing CNIC → idle). Agents can only open their own customers.
* **Plot map** (`GET /api/insights/plot-map`, `/projects/map`): every plot as a coloured tile by block; click for customer, paid %, and quick actions.
* **WhatsApp** (`components/WhatsApp.jsx`): `wa.me` links with prefilled messages (overdue, due soon, receipt, follow-up); on phones the native share sheet attaches the receipt PDF.
* **Tables** (`components/DataTable.jsx`): click-to-edit cells (`column.edit`), hover quick actions (`quickActions`), and per-table saved views (`useTable({viewsKey})` + `<ViewsBar>`), all remembered in the browser.
* **Offline** (`api.js`, `components/OfflineBar.jsx`, `public/sw.js`): notes, tasks, new leads, attendance and work-task updates made without a connection are queued in `localStorage` and replayed in order when the signal returns (server rejections are reported, not retried). The service worker also caches the signed-in user + lookups so the app opens offline; that cache is wiped on sign-out.
* **Portal**: "Your journey" tracker and payment calendar on each property (`components/Journey.jsx`).

## 25. Calm design layer (UI/UX refresh)
* `client/src/styles3.css` restyles the app to match the reference: airy teal/mint look (default accent `teal`, Plus Jakarta Sans), rounded cards, a light sidebar with an active pill, pastel icon tiles (`.ic-tile.ic-<tone>`), greeting hero with stat pills, quick-action pills and a tabbed dashboard (Overview / Leads & sales / Finance / Inventory / People — only the sections a role may see). All colours are CSS variables, so dark mode and the accent picker still apply.
* Dashboard = hero (role-aware stats) → quick actions → collapsible getting-started → tabs. Overview pairs the "Collected and spent" twin-bar chart (last months of the year, independent of the date filter) with a "Needs attention" list built from `/api/insights/today`.
* **Notification centre** (`components/Notifications.jsx`): icon tile per notification type, filters (All/Unread/Money/Sales/Leads/Tasks/People/Updates), per-item mark-read, day grouping on `/notifications`; polls every 30 s and on tab focus, raising a rich toast (`toast.live`), a bell animation and an unread count in the tab title. Web push (phone) is unchanged.
* The mobile app (`mobile/`, Capacitor) loads this same UI, so it inherits the refresh; its splash/status-bar colours now match (`#0e7c6b`). Phones get a floating rounded tab bar and the notification panel opens full-width.

## 26. Vendor portal, tenders and bids
* **Accounts:** a portal login tied to one vendor (`users.vendor_id`, role *Vendor*, `portal=1`). Staff create or reset it from the vendor record (`POST /api/accounting/vendors/:id/portal-access`; the e-mail becomes the login, the password is shown once and can be sent on WhatsApp). Every vendor has a registration ID (`vendors.vendor_code`, VND-0001…). Vendor sessions can only reach `/api/vendor/*`; customers, staff and vendors are mutually blocked (`requireVendor`, `requirePortal`, `requireStaff`).
* **Money (`services/vendorAccount.js`):** billed / released / remaining come from the books (account 2100 by vendor) and are cross-checked against the approved expense vouchers (`books_in_sync`). Credit purchases, overdue credit and the next credit due come from the same vouchers. The ledger has an opening balance, date filter and PDF/Excel/CSV download. Vendors see only approved, partly-paid and paid vouchers, with no internal accounts or staff names; the voucher PDF respects the "Show Paid from" switch. Approving or paying a voucher notifies the vendor.
* **Tenders (`routes/tenders.js`, `services/tenders.js`):** draft → open → closed (automatically after the closing date) → awarded / cancelled. A tender has a BOQ (items, unit, quantity), optional private estimate (`show_budget` reveals it), documents for vendors (`documents`, entity `tender`, `portal_visible`) and visibility *all* or *one category*. Publishing notifies matching vendors. Staff compare bids side by side (per-line rates, totals vs estimate, duration, terms), shortlist, reject and award; awarding rejects the rest and tells everyone. The comparison exports to PDF/Excel/CSV. Permissions follow the Vendors module (view/create/edit/approve/delete).
* **Bidding (`routes/vendorPortal.js`):** one bid per vendor per tender; with a BOQ every line needs a rate and the total is computed on the server (lump-sum otherwise). Bids can be updated or withdrawn until the contract closes, and carry BOQ / proposal / other files (`documents`, entity `bid`) readable only by the bidder and the company. Vendors never see other bidders or amounts, only whether they won or were not selected.
