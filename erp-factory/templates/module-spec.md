# Module spec — <Module name>

> One page per module, written **before** code. Mirrors how `ARCHITECTURE.md` documents the reference. Delete lines that don't apply, but answer each heading.

**Class:** CORE / KIT / VERTICAL · **Permission module key:** `<key>` (add to `rbac.js MODULES`) · **Owner role(s):**

## 1. Purpose
One paragraph: the user problem and who uses it.

## 2. Data
```
<table>(id, <no/code>, …, status, created_at …) ──< <child>(…)
```
- New tables / columns (+ `migrate()` additions):
- Lookups used / added (`lookups.type`):
- Custom-field entity? y/n
- Codes/numbers (`nextNo` key, prefix, width, unique index):

## 3. States
`draft → … → …` — who may move each transition, what each transition posts/notifies.

## 4. Money (skip if none)
| Event | Debit | Credit | Control account | Reversal rule |
|---|---|---|---|---|

Reconciliation invariant to test:

## 5. Permissions
| Role | view | create | edit | delete | approve | export | print | own_scope |
|---|---|---|---|---|---|---|---|---|

## 6. API
| Method + path | Permission | Notes (scope, filters, `?format=`) |
|---|---|---|

## 7. UI
- NAV group / entry / icon:
- Screens: list (`useTable` columns, filters, saved view key, quick actions, row actions), form (modal / page / split-preview), detail (tabs), dashboard card, report(s):
- Empty-state copy · confirmation + undo behaviour · Command-palette actions:

## 8. Notifications & feed
- Notification types (`NOTE_META` icon/tone/group) and recipients:
- Today-feed card (query, deep link, "hot" condition):
- Scheduled reminders (dedupe key):

## 9. Documents & exports
PDF voucher/report layout · export columns · portal visibility · WhatsApp template.

## 10. Integrations / sync
Webhook in/out, public projection, offline-queue eligibility (field actions only).

## 11. Tests
Happy path · permission denied · other-user isolation · state-machine guard · money invariants · tenant isolation (if SaaS).

## 12. Out of scope / known limits
