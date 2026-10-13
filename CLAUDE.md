# CLAUDE.md — ERP-Factory

This repository holds two things:

* `agentify-erp/` — **Agentify ERP**, the reference ERP application (Node 22 · Express · SQLite · React/Vite). **Read-only reference** for client work.
* `erp-factory/` — the **engineering knowledge base** extracted from it: design system, architecture, data/accounting rules, sync patterns, module catalog, standards, playbook, tokens, templates, tooling.

This is not model training. Claude has no memory between sessions; **these files are the memory**. Apply them.

## Always, before writing code for a new or existing ERP

1. Read `erp-factory/README.md` (map) and the section that matches the task:
   * UI / CSS / components → `erp-factory/design/*` + `erp-factory/tokens/design-tokens.css`
   * Backend, schema, security → `erp-factory/architecture/*`, `erp-factory/data/*`
   * Integrations / offline / webhooks → `erp-factory/sync/30-*.md`
   * Choosing modules or re-skinning for another industry → `erp-factory/modules/40-*.md`
   * Starting a new client ERP → `erp-factory/standards/51-new-erp-build-playbook.md`, then `templates/new-erp-brief.md`
2. Prefer **copying and adapting** the reference implementation (paths are listed in the docs) over re-inventing it.
3. If docs and code disagree, the code in `agentify-erp/` wins — fix the docs, run `node erp-factory/tools/check-token-drift.mjs`.

## Non-negotiables (full list: `erp-factory/standards/50-engineering-standards.md`)

* Layering: route → service → db. Multi-statement writes in `tx()`. Shared algorithms in `shared/`.
* **Money is integer whole units; every financial event is a balanced journal via `postJournal`; void/reverse, never delete or edit.** Tests must reconcile sub-ledgers to control accounts.
* Permissions enforced on the server (`can(module, action)`) and mirrored in the UI; portal/own-scope ids come from `req.user`, never from the client.
* UI uses **CSS variables only** (`tokens/design-tokens.css`), keeps the accent/theme/density system, and every screen has loading, empty, error, dark-mode, ≤800px and keyboard behaviour. Money/dates only via `format.js`.
* Lists = `useTable` + `DataTable`; master screens = `ResourcePage`; destructive actions = confirm + 8-second undo.
* Every mutation is audited; every pending-work item feeds the Today feed / notifications.
* Be honest in README "Known limits". Never ship demo data or demo passwords to a client's production tenant.

## Commands (reference app)

```bash
cd agentify-erp
npm run install:all && npm test            # 122 e2e tests, Node >= 22
npm run build && npm start                 # http://localhost:4000
cd .. && node erp-factory/tools/check-token-drift.mjs     # design tokens vs reference
```

## Changing the knowledge base

Edit files in `erp-factory/` in a dedicated commit (`kb: …`), bump `erp-factory/VERSION` when standards change, keep every rule traceable to a source file (label invented rules *factory-added*), and keep `00-AUDIT-SUMMARY.md` known-defects list current. Do not modify `agentify-erp/` as part of a client build.
