# 51 — Playbook: building a new ERP from the knowledge base

This is the procedure Claude Code follows when asked "build an ERP for <company/industry>". The reference app is committed at `agentify-erp/` in this repository — read it, copy from it, but never edit it as part of a client build (see 52-governance).

## Phase 0 — Intake (30 min, produces `docs/BRIEF.md` in the new project)

Fill `erp-factory/templates/new-erp-brief.md`. Minimum answers: company & industry · currency/timezone/locale · single-company vs multi-tenant SaaS · identity classes (staff, customers, vendors, agents…) · modules wanted (pick from `modules/40`) · money flows (what is sold, how it's paid, what is bought) · approvals (who approves what) · integrations (website, bank/wallet, WhatsApp, email, payment gateway) · brand (name, logo, accent colour, document header) · compliance (ID numbers like CNIC/NTN/GST, tax lines) · data to import.
**If an answer is unknown, write the assumption in the brief and proceed — do not block.**

## Phase 1 — Domain model (before any code)

1. Map the client's nouns to the reference (vertical adaptation table in `modules/40`).
2. Draw the ERD in the reference's text style (`data/20`), mark which tables are copied unchanged (CORE) vs new.
3. Write the **posting table** for every money event (Dr/Cr + control accounts) in the reference's format (`data/21`). Get this reviewed by the user — it is the contract with their accountant.
4. List roles × modules × actions and which roles are `own_scope`.
5. List state machines for each document.

Output: `docs/ARCHITECTURE.md` skeleton (sections 1–5 of the reference's file).

## Phase 2 — Scaffold (copy, don't rewrite)

Start a new repo (or a new folder inside a client repo) and copy **verbatim**, then rename strings:

| Copy as-is | Adapt | Delete / replace |
|---|---|---|
| `server/src/{db,util,context,rbac,audit,filters,env}.js` | `schema.js` (keep core tables, add vertical ones), `seed.js` (roles, lookups, COA leaves, settings, demo), `index.js` (mount only needed routers) | real-estate routes/services (`properties, projects, sales, listings, website sync` unless needed) |
| `server/src/routes/{helpers,auth,settings,misc,reports,dashboard,insights}.js` | permission module list in `rbac.js MODULES` | demo copy mentioning "plots/projects" |
| `server/src/services/{accounting,pdf,mailer,push,reminders,accessLinks,totp,backup,maintenance}.js` | `payments.js`, `expenses.js`, `commissions.js` (if kept) | `projectFinance`, `schedule` (unless construction-like) |
| `server/src/platform.js` + `routes/platform*.js` + `services/platform*.js` (**only for SaaS**) | plan limits in `plans.js` | all of it for single-company builds |
| `client/src/{api,context,format,theme,brand,celebrate,printPdf}.js(x)` | `format.js` locale/currency | `supabase.js` if unused |
| `client/src/components/*` (everything except site/builder/domain widgets) | `Layout.jsx NAV`, `Icon.jsx` additions, `NOTE_META`, `TILE`, `TONES` | `PlotMap`, `Journey`, `BuilderCanvas`, `StyleEditor`, `SeoAssistant` unless needed |
| `client/src/styles*.css` → consolidate into `tokens.css` (from `erp-factory/tokens`) + `app.css` | accent default + brand | |
| `client/public/{sw.js,manifest.webmanifest}` | name, colours, icons | |
| `.github/workflows/ci.yml`, root `package.json` scripts, `.env.example`, `.gitignore` | variable names | |
| `server/test/{tenancy,hardening,onboarding,console}.test.js` patterns | acceptance test rewritten for the new happy path | |

After scaffolding: `npm run install:all && npm test && npm run build` must be green **before** any feature work.

## Phase 3 — Vertical slice first

Build **one end-to-end path** through the real money flow (e.g. quote → order → invoice → receipt → ledger → customer view) using the reference's patterns, with tests asserting the ledger invariants. Demo it. Only then widen to remaining modules.

Order of module work (shortest path to a demo-able, auditable system):
1. Seed: roles, lookups, COA, settings, first admin → 2. CRM/contacts (or Customers) → 3. Core document (sale/order) + schedule → 4. Receipts + allocation + journal → 5. Expense vouchers + vendors → 6. Dashboard hero/today feed → 7. Reports + exports → 8. HR (if wanted) → 9. Portal(s) → 10. Website/integrations → 11. SaaS layer (if wanted) → 12. Hardening, docs, demo data.

## Phase 4 — UI pass using the design kit

For every screen: `PageHead` + `Card`/`DataTable` + `Empty/Loading/Error` + dark mode + 6 accents + ≤800px + keyboard. Add the module to `NAV`, command palette comes free. Run `node erp-factory/tools/check-token-drift.mjs --target <new-project>/client/src/tokens.css` (see tools) to confirm tokens weren't forked.

## Phase 5 — Hardening checklist (run before every client demo and release)

See `standards/52-checklists.md`.

## Phase 6 — Handover package

`README.md` (run + logins + conventions + known limits) · `ARCHITECTURE.md` · `.env.example` · backup/restore note · role matrix · screenshots · test report · `DECISIONS.md` (every deviation from the factory standards with reason).

## Decision guides

**Single-company or multi-tenant?** One client's own ERP → single (leave `ERP_BASE_DOMAIN` empty; zero SaaS code needed). A product you resell → multi-tenant, database-per-tenant, include plans/billing/console.

**SQLite or Postgres?** SQLite+WAL is the factory default: single VM, ≤ ~50 concurrent users per tenant, trivial backup (`VACUUM INTO`). Choose Postgres only when the client demands HA/managed DB, > a few hundred tenants, or heavy reporting concurrency — and budget the async rewrite of `db.js` call sites (not done in the reference).

**Build the website module?** Only if the client wants a CMS-driven public site fed by ERP data. Otherwise offer the keyed `/api/public` API for their existing site.

**Localisation:** change `format.js` (locale, currency), `util.js TZ`, `CurrencyInput` prefix, ID-number labels (CNIC → client's national ID), phone normalisation in `customers.js` and `WhatsApp.jsx waNumber`, tax lines on vouchers, and PDF letterhead. Keep integer money; for currencies with minor units either store minor units (×100) consistently or keep whole units and document rounding.

**RTL / Urdu / Arabic:** not implemented in the reference. If required: `dir` on `<html>`, logical CSS properties (`margin-inline-*`, `inset-inline-*`), mirror chevrons/sidebar, and PDFKit needs a shaping font. Budget it as its own phase.

## Prompts that work (paste into Claude Code)

* *Kickoff:* "Read `CLAUDE.md` and `erp-factory/README.md`. Run Phase 0–1 for <client>: ask me only the questions in `templates/new-erp-brief.md` that you cannot assume, then produce the ERD, posting table and role matrix for approval."
* *Scaffold:* "Execute Phase 2 of `erp-factory/standards/51-new-erp-build-playbook.md` into `./<project>/`. Keep tests green at each step."
* *Module:* "Add module <X> following `templates/module-spec.md`; reuse `ResourcePage`/`useTable`/`postJournal`; update NAV, permissions, today-feed, notifications, tests and docs."
* *Audit:* "Review the diff against `erp-factory/standards/50-engineering-standards.md` and `52-checklists.md`; list violations by severity."
