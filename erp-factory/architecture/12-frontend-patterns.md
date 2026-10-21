# 12 — Frontend patterns

Reference files: `client/src/{main,App,api,context,format,brand,printPdf}.js(x)`, `components/*`, `pages/*`.

## Stack & conventions

React 18 function components + hooks only (no Redux/React-Query). React Router 6 (`BrowserRouter`). Vite 5. Recharts. **No CSS framework** — three plain CSS files + variables. `@supabase/supabase-js` is present but optional (client is `null` until real env values are set).

Entry order in `main.jsx` matters: `theme.js` first (applies appearance before paint) → `supabase.js` → `registerSW()` → `styles.css` → `styles2.css` → `styles3.css`. (New ERPs: collapse into `tokens.css` + one `app.css`; keep the order *tokens → components → utilities*.)

## State model — only four contexts, everything else is local state

| Context (`context.jsx`) | Provides | Notes |
|---|---|---|
| `AuthCtx` / `useAuth()` | `user`, `login`, `loginMfa`, `adopt`, `logout`, `refreshUser`, **`can(module, action)`** | `user === undefined` loading, `null` anonymous. `can()` is false for portal users; `isSuper` bypass; perms come as `module:action` strings (`['*']` for super) |
| `MetaCtx` / `useMeta()` | `meta` (lookups, users, projects, accounts, custom fields, settings), `reload` | loaded once after login via `/api/settings/meta`; `useLookups()` derives helpers (`list(type)`, `stageById`, `agents`, `treasury`, `expenseAccounts`) |
| `ToastCtx` / `useToast()` | `toast(msg, kind)`, `toast.undoable(msg,{commit,onUndo,onDone,seconds})`, `toast.live(n)` | `ok` 3.2 s, `err` 6 s |
| Router | route state | filters that matter for deep-linking live in the URL (`/payments/installments?status=overdue`, `/contacts?new=1`, `/receipts/new?contact=12`) |

Cross-component signalling uses **window events**, not global stores: `erp:data-changed` (any mutation → every `useFetch` reloads), `erp:unauthorized` (401 → clear session), `erp:appearance`, `erp:hidden` (undo-delete hide set), `erp:queue`/`erp:synced` (offline queue), `erp:palette`, `erp:assistant`. This keeps pages decoupled: a modal saves and fires `erp:data-changed`; the list refetches itself.

## Data access

```js
api.get(url, params) / post / put / patch / del / upload(formData)         // all return parsed JSON or throw ApiError(message,status,data)
download(url, params, filename) / downloadPost(url, body, filename)         // blobs with cookies + CSRF header
useFetch(url, params, deps?) → { data, loading, error, reload, setData }    // re-runs on url/params change AND on 'erp:data-changed'
useTable(url, opts)          → { tableProps, q, setQ, setFilter, reload, views… }   // see 05-interactions
```
* Every request sends `X-Requested-With: ERP` (CSRF contract with the server) and `credentials: 'same-origin'`; JSON bodies use `keepalive` so unload-time commits survive.
* `qs()` skips empty values and JSON-encodes objects (filter objects ride in the query).
* **401 handling:** any non-auth endpoint returning 401 dispatches `erp:unauthorized` → providers null the user → router shows login. Auth endpoints are excluded so wrong-password errors render inline.
* Error text from `{error}` is shown verbatim — server messages are written to be shown.

## Routing & authorization

`App.jsx` decides the *shell* from identity, before any route:

```
/site/*  → public website SPA            /platform/* → operator console (own auth)
user undefined → <Loading/>
anonymous → Home (landing or /site) · /login · /portal/login · /vendor/login · /signup · /forgot-password · /reset-password/:t · /invite/:t
user.portal && vendor_id → Vendor portal layout   |   user.portal → Customer portal layout
staff → <Layout/> with <Outlet/> routes, each wrapped:  G('module', <Page/>, 'action')
```
`Guard` renders a friendly "No access" panel instead of a blank page; the **API enforces the same rule** (UI guards are UX only). Redirect unknown paths for portal users to their home so URLs from the wrong identity never 404 confusingly. Paths for a login screen carry `?next=` so deep links survive sign-in.

## Page composition recipes

* **List page:** `const t = useTable('/api/x', {sort, dir, viewsKey}); <PageHead/> <Card flush><toolbar/><ViewsBar t={t}/><DataTable {...t.tableProps} columns rowActions quickActions/></Card>`; create/edit through `FormModal`; delete through `ConfirmDialog` → `useUndoDelete(scope).remove(id, msg, () => api.del(...))` and pass `hiddenIds={hidden}`.
* **Master data:** `ResourcePage` config only.
* **Detail/workspace:** `BackLink` → summary column (`KV`, avatar, `StatusBadge`) + `Tabs` (Overview / Timeline / Documents / Finance …), each tab lazy-fetching its own endpoint; `DocumentsPanel` and `Timeline` are dropped in by `entityType/entityId`.
* **Report page:** `DateRangeFilter` + `BarsChart/LinesChart/DonutChart` + `DataTable hidePager footer={totals}` + `ExportMenu`.
* **Wizard/long form:** `.pf-section` blocks (icon tile + title/description column, fields column), sticky bottom save bar, live preview column where the output is a document (`.form-split`).
* **Dashboard:** `Hero` (role-aware stats, links to filtered lists) → `QuickActions` (permission-filtered pills) → collapsible `Onboarding` → `.dtabs` (Overview / Leads & sales / Finance / Inventory / People — only those the role may see; last tab remembered in `localStorage['dash-tab']`).

## Forms

Controlled state object + `set(k,v)`; required validation client-side for UX, **authoritative validation server-side**; button shows `Saving…` and disables while busy; errors in an `.alert.err` at the top; Enter submits (hidden submit button); money via `CurrencyInput` (numbers, not strings); selects bound to `lookups` via `list('type')`; foreign keys via pickers. Dirty-state prompts are not used — drafts are server-side statuses (`draft`) instead.

## Local persistence (all try/catch-wrapped, all non-critical)

`localStorage` keys: `erp-appearance`, `nav-open`, `sidebar-collapsed`, `cols:<tableId>`, `views:<viewsKey>`, `dash-tab`, `erp-offline-queue`. Nothing important is *only* in the browser except the not-yet-synced offline queue.

## PWA / offline

`public/sw.js` — app-shell cache (`erp-shell-v2`: `/`, manifest, icon; hashed `/assets/*` cached on first hit), network-first navigation with `/` fallback, **never caches `/api` or `/uploads`** except `GET /api/auth/me` and `/api/settings/meta` in `erp-session-v1` (so the app can open offline; wiped on logout). Handles `push` and `notificationclick` (focus existing window and navigate to `data.link`). `manifest.webmanifest` + 192/512 icons; install prompt captured in `MobileTabs`. Capacitor wrapper in `mobile/` loads the hosted URL (theme `#0e7c6b`).

## Printing & PDFs

Server PDFs are the deliverable (`/api/.../pdf`). `printPdf.js` / `window.print()` is a convenience; `.print-doc` and `.vp` are always light; `.no-print` hides chrome.

## Accessibility baseline in the reference

Landmarks (`aside`, `nav aria-label`, `main#content`, `header`), `role=dialog aria-modal`, `role=tablist/tab aria-selected`, `role=switch aria-checked`, `aria-label` on icon buttons, `aria-busy` skeletons, `role=status` toasts, `aria-expanded` on collapsibles, visible focus. **Gaps to close in new builds:** no focus trap in `Modal`, no focus restore on close, no skip-link, `window.prompt` for view names, colour-only plot tiles rely on number + legend.

## Performance notes

Single large bundle (`chunkSizeWarningLimit: 1500`): acceptable for an internal tool; for new ERPs add `React.lazy` per top-level route group (CRM, Accounting, HR, Website builder) and keep Recharts in the dashboard/reports chunk.
