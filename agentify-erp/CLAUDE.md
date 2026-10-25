# Agentify ERP: notes for coding agents

See README.md and ARCHITECTURE.md for the product and code layout. Merging to `main` deploys to production.

## Icons (tenant websites)

* New website icons use `SiteIcon` / `Ic` from `client/src/site/SiteIcon.jsx` and ids from `shared/siteIcons.js` (Tabler outline icons, `@tabler/icons-react`). Do not add emoji as default service/UI icons or a second icon library.
* Store semantic ids, never library names, SVG or URLs; the server normalises `icon` props on save.
* Sizes `ICON_SIZE.inline | control | card`, stroke 1.75, colour via `currentColor` and theme variables (`--s-primary`).
* Decorative icons stay `aria-hidden`; icon-only controls carry their own `aria-label`.
* Add icons deliberately, following docs/website-icons.md (registry, renderer map, picker keywords, tests).
* The ERP app chrome still uses its own `client/src/components/Icon.jsx`; leave it unless a task moves it over.
