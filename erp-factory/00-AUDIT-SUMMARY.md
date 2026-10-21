# 00 — Audit summary of the reference app (Agentify ERP)

Audit date: 2026-10-12 · Knowledge-base version: see `VERSION` · Reference commit: `6450a89` (initial commit of this repository).

## Method

1. Read the author's own documentation (`ARCHITECTURE.md`, `README.md`, `RUN-LOCALLY.md`).
2. Read the implementation: all three global stylesheets, `theme.js`, `brand.js`, `format.js`, `api.js`, `context.jsx`, the shared UI/table/shell/notification/palette/offline components, `App.jsx` routing, server bootstrap (`index.js`), data layer (`db.js`, `schema.js`), security (`rbac.js`, `audit.js`, `context.js`, `routes/auth.js`), helpers (`routes/helpers.js`), the posting engine and the main money services (`accounting`, `payments`, `sales` (plan generator), `expenses`, `commissions`, `claims`), tenancy (`platform.js`), website sync (`website.js`, `routes/public.js`, `routes/site.js` route list), backups, seed (roles, lookups, chart of accounts), test harness.
3. **Ran it:** installed dependencies, built the client, ran the full server test suite, started the app on a scratch database, drove it with headless Chromium in light/dark/violet, and read computed styles + CSS variables back from the live DOM (see `design/07-reference-screens.md`).
4. Computed WCAG contrast for the documented palette and the accent options.
5. Diffed `supabase/schema.sql` against `server/src/schema.js`.
6. Encoded the extracted tokens in `tokens/design-tokens.css` and built `tools/check-token-drift.mjs` (negative-tested: it fails when a token or accent is altered).

## Headline numbers (verified)

| Item | Value |
|---|---|
| Tests | **122 pass / 0 fail** (`npm test`, ~35 s, Node 22.22) — the reference README still says "37" |
| Client build | succeeds (Vite, ~25 s; single large chunk warning) |
| Server | 31 route files, 42 services, 65 tenant tables (+ 16 control-plane tables), 11 runtime dependencies |
| Client | 45 page files (40 + 5 console), 34 shared components, 5 runtime dependencies, 3 global CSS files (~870 lines) + 3 scoped CSS files (site, console, landing) |
| Design tokens | 102 tokens/accents verified against the reference cascade |
| Default look | Plus Jakarta Sans 14px/500, teal `#0e7c6b`, 16px cards, 236px light sidebar, 58px top bar |

## Strengths worth preserving

* **One posting engine** with balanced-journal enforcement and reconciliation tests; void = reversal.
* **Strict layering** and a handful of generic building blocks (`crud`, `sendTable`, `uploader`, `useTable`, `DataTable`, `ResourcePage`, `FormModal`) that make new modules small.
* **Tenant isolation through AsyncLocalStorage + a DB Proxy**, so business code is tenant-unaware; hard isolation by file; tokens bound to tenant.
* **Security defaults**: CSRF header, httpOnly cookies, CSP, parameterised SQL with column whitelists, authenticated documents, hashed one-time tokens, TOTP with replay protection, append-only audit triggers, rate limits.
* **Variable-driven design system** with a runtime accent picker, dark mode, density, text size — applied before first paint.
* **Role-aware work queue** (Today feed) and a command palette sourced from the same `NAV`.
* **Honest documentation**, including a "Known limits" section.
* **Behavioural tests that assert the books**, not just status codes.

## Known defects / debts in the reference (new builds must fix, not copy)

Verified at runtime or by computation unless marked *(by reading)*.

| # | Area | Defect | Evidence | Fix to apply in new builds |
|---|---|---|---|---|
| 1 | Colour | Sidebar footer role text `#b6c2d9` on white sidebar = **1.79:1** | computed colour `rgb(182,194,217)` read from the live DOM | use `--side-muted` |
| 2 | Colour | Dark mode: hero stat numbers render `#93c4bc`, not white (link-colour rule outranks `.hero-stat`) | live computed style | scope dark link rule or set `.hero-stat b` colour |
| 3 | Colour | Lead-stage pills use the raw data colour as text: 1.96–4.27:1 (all six seeded stages fail AA) | computed from seeded colours at 12% tint | darkened text mix; keep raw for dot/tint |
| 4 | Colour | Amber and green accent options: white button text = 3.19:1 / 3.30:1 | computed | use `primary-d` fill or dark text for those accents |
| 5 | Colour | `--faint` on `--bg` = 4.39:1 (AA needs 4.5) | computed | reserve for non-essential meta |
| 6 | Colour | Hard-coded blue survivors ignore the accent (assistant FAB shadow, undo-bar, offline sync bar, base focus ring) *(by reading)* | `styles.css`, `styles2.css` | `color-mix` on `--primary` |
| 7 | CSS | Three-layer cascade (`styles.css` → `styles2.css` → `styles3.css`) where later files override earlier ones; duplicate rules (`.alert.info`, `.btn`, `.pill`) and legacy `--navy*` | file reading | consolidate into tokens + one component sheet |
| 8 | A11y | `Modal`/`Drawer` have no focus trap or focus restore; no skip link; saved-view naming uses `window.prompt` *(by reading)* | `ui.jsx`, `DataTable.jsx` | add focus management; inline input |
| 9 | Data | Supabase mirror **stale**: 56 of 65 tables | diffed `CREATE TABLE` names | regenerate + CI name-set check |
| 10 | Docs | README test count (37) and `ARCHITECTURE.md` list of "shared components" drifted from code | ran suite | keep docs generated/checked |
| 11 | Sync | Offline queue has no idempotency key → possible duplicate note/task after a lost response *(by reading)* | `api.js flushQueue` | client-generated `Idempotency-Key` + server dedupe table |
| 12 | Ops | Background jobs run in-process on a timer; unsafe to scale horizontally without a lock *(by reading)* | `index.js` | job lock / queue |
| 13 | Security | No per-account lockout (IP rate limit only); single JWT secret across tenants; CSP allows inline styles *(by reading)* | `routes/auth.js`, `index.js` | add lockout/backoff, per-tenant signing key, nonce-based styles |
| 14 | Performance | One monolithic client bundle (`chunkSizeWarningLimit: 1500`) | build log | route-level `React.lazy` |
| 15 | i18n | No RTL, no translation layer; PKR/PKT/CNIC/+92 assumptions in several files | grep of `format.js`, `util.js`, `WhatsApp.jsx`, `customers.js` | follow the localisation list in playbook |
| 16 | Structure | Largest units (`seed.js` 524, `platformTenants.js` 512, `crm.js` 465 lines) mix concerns | line counts | split by concern in new builds |

## Coverage limits (what this audit did **not** do)

* Not every page was read line by line. The following are documented from the author's `ARCHITECTURE.md`/`README.md` plus file/route/signature inspection and are **not independently verified**: HR, schedule/Gantt, goals/gamification, assistant intents, tenders/bids, vendor account maths, billing/Stripe/PK-payment submission flows, platform console screens, website builder internals, mobile (Capacitor) wrapper, landing page, most Reports.
* Visual verification covered sign-in, dashboard (light/dark/violet) and one list screen at 1440×900; **phone layouts, portal, vendor portal, public website and print/PDF output were not rendered** in this audit — their documented behaviour comes from the CSS.
* No load, penetration or accessibility-tool testing was run; contrast figures are computed from CSS values, not from automated scanners.
* The reference runs only on SQLite; PostgreSQL behaviour is untested.

When you extend this knowledge base, upgrade a row from "documented" to "verified" by running the thing and recording how.
