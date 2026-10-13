---
name: erp-factory
description: Build or modify an ERP using the ERP-Factory knowledge base extracted from Agentify ERP — design system (typography, colours, accents, dark mode, components), architecture, accounting/posting rules, RBAC, multi-tenancy, sync patterns, module catalog and the new-ERP build playbook. Use whenever the task is to start a new ERP or client system, add an ERP module or screen, restyle an ERP UI, design its schema or accounting, or review ERP code against house standards.
---

# ERP-Factory skill

**Path rule:** every path below (`erp-factory/…`, `agentify-erp/…`) is relative to the directory that contains the `erp-factory/` folder — the repository root when this repo is open, or **this skill's own directory** when the skill is installed globally (`~/.claude/skills/erp-factory/`). Resolve them before reading. The knowledge base is the authority; do not rely on memory of it.

## Procedure

1. Read `erp-factory/README.md` (folder map) and `erp-factory/00-AUDIT-SUMMARY.md` (known defects of the reference — never copy those).
2. Classify the task and read **only** the matching files:

| Task | Read |
|---|---|
| New client ERP | `standards/51-new-erp-build-playbook.md` → `templates/new-erp-brief.md` → `modules/40-module-catalog.md` |
| New module / feature | `templates/module-spec.md`, `architecture/10`, `11`, `12`, `data/20`, (money) `data/21`, `standards/52-checklists.md` |
| UI / styling / component | `design/01…07`, `tokens/design-tokens.css` |
| Auth, roles, tenancy, billing | `architecture/13` |
| Integration, webhook, offline, push | `sync/30-sync-and-integration-patterns.md` |
| Review a diff | `standards/50-engineering-standards.md`, `standards/52-checklists.md` |

(all under `erp-factory/`)

3. Open the reference source named in the docs (`agentify-erp/…`) and **copy and adapt** rather than re-inventing.
4. Non-negotiables: route → service → db with `tx()`; money as integer units and every financial event a balanced journal via `postJournal` (void/reverse, never delete); server-side `can(module, action)` mirrored in the UI; CSS variables only with dark values; lists via `useTable` + `DataTable`; confirm + undo on destructive actions; audit every mutation.
5. For a new project, copy `erp-factory/tokens/design-tokens.css` into it and verify with `node erp-factory/tools/check-token-drift.mjs --target <project>/client/src/tokens.css`.
6. Before finishing, walk the Definition of Done in `standards/52-checklists.md`; report unmet items and run the project's tests/build, quoting failures verbatim.

## Output expectations

* State which factory files you applied and record every deliberate deviation in the project's `DECISIONS.md` (with the knowledge-base version from `erp-factory/VERSION`).
* Do not modify `agentify-erp/` as part of a client build.
