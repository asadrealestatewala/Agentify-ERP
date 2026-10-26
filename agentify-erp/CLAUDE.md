# Agentify ERP: notes for coding agents

See README.md and ARCHITECTURE.md for the product and code layout. Merging to `main` deploys to production.

## Icons (tenant websites)

* New website icons use `SiteIcon` / `Ic` from `client/src/site/SiteIcon.jsx` and ids from `shared/siteIcons.js` (Tabler outline icons, `@tabler/icons-react`). Do not add emoji as default service/UI icons or a second icon library.
* Store semantic ids, never library names, SVG or URLs; the server normalises `icon` props on save.
* Sizes `ICON_SIZE.inline | control | card`, stroke 1.75, colour via `currentColor` and theme variables (`--s-primary`).
* Decorative icons stay `aria-hidden`; icon-only controls carry their own `aria-label`.
* Add icons deliberately, following docs/website-icons.md (registry, renderer map, picker keywords, tests).
* The ERP app chrome still uses its own `client/src/components/Icon.jsx`; leave it unless a task moves it over.

## Releases and versions

* The product version is `vMAJOR.MINOR` (v1.0, v1.1, v1.2 ...). One source of truth: `shared/changelog.js`. The app version shown in the menu footer and on Menu > What's new is the first entry.
* Every change customers can see: add a new entry at the TOP of `CHANGELOG` (`version`, `date` as YYYY-MM-DD, `title`, `items` of `{ text, where }`), going up by one minor step. A big release goes to the next major (v2.0). Write plain customer-facing words and say where to find the feature. Skip purely internal changes.
* **What's new audiences.** Workspace users (tenants) must only read about what concerns their own work. Items are tenant-visible by default; mark anything about the Super Admin console, platform integrations/keys, billing or inbox operations, Resend/Botlinkd setup, or console alerts with `audience: 'platform'`. Tenant text (and `where`) must never say Super Admin, console, or "when your Agentify administrator switches it on"; say "where your plan allows it" instead. A release whose items are all platform-only sends tenants no notification and is hidden from their What's new. `server/test/changelog.test.js` enforces this.
* Also set `version` in `server/package.json` and `client/package.json` (and the first two version lines of their `package-lock.json`) to the same number with `.0` added, e.g. v1.12 becomes `1.12.0`. `server/test/changelog.test.js` fails if they differ or the order is wrong.
* Concurrent PRs: if another PR already took the next number, rebase and take the next one.
