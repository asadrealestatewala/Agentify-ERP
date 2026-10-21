# 13 — Multi-tenancy, RBAC, security, billing

## A. Multi-tenancy (database-per-tenant)

| Aspect | Reference implementation |
|---|---|
| Isolation unit | **One SQLite file per company**: `data/tenants/<slug>/erp.db`, uploads in `uploads/tenants/<slug>/`. A control-plane DB `data/platform.db` lists tenants, plans, invoices, platform admins, audit |
| Routing | `<slug>.<ERP_BASE_DOMAIN>` or a verified `custom_domain` → `resolveTenant(req.hostname)`; `ERP_BASE_DOMAIN` unset ⇒ single-company mode (legacy install keeps its DB path) |
| Request scoping | `tenantContext` middleware → `withTenant(tenant, () => next())` → `AsyncLocalStorage {tenant, db}` (`context.js`). `db.js` exports `db` as a **Proxy** that resolves the current tenant's connection on every call, so routes/services never pass a tenant around |
| Gotcha solved | Stream callbacks (multer/busboy) drop ALS; `keepContext(next)` re-enters the store — wrapped inside `uploader()` |
| Token binding | JWT carries `tid`; `authenticate` rejects a token whose `tid` ≠ current tenant (`tenancy.test.js` proves it). MFA tokens likewise (`aud:'mfa'`, 5 min, no `tv`) |
| Per-tenant caches | account-code → id cache keyed by connection (`WeakMap`), timezone, currency, push keys, upload dir |
| Provisioning | `createTenant` → register row → create DB → `bootstrap()` (roles, lookups, chart of accounts, settings, first Super Admin) → `ensureSite()`; on any failure the half-made tenant is removed |
| Reserved slugs | www app api admin platform static assets cdn mail smtp support help docs blog status billing signup login auth dashboard portal site dev staging test |
| Lifecycle | `status active|suspended|cancelled`; suspended ⇒ 403 on tenant API. Backups snapshot every DB |
| Why not shared-schema | Hard isolation, per-company restore, per-company export, zero risk of a missing `WHERE tenant_id=?`. Cost: many files/connections; schema upgrades run per DB on first open (idempotent `migrate()`); no cross-tenant SQL (the console aggregates by iterating). Fine to several hundred tenants on one VM; beyond that move the engine to Postgres (schema mirror exists in `supabase/schema.sql`) |

**Factory default:** new multi-company products reuse `platform.js` + `context.js` + `db.js` unchanged. Single-company clients simply leave `ERP_BASE_DOMAIN` empty — same code, one DB.

## B. RBAC

* **Model:** `roles(name, own_scope, portal, is_system)` × `role_permissions(role_id, module, action)`. Modules in `rbac.js MODULES`: dashboard crm sales commissions properties projects customers payments accounting vendors hrm reports settings documents website content listings seo. Actions: `view create edit delete approve export print`.
* **Super Admin** bypasses (`isSuper`), session perms are `['*']`. `loadUser()` returns `perms: Set('module:action')`.
* **Server guards:** `can(module, action)` per route; `requireStaff/requirePortal/requireVendor` for identity class; `hasPerm(user, m, a)` for in-handler checks (e.g. extra `export`, `payments:create` when collecting booking money during a sale).
* **Row scope:** `own_scope` role flag (Sales Agent) → `ownerId(req)` returns the user id; every list/detail/aggregate in that module filters by it, and assistant/finance/HR intents are denied outright. Customer/vendor portals derive their scope id from `req.user` (never the request).
* **Identity classes are mutually exclusive:** staff cannot use portal endpoints, customers cannot reach staff or vendor endpoints, vendors only `/api/vendor/*`. Login endpoint enforces `portal` flag match ("Use the staff login for this account").
* **Seniority-based capabilities** are not roles: assigning work needs `hrm:create | crm:approve | accounting:approve | projects:create | Super Admin | has direct reports`; leave decisions need `hrm:approve` or being the reporting manager.
* **Role design (13 shipped roles):** Super Admin, Admin (all except settings:delete), Finance Manager, Sales Manager, Sales Agent (own_scope), HR Manager, Accounts Staff, Project Manager, Listing Manager, Website Manager, SEO Manager, Inventory Manager, Customer (portal), Vendor (portal). Roles/permissions are **editable data** (Settings → Roles & Permissions); `upgradePermissions()` in `seed.js` grants new modules to existing tenants on deploy.
* **UI mirroring:** `can()` hides menu items/buttons and `Guard` shows "No access"; never the only line of defence.
* **Permission naming rule:** one module per sidebar group; `module:action` where `approve` means "decide on someone else's submission" (vouchers, leave, commissions, listings, goals), `export`/`print` are separate so read-only roles can be denied bulk data egress.

## C. Authentication & session

* bcryptjs hash (cost 10), login by **email or phone**, `active=1` required.
* JWT (HS256) in **`erp_token` httpOnly, SameSite=Lax, Secure in production, 12 h** cookie; Bearer header accepted too (API clients). Payload `{uid, tv, tid}`; `tv` = `users.token_version` — bump it to sign a user out everywhere (used on password reset / role change).
* Login rate limit 10/min (`LOGIN_LIMIT`), global API limit 900/min, link endpoints limited; "Failed login" is audited.
* **2FA (TOTP, RFC 6238)** for staff and platform admins: secret encrypted at rest, replay-protected via `totp_last_step`, 8 single-use **hashed** recovery codes, two-step login (`mfa_required` + 5-minute `mfa_token`).
* One-time links (invite 7 d, reset 2 h, verify-email 3 d): only **SHA-256 hash of the token** stored; used once; reset replies identically whether or not the account exists; reset signs out everywhere.
* Workspace owner must confirm email before inviting people (stops signup form being used to mail strangers).
* Passwords: min 8 (workspace) / 10 (platform admin).
* Demo mode: `is_demo=1` rows + "DEMO" chips + ribbon; seeded password shown on login only when demo data exists. **Never ship demo data to a client production tenant** (`ERP_DEMO=0`).

## D. Web security checklist (all present in reference)

- [x] helmet CSP (script-src self only), HSTS in prod, `x-powered-by` off, `trust proxy 1`
- [x] CSRF: custom header `X-Requested-With: ERP` required on every cookie-authenticated mutation (Bearer and key-authenticated webhooks exempt)
- [x] Parameterised SQL everywhere; column whitelists on insert/update
- [x] Upload whitelist by extension **and** MIME; random filenames; size caps; per-tenant folders; **documents never statically served** (authenticated download endpoints, audited), only listing media under `/uploads/media` is public (`nosniff`, 7-day cache)
- [x] Public endpoints (`/api/site`, `/api/public`) return **published projections only** — never cost, commission, drafts, internal notes; honeypot field + rate limit on forms; optional `X-API-Key`
- [x] Webhook verification: HMAC-SHA256 over raw body (`req.rawBody` retained only for the billing webhook route); payment feed uses `X-Feed-Key`
- [x] HTML sanitising for rich text; React escaping for everything else
- [x] Secrets: `JWT_SECRET` env (or generated `.jwt-secret` file in data dir), `ERP_SECRETS_KEY` encrypts console-stored third-party keys
- [x] Audit: every mutation + failed logins + document uploads + role changes (voucher PDF downloads are audited too); platform audit table is **append-only enforced by SQLite triggers**; subscription history append-only too
- [ ] Gaps to improve in new builds: no per-account lockout (only IP rate limit); no password-complexity/breach check; no session list for tenant users (platform admins have `platform_sessions`); CSP allows `style 'unsafe-inline'`; single JWT secret for all tenants.

## E. Plans, entitlements & billing (SaaS builds only)

* `services/plans.js` + `plansStore.js` + `subscriptions.js`: Starter / Growth / Enterprise (placeholder prices) with limits `seats`, `projects`, `modules[]`; per-tenant `entitlements` JSON overrides.
* `billingGuard` (global, after auth): when the workspace is **locked** all non-GET requests except `/auth /billing /site /public` get **402 `billing_locked`**; module outside plan ⇒ 402 `module_not_in_plan`; creating a project beyond limit ⇒ error. Reads/exports always work — **nothing is ever deleted for non-payment**.
* Lifecycle: 14-day trial (Growth limits) → active; payment failure ⇒ 7-day grace; cancelled stays usable to period end; then read-only.
* Providers are pluggable: `manual` (operator records payments), `generic` (hosted links + HMAC webhook), **Stripe** (hosted Checkout + customer portal, signed webhook, no SDK), and **PK local methods** (Raast, Easypaisa, JazzCash, SadaPay, NayaPay, bank) via customer-reported transaction ID → operator approves → activation. Same transaction reference can back only one live submission (partial unique index).
* Platform console (`/platform`, `pages/PlatformConsole.jsx`, `pages/platform/*`, `routes/platformAdmin.js`): workspaces, plans, payments, reports/metrics (daily snapshot table for period comparison), notifications (deduped alerts with resolve), security (2FA, sessions, login history), backups, maintenance mode, errors, audit.
