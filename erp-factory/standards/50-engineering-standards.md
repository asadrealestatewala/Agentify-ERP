# 50 — Engineering standards (the rules every ERP-Factory build follows)

Each rule is traceable to the reference implementation. **MUST** = a build that violates it is not done. **SHOULD** = deviate only with a written reason in the project's `DECISIONS.md`.

## A. Architecture

1. **MUST** layer as route → service → data. Routes validate/authorise/shape; services own rules and transactions. (10-system-architecture)
2. **MUST** put any algorithm used by both browser and server in `shared/` as a pure module.
3. **MUST** expose every list with the envelope `{rows,total,page,limit}` and the same `?format=csv|xlsx|pdf` export switch.
4. **MUST** make every multi-statement write a service function wrapped in `tx()`.
5. **SHOULD** keep one concern per file; services ≤ ~300 lines, routes ≤ ~350 (reference: largest route `crm.js` 465, largest service `platformTenants.js` 512 — the outliers are exactly the ones that became hard to navigate).
6. **MUST NOT** add a dependency without a reason in `DECISIONS.md`. The reference runs on 11 server and 5 client dependencies; keep the list short (no ORM, no CSS framework, no state library).

## B. Data & money

7. **MUST** store money as integer whole units; never floats. Round once, at the edge of a calculation; give the remainder to the last row.
8. **MUST** store timestamps in the tenant timezone as `YYYY-MM-DD HH:MM:SS` text and resolve date presets server-side.
9. **MUST** route every financial event through the posting engine as a balanced journal; **MUST** reconcile sub-ledgers to control accounts in tests.
10. **MUST** void/reverse, never delete or edit, posted financial records.
11. **MUST** give every business document a human number from `nextNo()` and a unique index.
12. **MUST** add columns additively with defaults in `migrate()`; schema changes must be idempotent and run at start-up.
13. **SHOULD** drive dropdowns from `lookups` and extra fields from `custom_fields` before adding a column or a table.

## C. Security

14. **MUST** enforce permission on the server (`can()`), mirror it in the UI (`can()` / `Guard`). UI-only checks are bugs.
15. **MUST** derive customer/vendor/own-scope identifiers from `req.user`, never from the request.
16. **MUST** use parameterised SQL and column whitelists (`insert/update`).
17. **MUST** require the CSRF header on cookie-authenticated mutations; httpOnly SameSite cookie; 2FA available for staff.
18. **MUST** serve documents only through authenticated endpoints; whitelist uploads by extension **and** MIME; random filenames.
19. **MUST** project public data through whitelist functions; never `SELECT *` into a public response.
20. **MUST** audit every mutation (`audit()`) and every state change a customer can see (`activity()`).
21. **MUST** keep demo data out of production tenants (`ERP_DEMO=0`, `is_demo` purge path).

## D. UI/UX (see `design/`)

22. **MUST** use `tokens/design-tokens.css` variables only; every new variable has a dark value in the same commit.
23. **MUST** keep the accent system (`theme.js`) and verify all accents in light + dark.
24. **MUST** build lists with `useTable` + `DataTable`; master screens with `ResourcePage`; confirmations with `ConfirmDialog` + undo toast.
25. **MUST** provide loading skeleton, empty state, error state, ≤800px layout, keyboard path, and reduced-motion respect for every screen.
26. **MUST** format money/dates only via `format.js`.
27. **MUST** keep the dashboard as the work queue: every module contributes Today-feed entries and notification types.
28. **SHOULD** meet WCAG AA text contrast for all text a user must read (reference gaps listed in `02-color-system.md`).

## E. Testing & delivery

29. **MUST** have end-to-end tests that boot the real app on a temp DB (`node --test`), covering: the business happy path, RBAC + row isolation per identity class, CSRF, void/cancel integrity, tenant isolation (if multi-tenant), and the ledger invariants in `data/20`.
30. **MUST** run in CI on every PR: `npm --prefix server ci && npm --prefix server test && npm --prefix client ci && npm --prefix client run build` (Node 22).
31. **MUST** ship `.env.example` documenting every variable, `README.md` (run, roles/demo logins, conventions, known limits) and `ARCHITECTURE.md` (ERD, posting table, flows) updated in the same PR as the feature.
32. **MUST** write an honest "Known limits" section (reference does this: Postgres not wired, email/SMS placeholders, assistant is rule-based, single-process jobs). Clients hold you to what the README claims.
33. **SHOULD** seed a realistic demo dataset that exercises every module so the client can click through on day one, flagged `is_demo`.

## F. Code style (matches reference)

* ESM everywhere (`"type":"module"`), single quotes, semicolons, 2-space indent, arrow-function handlers, early `throw bad()` guard clauses, short descriptive names, JSDoc `/** */` one-liners on exported functions explaining *why/what rule*, inline `//` comments only for non-obvious constraints.
* Server responses & thrown messages are end-user sentences.
* No TypeScript in the reference; if a client mandates it, convert `shared/` and `services/` first.
* Client files: one page per file or a cohesive family (`CrmPages.jsx`); components in `components/`; no default-exported anonymous components; hooks `use*`.
* Git: small commits with imperative subject; feature docs updated alongside code.

## G. Performance & operability

34. **SHOULD** index every filter/join column; use partial unique indexes for optional codes.
35. **SHOULD** paginate everything (`limit ≤ 500`, exports uncapped by design but permission-gated).
36. **MUST** provide `/health`, scheduled backups with retention, and a documented restore.
37. **SHOULD** record background-job success/failure (`markJob`) and 500s (`recordError`) for the operator console.
38. **SHOULD** lazy-load route groups in new builds (reference ships one 1.5 MB-limit bundle).

## H. Documentation duties per module

Module spec (use `templates/module-spec.md`) → tables + relationships → posting rows (if money) → permissions → states → notifications → exports → tests → UI screens. If it isn't in the spec, it isn't in the build.
