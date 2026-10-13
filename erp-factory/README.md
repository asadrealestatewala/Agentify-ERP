# ERP-Factory knowledge base

Version-controlled engineering knowledge extracted from **Agentify ERP** (`../agentify-erp/`), the reference application. It is **not** a model fine-tune: it is plain files that Claude Code reads (via `../CLAUDE.md` and the `erp-factory` skill) so every new ERP starts from the same design language, architecture and standards.

> Naming note: this repository is currently called `Agentify-ERP` and holds both the reference app and this knowledge base. If the knowledge base moves to a dedicated `ERP-Factory` repo, copy the `erp-factory/` folder and `CLAUDE.md` + `.claude/skills/erp-factory/` as they are, and keep the reference app as a git submodule or a sibling checkout named `agentify-erp/` (the paths in the docs and in `tools/check-token-drift.mjs` assume that name).

## How Claude Code should use this

1. Read `../CLAUDE.md` (auto-loaded) → it points here.
2. **Before any UI work:** `design/01…06` and `tokens/design-tokens.css`.
3. **Before any backend/schema work:** `architecture/10–13`, `data/20–21`.
4. **Before starting a new client ERP:** `standards/51-new-erp-build-playbook.md`, then fill `templates/new-erp-brief.md`.
5. **Before calling anything done:** `standards/50` and `52`.
6. If the code in `../agentify-erp/` and these docs disagree, **the code wins** — fix the docs and run `node erp-factory/tools/check-token-drift.mjs`.

## Map

| Folder / file | What it holds |
|---|---|
| [`00-AUDIT-SUMMARY.md`](00-AUDIT-SUMMARY.md) | What was audited, how, headline numbers, **strengths, known defects in the reference, coverage limits** |
| [`design/01-typography.md`](design/01-typography.md) | Fonts, scale, weights, number/date/money formatting |
| [`design/02-color-system.md`](design/02-color-system.md) | Semantic colours, status mapping, pastel tiles, gradients, **computed contrast audit** |
| [`design/03-accent-and-theming.md`](design/03-accent-and-theming.md) | 6-accent system, light/dark/auto, density, text size, tenant branding vs user accent |
| [`design/04-layout-and-shape.md`](design/04-layout-and-shape.md) | App shell, page anatomy, grid, radius/elevation scale, z-index ladder, breakpoints |
| [`design/05-interactions-and-motion.md`](design/05-interactions-and-motion.md) | Motion rules, feedback states, command palette, DataTable behaviours, undo, signature patterns |
| [`design/06-component-catalog.md`](design/06-component-catalog.md) | Every shared component: contract, reuse tier, class vocabulary, acceptance bar |
| [`design/07-reference-screens.md`](design/07-reference-screens.md) | Screenshots rendered from the running reference (light, dark, violet accent, list, sign-in) + measured computed styles |
| [`architecture/10-system-architecture.md`](architecture/10-system-architecture.md) | Layers, repo layout, runtime facts, cross-cutting services, change-impact map |
| [`architecture/11-backend-patterns.md`](architecture/11-backend-patterns.md) | Canonical route/service, crud(), state machines, numbering, money/date rules, tests |
| [`architecture/12-frontend-patterns.md`](architecture/12-frontend-patterns.md) | Contexts, data hooks, routing/guards, page recipes, PWA/offline, a11y gaps |
| [`architecture/13-tenancy-rbac-security.md`](architecture/13-tenancy-rbac-security.md) | Database-per-tenant, RBAC, auth/2FA, web-security checklist, plans & billing |
| [`data/20-data-model-and-relationships.md`](data/20-data-model-and-relationships.md) | Conventions, full ERD, invariants, Postgres mirror status |
| [`data/21-accounting-and-transaction-flows.md`](data/21-accounting-and-transaction-flows.md) | Posting engine, chart of accounts, event→journal table, flows |
| [`sync/30-sync-and-integration-patterns.md`](sync/30-sync-and-integration-patterns.md) | Website sync, payment feed, offline queue, push, billing webhooks, Supabase status, backups |
| [`modules/40-module-catalog.md`](modules/40-module-catalog.md) | 30 modules: purpose, files, tables, **CORE/KIT/VERTICAL** class, vertical adaptation map |
| [`standards/50-engineering-standards.md`](standards/50-engineering-standards.md) | 38 numbered MUST/SHOULD rules |
| [`standards/51-new-erp-build-playbook.md`](standards/51-new-erp-build-playbook.md) | Phase 0–6 procedure, copy/adapt/delete scaffold table, decision guides, prompts |
| [`standards/52-checklists.md`](standards/52-checklists.md) | Definition of Done, design QA, security review, release, governance |
| [`tokens/design-tokens.css`](tokens/design-tokens.css) | Drop-in CSS variables (light + dark + density), resolved from the reference cascade |
| [`templates/`](templates/) | `new-erp-brief.md` (intake) and `module-spec.md` |
| [`tools/check-token-drift.mjs`](tools/check-token-drift.mjs) | Re-audit script: reference ⇄ tokens, or new project ⇄ tokens |
| [`VERSION`](VERSION) | Knowledge-base semver |

## Keeping it true

```bash
node erp-factory/tools/check-token-drift.mjs                       # reference vs tokens (run in CI)
node erp-factory/tools/check-token-drift.mjs --target <proj>/client/src/tokens.css   # a client build vs tokens
```
Rules for editing this folder are in `standards/52-checklists.md` → *Governance*.

## Install as a Claude skill (use it in every project)

The skill lives at `.claude/skills/erp-factory/SKILL.md`, so it is already active **inside this repository**. To use it in *any* project on your machine, build the self-contained bundle (skill + knowledge base + reference source, ~5 MB) and install it into your user skills folder:

```bash
node erp-factory/tools/package-skill.mjs --install     # builds dist/erp-factory and copies it to ~/.claude/skills/erp-factory
```

Manual alternatives: copy `dist/erp-factory/` (or the downloaded `erp-factory-skill.zip`, unzipped) to `~/.claude/skills/erp-factory/` (Windows: `%USERPROFILE%\.claude\skills\erp-factory\`), or into a single project's `.claude/skills/erp-factory/`. Restart Claude Code; it appears as `/erp-factory` and loads automatically for ERP tasks.

Re-run the packaging command after every knowledge-base change (bump `VERSION` first) and reinstall; `erp-factory/BUNDLE.txt` inside the installed copy records which version it holds. Use `--no-reference` for a docs-only bundle.
