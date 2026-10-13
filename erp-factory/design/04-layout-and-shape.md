# 04 — Layout, spacing, radius, elevation, responsive

Source: `styles.css` (structure), `styles3.css` (calm re-skin), `Layout.jsx`.

## App shell

```
.app (flex, 100% height)
├─ aside.sidebar   236px (collapsed 60px; off-canvas 250px ≤860px)   white, 1px --side-border right edge
│   ├─ .brand      gradient mark 32px r12 + company name 13px/700 + "ERP" small
│   ├─ .collapse-btn  22px round primary, hangs on the right edge at top:72px (hidden ≤860px)
│   ├─ nav.nav     groups (collapsible, state in localStorage 'nav-open'); active = pill
│   └─ .side-foot  avatar + name/role + sign-out icon button
└─ .main (flex column)
    ├─ .demo-ribbon (only when demo data present)
    ├─ header.topbar  58px sticky z20: [menu-btn ≤860] [GlobalSearch pill 340px] [Ctrl K] ‥grow‥ [role link] [Appearance] [NotificationBell]
    ├─ main.content   padding 20×24×40 (14×12 phones); fade-in of direct children .22s
    ├─ Assistant FAB (bottom-right), MobileTabs (≤800px), OfflineBar, CommandPalette
```

Navigation rules (from `Layout.jsx NAV`):
* Two levels only: group → page. Group row = icon + label + caret; children indent 18px with 1px left rule.
* Entry shape: `[label, path, perm?]` where perm is `module` or `module:action`; default perm = group `module:view`. A group with zero permitted children disappears.
* Active item = **longest-prefix match** so `/properties/new` doesn't also light `/properties`. A group is "active" if any child is.
* Auto-opens the group containing the current route; sidebar click on a link closes the mobile drawer.
* The same `NAV` array feeds the command palette → one source of truth for "where can I go".
* Mobile bottom bar (≤800px) shows only 5 role-filtered tabs (Home, Goals, Leads, Tasks, Alerts).

## Page anatomy (every list/detail page)

```
<PageHead title sub crumbs>  ── right-aligned actions (primary button last)
[optional banner/alerts]
[Tabs or .top-tabs chips]
<Card flush>
   .toolbar:  SearchBar · filters · ‥grow‥ · ExportMenu
   (ViewsBar saved views)
   <DataTable/>   → .pager
</Card>
```
Detail pages: `BackLink` → `PageHead` → left summary column + right tabs (`.ws` 330px | 1fr | 46px tool rail; collapses to 1 column ≤800px). Forms: either `FormModal` (small masters), a full page of `.pf-section` blocks (220px title column | fields) with a sticky save bar, or `.form-split` (form | live voucher preview 340px+).

## Grid & spacing

* Utility layout classes (global, `styles.css`): `.row` (flex, gap 8), `.stack` (column, gap 12), `.grid` + `.g2/.g3/.g4` (gap 12; g3/g4 → 2 cols ≤900px; g2/g3 → 1 col ≤600px; **g4 stays 2-up on phones** (`!important` at ≤700px) so KPI tiles never stack to one per row), `.g-auto` (`minmax(200px,1fr)`), `.form-grid` (2 cols, gap 12×16; 1 col ≤700px; `.full` spans).
* Base rhythm is **4px-ish**: gaps 6/8/10/12/14/16/18; card padding 18 (header 14×18); page content 20×24; section gap 14–16.
* Every grid child gets `min-width: 0` (`.grid > *, .stack > *`) — prevents long text blowing out columns. Copy this rule.

## Radius scale (calm layer)

| Radius | Used by |
|---|---|
| 5–6px | menu items, small chips inside tables |
| 9px | `.btn.sm`, tile sm (10) |
| 11px | `.btn`, `.input/.select/.textarea` |
| 12px | alerts, `.ic-tile`, sidebar nav pill (10), brand mark |
| **16px** | **`.card`** (`--radius`), tabs container, notif/palette (14–18) |
| 20px | `.modal`; `.drawer` left corners |
| 22px | greeting `.hero` (18px on phones) |
| 24px | auth card |
| 999px | chips, tags, search, quick actions, filters, tab bar, pills |

## Elevation

* `--shadow`: `0 1px 2px rgba(18,64,54,.04), 0 6px 20px rgba(18,64,54,.05)` — cards, kanban cards, stat tiles. (Tinted green-black, not neutral grey.)
* `--shadow-lg`: `0 18px 48px rgba(18,64,54,.18)` — menus, popovers, modals, notification panel, toasts.
* Brand-tinted glows for emphasis: primary button `0 4px 14px color-mix(primary 30%)`, hero `0 14px 34px color-mix(primary 28%)`, active chip `0 3px 10px color-mix(primary 30%)`, auth card `0 24px 60px rgba(18,64,54,.14)`.
* Hover lift on interactive tiles: `translateY(-2px)` + `0 6px 18px rgba(16,24,40,.12)` (also today-card `0 10px 28px`).
* z-index ladder: sidebar 30 · topbar 20 · sticky bars 5 · menus 25/60/70/80 · mobile tabs 40–41 · scrim 25 · FAB 90 · assistant 95 · overlay/modal 100 · lightbox 200 · toasts 300 · offline bar 350 · palette 400 · confetti 500. **Modals render through `createPortal(document.body)`** so they always cover sidebar + topbar.

## Responsive breakpoints actually used

| ≤ | Behaviour |
|---|---|
| 1250px | website editor stacks (panel above preview) |
| 1100/1000px | contact workspace drops tool rail; `.pm-layout`, `.form-split`, `.blog-edit` go single-column |
| 960/900px | `.dash-split`, `.c360`, `.g3/.g4`→2 cols; `.pf-section` single col |
| **860px** | sidebar → off-canvas drawer + scrim; hamburger shows; topbar search becomes flexible |
| **800px** | phone shell: floating rounded bottom tab bar (blur), PWA install bar, content bottom padding 96px, notification panel full-width fixed, assistant becomes full-screen, buttons/inputs min-height 40px |
| 700px | `.form-grid`, `.filter-rule` collapse; page-head actions go full-width |
| 600px | `.g2/.g3/.g4` single column |
| 520px | hero stats become 1-col rows; stat value 18px |

Touch rules: row quick-actions are always visible on `(hover: none)`; notification dismiss `×` always visible; tap targets ≥ 40px on phones.

## Print

`@media print` hides sidebar/topbar/toasts/`.no-print`, removes content padding, forces light. `.print-doc` is a centred 820px sheet with 2px navy header rule. Real PDFs are generated **server-side** (PDFKit) — print CSS is a convenience, not the deliverable.
