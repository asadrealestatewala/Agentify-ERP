# 05 — Interactions, motion, feedback

Everything here is implemented in the reference. File refs are under `agentify-erp/client/src/`.

## Motion rules

| Rule | Value |
|---|---|
| Respect `prefers-reduced-motion` | All decorative motion lives inside `@media (prefers-reduced-motion: no-preference)` (styles2.css); `celebrate()` returns early when reduced motion is set |
| Page enter | `.content > *` fade-in `.22s ease-out backwards`; dashboard pane `.25s` |
| Hover transitions | `background/border/box-shadow/transform/color .15s` on `.card .btn .k-card .chip .stat .nav-item .opt .search-item` |
| Hover lift | `a.stat`, `.k-card`, `.plot`, `.today-card`, `.quick a`, `.tender-card`: `translateY(-2px)` + soft shadow |
| Press | `.btn:active { transform: scale(.97) }` |
| Modal | `pop .16s` (scale .96 + 6px rise), overlay `fade .15s`; Drawer `slidein .18s` (40px) |
| Toast | `slidein .2s cubic-bezier(.2,.9,.3,1.2)` (slight overshoot) |
| Row flash after inline save | `flash 1.4s` – primary 25% tint fading to transparent |
| Skeleton | shimmer gradient `1.2s linear infinite` on `--grey-bg` |
| Bell | `ring .9s` rotating keyframes when a new notification arrives |
| Attention glow ("going cold" lead) | amber `glow 2.2s` pulsing box-shadow; "won" card `wonpulse .9s` green ring |
| Confetti | `celebrate()` 70 pieces, 3.8 s, dependency-free; fired on milestones (sale closed, goal reached) |
| Sidebar collapse | `width .15s`; mobile drawer `transform .18s` |

## Feedback patterns (what the UI says, and when)

1. **Loading** → skeleton (`<Loading rows>`), never a bare spinner for page/table loads. Spinner only for in-button/tiny async.
2. **Empty** → `<Empty icon title hint action|to>`: 54px circular tinted icon, bold title, ≤380px hint, one primary CTA. Distinguish "no data yet" (CTA to create) from "no match" (hint to clear filters — `DataTable` default).
3. **Error** → inline `.alert.err` at top of the form/page (never `alert()`); toast `err` (6 s) for background failures.
4. **Success** → toast `ok` (3.2 s): "Contact saved". Money events also notify other users via the notification system.
5. **Destructive** → `ConfirmDialog` (danger style, optional mandatory *Reason*) **and then** an 8-second **Undo toast** (`useUndoDelete`) — "two safety nets". Voids never delete: they post reversing entries.
6. **Optimistic where safe** → undoable delete hides the row at once; pipeline stage moves; inline cell edits flash the row on success and toast the server's message on failure.
7. **Live** → notifications poll every 30 s + on tab focus; new unread → rich `toast.live` (max 2), bell animation, `(N)` in `document.title`.
8. **Offline** → pill bar at the top: "You're offline — N actions saved on this device" (amber `#92400e`) → "Syncing N…" (blue) → toast "Back online — N synced"; server rejections are reported, never silently retried.

## Keyboard & power-user layer

* **Ctrl/⌘+K command palette** (`CommandPalette.jsx`): groups *Suggested / Actions / Go to / Records*. Pages come from the same `NAV` array and are permission-filtered; actions are permission-gated; typing `receipt for ali` / `sale for ali` / `statement for ali` / `open ali` runs a record search and jumps into the form with the customer pre-selected (`/receipts/new?contact=ID`). Arrow keys, Enter, Esc; `↵` hint on the selected row; footer legend. Palette also toggles dark mode/density and signs out.
* **Global search** (top bar): debounced 200 ms, `GET /api/search?q=`, typed result chips (`contact`, `property`, `receipt`, `vendor`…), Enter opens first hit. Searches by name, CNIC/phone (normalised), customer code, registration no., file no.
* **Esc** closes every modal/drawer/popover; click-outside closes menus (`Menu`, column chooser, notification panel).
* Focus: inputs show a 3px ring `color-mix(primary 18%)`; sidebar/links keep visible focus (`focus-visible` on console). Modals set `role="dialog" aria-modal aria-label`.

## Tables (DataTable) — the most reused interaction surface

* Server-driven: `useTable(url, {limit, sort, dir, filters, viewsKey})` → debounced search (250 ms), page, sort, filters, `erp:data-changed` auto-reload; **`tableProps` spreads straight onto `<DataTable/>`**.
* Header: uppercase 12px, sortable columns show chevron; click toggles asc/desc.
* **Column chooser** (list icon in the last header cell) — persisted per `tableId` in `localStorage['cols:<id>']`.
* **Saved views** (`ViewsBar`): named search+filter+sort presets as chips, persisted per `viewsKey`; "+ Save this view" appears only when something is filtered.
* **Inline editing**: `column.edit = {type:'text|number|date|select', options, can, save(row,val)}` — dashed outline on hover, Enter commits, Esc cancels, blur commits, row flashes on success.
* **Hover quick actions** (`quickActions`): round 28px icon buttons that fade in on row hover/focus (always visible on touch); WhatsApp button turns green on hover.
* **Row menu** (`rowActions`): ⋯ → popover with Edit / Delete (danger red).
* Bulk: `selectable` + `selected` + `onSelect`; select-all in header; selected rows get `--primary-l`.
* Footer totals via `footer` (sticky bold with 2px top rule). Pager: "1–25 of 312", Prev/Next, "page / pages".
* Numeric columns right-aligned + tabular; columns whose key matches `date|due|no|code|at|phone|cnic|…` are `white-space: nowrap` automatically.
* Export: `<ExportMenu>` → Excel / PDF / CSV (server generated, same filters) + "Print this page". Gated by `module:export`.

## Domain-specific interactions worth reusing as patterns

| Pattern | Where | Idea to reuse |
|---|---|---|
| **Today feed / Needs attention** | `TodayFeed.jsx`, `GET /api/insights/today` | Role-aware cards built from live queries; every card deep-links to the *already filtered* screen; hot ones red. |
| **Next Best Action** | `Customer360` | Single banner chosen by a priority ladder (overdue → file status → due soon → missing ID → idle). |
| **Customer 360 timeline** | `Customer360.jsx`, `.tl360` | One chronological stream of different entity types with coloured dot per type; future items dashed. |
| **Plot map** | `PlotMap.jsx` | Entity grid as coloured tiles by status, grouped by block, dim non-matching, side panel with quick actions. Generalises to any inventory (rooms, stock bins, seats). |
| **Kanban pipeline** | `CrmPages.jsx Pipeline` | Native drag-and-drop, column sums, "going cold" glow, undoable stage move, confetti on win. |
| **Journey tracker + payment calendar** | `Journey.jsx` | Portal-side progress for the customer: done (green) / now (primary ring) / future steps. |
| **Live document preview** | `VoucherPreview.jsx`, `.form-split` | Form on the left, the document as it will print on the right (sticky). |
| **WhatsApp hand-off** | `WhatsApp.jsx` | `wa.me` deep links with templated messages; native share sheet with PDF on phones. |
| **Gamification** | `Goals.jsx` | Rings, streaks, points, badges, leaderboard — all derived from queries, nothing stored. |
| **Greeting hero** | `Dashboard.jsx Hero` | Time-aware greeting, one-sentence attention summary, 3 stat pills linking to filtered lists, date-range select inside the hero. |
| **Getting-started checklist** | `Onboarding.jsx` | Collapsible, role-aware steps with strikethrough when done. |
| **Assistant** | `Assistant.jsx` + `services/assistant.js` | Intent-classified Q&A over live data, permission-checked, exportable to PDF; FAB bottom-right, full-screen on phones. |
| **Website live preview** | `WebsiteEditor.jsx` | Desktop/tablet/mobile frames (390px phone bezel), drag-to-reorder sections, per-device responsive style overrides. |

## Rules for new ERPs

1. Every list page = `useTable` + `DataTable` + `SearchBar` + `ExportMenu`; do not hand-roll tables.
2. Every delete = confirm → undo toast. Every irreversible financial action = confirm with reason, then reversal entry, never row deletion.
3. Every module gets a Today-feed card or Needs-attention entry for its pending work (approvals, overdue, due soon) — the dashboard is the work queue.
4. Provide the command palette on day one; register each new page by adding it to `NAV` (palette + sidebar come for free).
5. Anything an agent can do in the field (note, task, new lead, attendance) must work offline via the queue allow-list in `api.js`.
6. All motion respects reduced-motion; nothing animates longer than 0.3 s except skeleton/glow/ring loops.
