# 52 — Checklists & governance

## Definition of Done — a feature

- [ ] Module spec written (`templates/module-spec.md`) and approved
- [ ] Schema added to `schema.js` **and** `migrate()` (additive, idempotent); indexes for FKs/filters
- [ ] Service function(s) with `tx()`, validation messages in plain language, `audit()`/`activity()`/`notify()`
- [ ] Money? → posting row defined, `postJournal`, reconciliation test
- [ ] Route(s) with `can(module, action)`, row scope, list envelope, export switch
- [ ] Permission added to `MODULES`, role grants in `seed.js`, `upgradePermissions()` for existing tenants
- [ ] UI: NAV entry, `G()` route guard, `useTable`/`DataTable`/`ResourcePage`, Empty/Loading/Error, undo on delete
- [ ] Today-feed card or notification type (`NOTE_META`) for pending work
- [ ] Tests: happy path + permission denied + other-user isolation + (money) invariants
- [ ] Docs: ARCHITECTURE section, README note, `.env.example` if new config
- [ ] CI green (server tests + client build)

## Design QA (per screen)

- [ ] Light + dark; all 6 accents; density compact/spacious; text size Larger
- [ ] ≤ 800px phone layout: no horizontal page scroll, tap targets ≥ 40px, bottom tab bar doesn't cover actions
- [ ] Keyboard: reachable, Enter/Esc work, focus visible
- [ ] Contrast: nothing below AA for essential text (use `--muted` not `--faint` for required reading)
- [ ] Numbers tabular & right-aligned; money via `format.js`
- [ ] Reduced motion honoured
- [ ] Print/PDF preview white in dark mode
- [ ] No hex colours in the component; no inline font sizes under 12px

## Security review (per release)

- [ ] Every new route has `can()`; portal routes use `requirePortal/requireVendor` and `req.user` ids
- [ ] No `SELECT *` in public/portal responses; projections reviewed
- [ ] Uploads: ext + MIME + size; stored under tenant folder; downloaded via authenticated route
- [ ] Rate limits on new public/anonymous endpoints; webhook signatures/keys verified; replay-safe
- [ ] CSRF header expected by every client call (`api.js` only)
- [ ] Secrets only via env / encrypted settings; `.env*` in `.gitignore`
- [ ] Demo data and demo password absent from production tenant
- [ ] Tenant isolation test still passes (multi-tenant builds)
- [ ] Backup ran and a restore was rehearsed

## Release / handover

- [ ] `npm test` and `npm run build` clean from a fresh clone
- [ ] `ERP_DEMO` setting correct for the environment; first admin created via env, password rotated
- [ ] `JWT_SECRET` and `ERP_SECRETS_KEY` set and backed up **separately** from DB backups
- [ ] HTTPS in front; `NODE_ENV=production` (Secure cookies, HSTS)
- [ ] Known-limits section reviewed with the client

## Governance of this knowledge base

1. **The reference app is read-only for client work.** Improvements discovered during a client build are proposed back by editing the knowledge base files (and, if warranted, the reference) in a dedicated PR titled `kb: …`.
2. **Every standard cites its source file.** A rule with no source in the reference must be labelled *factory-added* (as done in `design-tokens.css`).
3. **Re-audit trigger:** run `node erp-factory/tools/check-token-drift.mjs` in CI of this repo; if it fails, the reference changed — update `design/` and `tokens/` in the same PR.
4. **Versioning:** bump `erp-factory/VERSION` (semver) when standards change; client projects record the factory version they were built from in `DECISIONS.md`.
5. **Deviations** are allowed; undocumented deviations are not.
6. **Known reference defects** (listed in `00-AUDIT-SUMMARY.md`) are not part of the standard — new builds must fix, not copy, them.
