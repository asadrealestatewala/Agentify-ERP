# Website icons

Tenant websites (public pages, the studio canvas and the icon picker) draw icons with one component and one approved list.

| Piece | File |
| --- | --- |
| Approved ids, labels, legacy emoji map, `resolveIconId` | `shared/siteIcons.js` (no React; the server uses it too) |
| Renderer: id to Tabler outline icon | `client/src/site/SiteIcon.jsx` (`SiteIcon`, `Ic`, `ICON_SIZE`) |
| Editor picker (studio chunk only) | `client/src/pages/website/IconPicker.jsx` |
| Save-time check | `server/src/services/siteValidate.js` (`validateSections` normalises every `icon` prop) |
| Tests | `server/test/site-icons.test.js` |

Library: [Tabler Icons](https://github.com/tabler/tabler-icons) via `@tabler/icons-react` (MIT, exact version pinned in `client/package.json`). Each icon is imported by name, so only the approved icons are bundled (about 40 of Tabler's ~6,000). Tabler's `@license` banner stays in the built files. There is no CDN, API key or runtime download.

## Rules

* Use `SiteIcon` (or `Ic` for a small icon in front of text) for every new website icon. Do not use emoji as a default service or UI icon, and do not add a second icon library.
* Store semantic ids (`residential`, `phone`…), never Tabler component names, SVG markup or URLs. The server turns anything else into the fallback on save.
* Sizes: `ICON_SIZE.inline` (about 1.15em next to text), `ICON_SIZE.control` (22px), `ICON_SIZE.card` (36px). Stroke 1.75 everywhere.
* Colour comes from the theme: icons use `currentColor`; style the wrapper with `var(--s-primary)` and the soft tint `color-mix(in srgb, var(--s-primary) 10%, transparent)`. Never hard-code one tenant's colours in shared components.
* Accessibility: `SiteIcon` is `aria-hidden` by default because the text next to it says the same thing. An icon-only link or button gets its own `aria-label` (for example `aria-label="Call Sara"`). Pass `label` only when the icon alone carries meaning.
* Icons are not mirrored for right-to-left pages. Only add mirroring for a clearly directional icon (an arrow), per icon.

## How old pages keep working

Pages saved before this change store emoji in `services` cards (`icon: '🏡'`). `resolveIconId` maps known emoji to ids at render time (`🏡`→`residential`, `🏗️`→`construction`, `🏢`→`commercial`, `🌾`→`agricultural`…), so existing sites show the new icons without anyone editing or migrating content. When a tenant next saves the page, the server stores the id. Unknown values show the plain fallback (`dot`); an empty value shows no icon. Card text is never changed.

## Adding an icon

1. Check the icon exists in the installed version: `node -e "console.log(!!require('@tabler/icons-react').IconSchool)"` (run in `client/`).
2. Add the id to `SITE_ICONS` in `shared/siteIcons.js` with a short plain label and a group.
3. Import the Tabler component by name in `client/src/site/SiteIcon.jsx` and add it to `ICON_COMPONENTS`.
4. Add search words to `KEYWORDS` in `client/src/pages/website/IconPicker.jsx`.
5. Optionally map old emoji to it in `LEGACY_ICON_MAP`.
6. Run `npm --prefix server test` (the icon test fails if the two lists differ) and `npm --prefix client run build`.

Never rename or delete an id tenants may have saved. To change how it looks, point the id at a different Tabler icon.
