# 06 — Component catalog

Paths relative to `agentify-erp/client/src/`. **Reuse tier:** 🟢 copy unchanged into every ERP · 🟡 copy and adapt vocabulary · 🔴 domain-specific (real estate), use only as a pattern.

## A. Foundation — `components/ui.jsx` 🟢 (268 lines, copy whole file)

| Export | Contract | Visual |
|---|---|---|
| `Card({title, actions, flush, className})` | section with optional header row | white, 16px radius, 1px border, soft shadow; header 14×18 with bottom rule |
| `Stat({label, value, sub, to, tone, icon})` | KPI tile; `to` makes it a `Link` | pastel `ic-tile sm` + label (600), 24px/700 tabular value, 12px sub |
| `PageHead({title, sub, crumbs, children})` | title block + right action row | h1 22px/700 |
| `StatusBadge({status, label?, tone?})` | pill with dot; tone from `TONES` map | see 02-color-system |
| `StagePill({name, color})` | data-coloured pill (12% tint) | for configurable stages |
| `Modal({title, size:''\|sm\|lg\|xl, footer, closeOnOverlay})` | portal to `<body>`, Esc closes, `role=dialog` | 20px radius, `pop` animation; sizes 420/560/820/1040 |
| `Drawer` | right-docked panel, 560/760px | slides in |
| `ConfirmDialog({message, danger, reason, onConfirm})` | `reason` makes a text reason mandatory; busy lock | modal sm |
| `Tabs({tabs:[{key,label,count}], value, onChange})` | `role=tablist`, active underline in primary | |
| `Field({label, required, hint, error})` | label 13px/700, red `*`, hint/ error line | |
| `TextInput`, `Select({options, allowEmpty, placeholder})`, `Check`, `Toggle` (switch 38×22), `ChipSelect({multi})`, `TagInput` (Enter/comma adds) | controlled via `onChange(value)` (not event) | |
| `CurrencyInput({prefix='PKR'})` | whole-number, thousands separators, emits `Number\|''` | addon + `.mono` |
| `DateRangeFilter({value:{range,from,to}})` | preset select + custom from/to | presets in `format.js DATE_PRESETS` |
| `Menu({trigger, align})` | click-outside popover | 8px radius, shadow-lg |
| `ProgressBar({value, tone})` | 8px track, clamps 0–100 | |
| `Loading({rows})`, `Spinner`, `Empty({icon,title,hint,action,to})`, `ErrorBox`, `Avatar`, `Money`, `KV`, `LedgerSummary`, `BackLink`, `DemoChip` | | |

## B. Data layer — `components/DataTable.jsx` 🟢

`useTable`, `ViewsBar`, `SearchBar`, `ExportMenu`, default `DataTable` — behaviour in 05-interactions. Column spec: `{key, label, render?, num?, sortKey?, width?, hidden?, edit?}`.

## C. Config-driven CRUD — `components/ResourcePage.jsx` 🟢

`ResourcePage({title, endpoint, module, columns, fields, defaults, filters, filterUI, rowLink, noun, rowActions, transformSave, canDeleteRow, exportName, embedded, tableId, ...})` gives a complete master-data screen (search, table, create/edit modal, delete with undo, permission-gated buttons, export) from a **declarative spec**. `FormModal` and `FieldInput` are exported for custom flows. Field types: `text(default) textarea select money bool tags number date color password activity`, with `lookup:'<lookup type>'` to bind a select to the lookups table, `showIf(form)`, `required`, `hint`, `full`.
**Factory use:** ≥ 60% of settings/master screens in a new ERP should be ~15 lines of `ResourcePage` config.

## D. Shell — 🟢

| File | Notes |
|---|---|
| `Layout.jsx` | `NAV` array + `Sidebar`, `GlobalSearch`, `MobileTabs`, palette wiring. Replace `NAV` contents only. |
| `Appearance.jsx`, `../theme.js` | accent/theme/density popover |
| `CommandPalette.jsx` | Ctrl+K |
| `Notifications.jsx` | bell + panel + full page + `NOTE_META` type→icon/tone/group map |
| `OfflineBar.jsx`, `Push.jsx` | offline queue status; service-worker registration + push toggle |
| `Assistant.jsx` | floating data assistant (needs `services/assistant.js` intents) |
| `TodayFeed.jsx`, `Onboarding.jsx` | work-queue cards, first-run checklist |
| `Icon.jsx` | 1 component, 71 inline-SVG path strings in a map `P` (24×24 viewBox, unknown names fall back to `file`); `Icon({name,size=16,stroke=1.8})`, `fill:none; stroke:currentColor; round caps/joins`. Add icons by adding a path to `P` — no icon library dependency. |

## E. Visualisation — `components/Charts.jsx` 🟢

Recharts wrappers: `BarsChart({data,x,series,stacked,isMonth,isMoney,height,layout})`, `LinesChart`, `DonutChart`. Rounded bars (`[8,8,2,2]`, max 30px), dashed `--border` grid, no axis lines, compact money ticks (`moneyShort`), legend circles at 11px, "No data for this period." empty state. Dark-mode text/grid fixes live in styles2.

## F. Documents & files — 🟡

* `Uploaders.jsx` — `FileUploader` (drag/drop zone), `ImageUploader` (drag-reorder thumbs, cover badge, delete), `DocumentsPanel({entityType, entityId, categories, portalToggle})` — **one documents table for every entity** with a "share with customer in portal" switch.
* `DocBrand.jsx` — `DocHeader/DocFooter({kind})` brand letterhead from settings; used by every printable screen.
* `VoucherPreview.jsx` — live paper preview rows/amount box/signature lines.
* `RichEditor.jsx` — contenteditable WYSIWYG (fonts, sizes, colours, callouts, images with size/alignment); output sanitised server-side by `services/richText.js`.
* `LedgerViewer.jsx`, `SaleBits.jsx` — ledger with date filter + server downloads; installment table, ledger summary.

## G. Pickers & lookups — 🟡

`CustomerPicker`, `PropertyPicker` (type-ahead, search by code/ID/phone/CNIC, can create inline, `onChange(id, record)`), `CustomerRecordLookup`, `PropertyStatusCheck`. Pattern: **every foreign key in a form is a type-ahead picker that can create the missing record in place** — no re-entry, no dead-end "go create it first".

## H. Collaboration & field — 🟡

`Timeline` (activity feed with prev → new), `Schedule.jsx` (Gantt, KPIs, warnings), `WhatsApp.jsx` (`waNumber`, `waLink`, `WA` templates, `WhatsAppButton`), `PayNow.jsx` (customer pay flow with proof), `Journey.jsx`, `TwoFactor.jsx` (TOTP set-up; `base` prop reuses it for staff and platform admins), `FilterPanel.jsx` (AND/OR rule builder → saved "smart lists").

## I. Website builder — 🔴/🟡

`StyleEditor.jsx` (per-device responsive controls driven by `shared/sectionStyle.js STYLE_FIELDS`), `BuilderCanvas.jsx` (iframe preview, postMessage), `SeoAssistant.jsx` (0–100 article score), `site/*` (public SPA with section renderers keyed by `SECTION_TYPES`). Reuse wholesale only for clients who need a CMS-driven public site.

## Class-name vocabulary (global CSS contracts)

Layout `app sidebar main topbar content page-head` · surfaces `card card-h card-b stat hero quick dtabs` · buttons `btn primary danger success sm ghost icon-btn qa chip` · forms `field input select textarea input-group form-grid check switch opt dropzone` · data `t th td num cell-main cell-sub toolbar pager table-wrap tabs tab` · feedback `alert err|warn|ok|info pill grey|green|amber|red|blue|purple tag toast skel empty` · overlays `overlay modal drawer menu colmenu palette notif-panel` · helpers `row stack grid g2 g3 g4 grow muted faint mono nowrap bold right center pos neg warn no-print`.
New components must be built from this vocabulary; adding a new top-level utility needs a note in `standards/`.

## Component quality bar (checklist used to accept a component)

- [ ] Only CSS variables, dark mode verified, 6 accents verified
- [ ] Keyboard: Tab order, Enter/Space activation, Esc closes, focus visible
- [ ] `aria-label` on icon-only buttons; `role` on dialogs/tabs/status
- [ ] Loading skeleton, empty state, error state all designed
- [ ] ≤ 800px layout checked; tap targets ≥ 40px
- [ ] Permission-gated actions hidden **and** enforced by the API
- [ ] No inline money/date formatting (uses `format.js`)
