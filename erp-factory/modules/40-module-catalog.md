# 40 — Module catalog (what exists, what is reusable)

**Reuse class:** **CORE** = ship in every ERP, adapt vocabulary only · **KIT** = reusable building block, include when the client needs the capability · **VERTICAL** = real-estate/construction specific; mine for patterns, don't copy blindly.

Paths: server `agentify-erp/server/src/{routes,services}/`, client `agentify-erp/client/src/{pages,components}/`.

| # | Module | Class | Purpose & key behaviour | Server | Client | Main tables |
|---|---|---|---|---|---|---|
| 1 | **Auth & sessions** | CORE | email/phone login, JWT cookie, 2FA, invite / reset / verify links, portal vs staff vs vendor login | `routes/auth.js`, `rbac.js`, `services/{accessLinks,totp,mailer}.js` | `Login`, `AuthPages`, `TwoFactor`, `Security` | users, auth_tokens, verify_tokens |
| 2 | **Users, Roles, Permissions** | CORE | module×action matrix, own_scope, role delete with reassign, invitations | `routes/settings.js` | `Settings.jsx` (Users, Roles) | roles, role_permissions, users |
| 3 | **Settings & master data** | CORE | lookups, custom fields, payment methods, categories, system keys (website API key, webhook), notification prefs | `routes/settings.js` | `Settings.jsx`, `ResourcePage` | lookups, custom_fields, settings |
| 4 | **Audit log & timeline** | CORE | who/what/when/old→new, filter + export | `audit.js`, `routes/misc.js` | `Settings.jsx AuditLog`, `Timeline` | audit_log, activities |
| 5 | **Notifications & push** | CORE | in-app centre, grouped by type, web push, once-a-day reminders | `audit.js notify`, `services/{reminders,push}.js` | `Notifications`, `Push` | notifications, push_subscriptions |
| 6 | **Dashboard / Today feed / Onboarding** | CORE | role-aware hero, quick actions, tabs, "needs attention", checklist | `routes/{dashboard,insights}.js` | `Dashboard`, `TodayFeed`, `Onboarding` | (derived) |
| 7 | **Global search + Command palette** | CORE | multi-entity search, intent phrases | `routes/misc.js /search` | `Layout`, `CommandPalette` | (derived) |
| 8 | **Accounting** | CORE | COA, journals, treasury (cash/bank/custody), transfers, reconciliation, income statement, balance sheet, account statement, exports | `services/accounting.js`, `routes/accounting.js` | `Accounting.jsx` | accounts, journals, journal_lines, reconciliations |
| 9 | **Receipts / customer payments** | CORE (re-label "Invoices/Receipts" per vertical) | receipt vouchers with allocation, split across contracts, void, QR verification, PDF, WhatsApp, live preview | `services/payments.js`, `routes/sales.js`, `services/{voucherPdf,receiptSheet,receiptQr}.js` | `Receipts.jsx`, `VoucherPreview` | receipts, receipt_sales, receipt_allocations |
| 10 | **Payment claims & auto-match** | KIT | customer says "I paid" → proof → verify → receipt; bank-feed webhook auto-match | `services/claims.js`, `routes/claims.js` | `PaymentClaims`, `PayNow` | payment_claims, payment_feed |
| 11 | **Expenses / vouchers / credit book** | CORE | create→submit→approve→pay, project/contract tagging, credit aging, asset purchase auto-registers assets, WhatsApp to vendor | `services/expenses.js`, `routes/accounting.js` | `Vendors.jsx` (ExpenseList/Form/Detail, CreditBook) | expense_vouchers, vendor_payments |
| 12 | **Vendors & vendor portal** | CORE | vendor master, ledger (opening balance, date filter, exports), portal login, balances synced with books | `services/vendorAccount.js`, `routes/vendorPortal.js` | `Vendors`, `VendorPortal` | vendors, users.vendor_id |
| 13 | **Tenders & bids** | KIT | BOQ tender, category/all visibility, side-by-side bid comparison, award | `routes/tenders.js`, `services/tenders.js` | `Tenders.jsx` | tenders, tender_bids |
| 14 | **CRM** | CORE | contacts/leads with configurable stages, activities, notes, tasks, documents, smart lists (AND/OR), kanban pipeline, custom fields, duplicate-safe ingestion, round-robin assignment | `routes/crm.js`, `filters.js` | `Contacts`, `ContactWorkspace`, `CrmPages`, `FilterPanel` | contacts, activities, notes, tasks, smart_lists |
| 15 | **Sales agents, commissions, goals & rewards** | KIT | rule-based commission (property > project > type > general; %, fixed, tiers), approval → payable → paid, agent ledger; daily/monthly goals, points, streaks, badges, leaderboard, 9am/2pm/6pm nudges | `services/{commissions,goals}.js`, `routes/{agents,goals}.js` | `CrmPages (Agents, Commissions)`, `Goals` | commission_rules, commissions, commission_payments, agent_goals |
| 16 | **HRM** | CORE | employees, documents, attendance (one-tap), leave workflow (HR or reporting manager), payroll incl. commission settlement, holidays, recruitment, reports | `services/hr.js`, `routes/hrm.js` | `Hrm.jsx`, `HrExtras` | employees, payroll, attendance, leaves, holidays, recruitment |
| 17 | **My Space (self-service)** | CORE | profile, attendance calendar, leave, payslips (when paid), tasks, security | `routes/staff.js` | `MySpace.jsx`, `Security` | (own rows) |
| 18 | **Work tasks & assets** | KIT | assign tasks with status timeline; asset register + history + auto-registration from vouchers | `routes/staff.js`, `services/expenses.js` | `MySpace`, `HrExtras` | work_tasks, work_task_updates, assets, asset_history |
| 19 | **Documents** | CORE | one polymorphic documents table, category, portal visibility, authenticated download | `routes/misc.js` | `DocumentsPanel` | documents |
| 20 | **Reports & exports** | CORE | grouped report catalogue, date presets, csv/xlsx/pdf for every list | `routes/reports.js`, `helpers.js sendTable`, `services/pdf.js` | `Reports.jsx`, `Charts` | (derived) |
| 21 | **Assistant** | KIT | intent classifier over live data, permission-aware, PDF export, `chat_log` | `services/assistant.js`, `routes/assistant.js` | `Assistant.jsx` | chat_log |
| 22 | **Customer portal** | CORE (rename per vertical) | dashboard, own records, ledger PDF/Excel/CSV, pay-now, notifications, documents, offers, journey tracker | `routes/portal.js`, `services/{payments,schedule}.js` | `Portal.jsx`, `Journey`, `LedgerViewer` | users.contact_id |
| 23 | **Public website + CMS + SEO + chatbot** | KIT | block pages, themes, blog with scoring, calculators, enquiry→CRM, sitemap/robots, knowledge-bank bot | `routes/{site,siteAdmin,seo,public}.js`, `services/{website,siteDefaults,siteValidate,bot,richText}.js`, `shared/*` | `site/*`, `WebsiteEditor`, `SeoManager`, `BotKnowledge`, `BuilderCanvas`, `StyleEditor` | settings.site_config, site_pages, site_posts, bot_kb |
| 24 | **Content calendar** | KIT | plan social posts, creative file, platform hand-off (Web Share on phone) | `routes/content.js` | `Content.jsx` | content_posts, social_accounts |
| 25 | **Multi-tenancy, plans, billing, platform console** | KIT (SaaS products only) | see 13-tenancy-rbac-security.md | `platform.js`, `routes/{platform,platformAdmin,billing}.js`, `services/platform*.js`, `plans*.js`, `stripe.js`, `billing.js`, `subscriptions.js`, `backup.js`, `maintenance.js` | `PlatformConsole`, `pages/platform/*`, `Landing`, `Billing` | platform.db |
| 26 | **PWA / mobile / offline** | CORE | installable app, bottom tabs, offline queue, Capacitor wrapper | — | `public/sw.js`, `OfflineBar`, `mobile/` | — |
| 27 | **Properties / inventory** | VERTICAL | listings with media, status machine, approval workflow, registration/file numbers, file status | `routes/{properties,listings}.js` | `Properties`, `PropertyForm`, `PropertyDetail`, `ListingApprovals`, `PlotMap` | properties, media |
| 28 | **Projects & development tracking** | VERTICAL (pattern: project cost centre) | development % items, updates with video, units, financials, construction projects, date-driven schedule (Gantt, forecast, delay alerts) | `routes/projects.js`, `services/{projectFinance,schedule}.js` | `Projects.jsx`, `Schedule` | projects, dev_items, dev_updates, project_tasks |
| 29 | **Sales & installment plans, bundles, construction contracts** | VERTICAL (pattern: contract with schedule) | plan generator (booking/advance/installments/balloons), bundle two contracts under one plan, split receipts | `services/sales.js`, `shared/installmentPlan.js`, `routes/sales.js` | `Sales.jsx`, `SaleBits`, `Customers`, `Customer360` | sales, installments, sale_bundles, receipt_sales |
| 30 | **Customers (360, statement, lookup)** | CORE-ish | customer code, search by phone/CNIC/ID, 360 timeline + next best action, statements | `services/customers.js`, `routes/insights.js` | `Customer360`, `Customers`, `CustomerRecordLookup` | contacts |

## Choosing modules for a new client

1. Always: 1–8, 11, 14, 16, 17, 19, 20, 26 (+ 6/7 UI layer).
2. If they invoice customers: 9, 22, 30 (+10 if bank-transfer heavy like Pakistan).
3. If they buy from vendors: 12 (+13 for contract works).
4. If they have field sales: 15, 21.
5. If SaaS: 25. If they need a public site: 23 (+24 for marketing teams).
6. Vertical modules (27–29): replace with the client's equivalent *contract-with-schedule* and *inventory-with-status-machine* patterns; keep the accounting hooks identical.

## Vertical adaptation map (how to re-skin without touching the engine)

| Reference concept | Manufacturing | Retail/Distribution | Services/Agency | Clinic/School |
|---|---|---|---|---|
| Property (inventory item, status machine) | Product / batch | SKU / stock lot | Service package | Course / appointment slot |
| Project (cost centre) | Work order / plant | Branch / warehouse | Client project | Department / campus |
| Sale + installments | Sales order + payment terms | Invoice + credit terms | Retainer / milestone billing | Fee plan |
| Receipt allocation to installments | Receipt against invoices | same | same | Fee voucher |
| Contact (lead→customer) | Customer | Customer | Client | Patient / student |
| Commission | Rep commission | Salesman commission | Referral fee | — |
| Vendor + tender | Supplier + RFQ | Supplier | Subcontractor | Supplier |
| Plot map | Warehouse bin map | Shelf map | — | Room / seat map |
| Development % | Production stage % | — | Delivery % | Syllabus % |
