# Website theme sources and licences

Every theme in the Website Studio library is listed here, with where its design comes from and what was (not) copied.
The registry is `shared/siteThemes.js`; the `origin` and `source` fields there are the machine-readable version of this page,
and `server/test/site-themes.test.js` checks that the two agree.

Two kinds of theme appear in the Themes tab:

* **Agentify Original**: designed by Agentify. Layout patterns are common to real estate sites; no code, artwork or text comes from any other theme or project.
* **Open-source adaptation**: an Agentify design (built from Agentify's own blocks) that takes its general visual direction from an open-source project. The source and its licence are recorded below and shown in the library. **No source code, text, logos, fonts or demo content is imported.** The only imported assets are the ten Horizon Estate demo photos listed under `horizon`.

## Why no code is imported

The reference projects are Next.js applications. Agentify renders every website itself with its own blocks, so a Next.js app cannot be installed, embedded or run beside it, and its code would add nothing to a theme, which is a list of blocks plus colours and fonts. The references were read for layout and mood only.

## Agentify Originals

| Theme id | Name | Notes |
| --- | --- | --- |
| `skyline` | Skyline | Property portal. Original. |
| `haven` | Haven | Rentals and bookings. Original. |
| `maison` | Maison | Single property. Original. |
| `homestead` | Homestead | Modern agency. Original. |

Sample photos shipped for previews (`client/public/site/theme-*.jpg`) were supplied by the product owner for use as sample content. Rights to use them in the product are the owner's to confirm; they appear only as starting pictures that a company replaces with its own.

## Open-source adaptations

### `horizon` Horizon Luxury

| Field | Value |
| --- | --- |
| Reference project | Horizon Estate |
| Repository | https://github.com/dmsda/horizon-estate |
| Version reviewed | `main` as of 2026-10-25 (two commits at review time; no release tag) |
| Code licence | MIT, Copyright (c) 2026 Horizon Estate Project Contributors |
| Asset licences | Sample photography of the project is under the Unsplash License; the Manrope font is SIL Open Font License 1.1; Lucide icons are ISC. The project states that photos and mock imagery are not covered by the MIT licence. |
| Used | General visual direction only: architectural minimalism, a black, white and champagne palette, editorial type, generous white space, and a page list of collection, developments, advisors, about and contact. |
| Copied | No source code, text, logos or fonts. Ten villa and home photos only (source commit `8a73a32`), approved by the product owner on 2026-10-25. |
| Assets used in the theme | `client/public/site/horizon-*.jpg`: dusk-villa, beach-house, white-villa, cliff-villa, pool-house, island-retreat, mountain-lodge, ocean-breeze, hillside-home, jungle-home (from the project's `public/images/hero` and `properties`). Resized to 1600px wide and recompressed. Playfair Display and Manrope come from Agentify's own font list (both SIL Open Font License 1.1). |
| Not copied | Agent portraits, journal, service and office photos, the floor plan and the project's showcase screenshots. |
| Photo notice | Photos are under the Unsplash License as stated in the project's ASSETS.md; the project gives no per-photo credit, and says some are synthesized renders. They are sample pictures for the editor and preview, saved into a company's own draft pages on install and meant to be replaced. |
| Attribution | Not required by the MIT licence because no code was copied; the source and photo licence are recorded here. |
| Modifications | Photos resized and recompressed. The theme itself is an original composition of Agentify blocks. |

### `urban` Urban Living

| Field | Value |
| --- | --- |
| Reference project | Tumon Art Real Estate |
| Repository | https://github.com/tumon-art/real_estate |
| Demo viewed | https://real-estate-4.vercel.app/ |
| Version reviewed | `main` as of 2026-10-25 (188 commits at review time; no release tag) |
| Code licence | MIT, Copyright (c) 2023 Tumon |
| Asset licences | Not stated by the project. No image, font or icon from it is used. |
| Used | General structure only: a search-led home page, Buy and Rent entry points, for-sale and for-rent rows, agent cards, a neighbourhoods section and popular-search style links. |
| Copied | Nothing. No source code, photos, text, logos, brand names or demo content. The demo's names ("Real Estate, Inc." and a network label) are not used. |
| Assets used in the theme | None from the project. Fonts are DM Sans and Inter from Agentify's own list (SIL Open Font License 1.1). Preview photos are Agentify's sample photos. |
| Attribution | Not required by the MIT licence because no code was copied. The licence is recorded here anyway. |
| Modifications | Not applicable. The theme is an original composition of Agentify blocks. |

### Reviewed and not used

| Project | Status |
| --- | --- |
| https://github.com/codewithsadee/homeverse | Not reviewed. The licence was not verified, so it was not used, even as a visual reference. |
| https://github.com/Mreigel/real-estate-template | Not reviewed. The licence was not verified, so it was not used, even as a visual reference. |

## How the data rules apply to every theme

* Listings, projects, agents, articles, reviews and numbers on a published website always come from the company's own ERP data. A theme stores only blocks and settings, never listings.
* Sample listings, agents and articles exist only in the editor and the theme preview, are labelled "Sample", and are never sent to visitors.
* Installing a theme saves a draft. It never publishes, and a replaced page keeps its old layout in version history.
* Theme definitions are shared and read-only. A company's installed pages and settings are copies that only that company can change.

## Adding a theme later

1. Check the licence of the code **and** of the photos, fonts and icons separately. If anything is unclear, use only the general visual direction.
2. Build the pages from Agentify blocks in `shared/siteThemes.js`, with `origin` set to `original` or `adaptation`.
3. For an adaptation, fill `source` (name, url, licence, copyright, date reviewed, what was used, what was copied, asset status) and add a section to this page.
4. Run `npm test` in `server/`. The theme tests check the registry and this page.
