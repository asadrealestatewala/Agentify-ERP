# 03 — Accent system, theme, density

Source: `client/src/theme.js`, `components/Appearance.jsx`, `styles2.css` (dark/density), `styles3.css` (token layer).

## The model

Four per-user, per-browser preferences, stored as one JSON object in `localStorage['erp-appearance']` and applied to `<html>` **before React renders** (`theme.js` is imported in `main.jsx` before the CSS; it also runs `applyAppearance()` at import time → no flash).

| Pref | Values | Default | Effect on `<html>` |
|---|---|---|---|
| `theme` | `light` · `dark` · `auto` | `auto` | `data-theme="light\|dark"`; `auto` follows `prefers-color-scheme` and **live-updates** on OS change |
| `density` | `compact` · `comfortable` · `spacious` | `comfortable` | `data-density` |
| `text` | `normal` · `large` | `normal` | `data-text` (large = `zoom: 1.1`) |
| `accent` | `blue` `teal` `violet` `rose` `amber` `green` | `teal` | inline `--primary`, `--primary-d`, `--primary-l` |

## Accent mechanics (exact)

```js
export const ACCENTS = {            // [primary, primary-dark, primary-light]
  blue:   ['#2563eb', '#1d4ed8', '#eff4ff'],
  teal:   ['#0e7c6b', '#0b5f52', '#e2f4f0'],   // default
  violet: ['#7c3aed', '#6d28d9', '#f3edff'],
  rose:   ['#e11d48', '#be123c', '#ffeef2'],
  amber:  ['#d97706', '#b45309', '#fff5e1'],
  green:  ['#16a34a', '#15803d', '#e8f6ee'],
};
root.style.setProperty('--primary', p);
root.style.setProperty('--primary-d', pd);
root.style.setProperty('--primary-l', dark ? `color-mix(in srgb, ${p} 22%, #101826)` : pl);
```

* Inline style on `<html>` outranks the stylesheet `:root { --primary… }`, so the picker always wins over the default.
* **Everything accent-derived must go through those three variables** (plus `color-mix`). That is what makes the picker, the dark theme and the brand gradient work with zero extra CSS.
* The picker UI is 6 round swatches (26px, 2px ring `--text` when selected) in the Appearance popover (palette icon in the top bar): Theme (3-way segmented), Density (Compact / Cosy / Roomy), Text size (Normal / Larger), Accent.
* `saveAppearance(patch)` merges, persists (try/catch for private mode), applies, and dispatches `window` event `erp:appearance` so open components re-sync.

## Per-tenant branding vs per-user accent (important distinction)

| Level | Controlled by | Scope | Mechanism |
|---|---|---|---|
| **User appearance** (accent, theme, density) | each user | that browser | `theme.js` + localStorage |
| **Company brand in documents** (logo, header/footer, titles, terms) | admin, *Settings → Receipts & Branding* | receipts, vouchers, statements, portal copies | `settings.print_*` → `services/pdf.js` + `components/DocBrand.jsx` |
| **Public website theme** (colours, fonts, radius, header/footer) | Website Editor | `/site/*` only | CSS variables `--s-primary --s-accent --s-dark --s-soft --s-bg --s-radius --s-font-h --s-font-b` (see `site/siteCore.jsx`) |
| **Workspace name** | `settings.company_name` | sidebar, auth, portals | `GET /api/auth/brand` → `brand.js useBrand()` (public, cached once per page load) |

**Factory decision:** the ERP shell uses the *user* accent only. A client's brand colour is delivered as the **default accent** (add a 7th entry in `ACCENTS` or change the default key) — not by editing component CSS. Document colours come from branding settings and stay independent of the UI accent.

## Dark-mode obligations

Every component must be legible in dark without bespoke work, which is achieved by:

1. All surfaces/lines/text via variables (flip automatically).
2. Status tints have dark pairs; tile pairs flip.
3. Items that need explicit dark rules in the reference (copy these): `.btn` (surface-2 bg), inputs (`--input-bg`), `.toast` (#25324f), `.switch` off (#3b4a6b), `.overlay` (rgba(2,6,16,.7)), `.chip`, `.k-col/.k-card`, assistant bubbles, `.tier.*`, Recharts text/grid/tooltip (`.recharts-text`, `.recharts-cartesian-grid line`), `img { opacity: .93 }`.
4. Paper surfaces stay white (`.vp`, `.print-doc`) and `@media print` forces light.

## Density

`compact`: root 13px, table cell 5×10, buttons/inputs 29px, card body 11, content padding 14×18, nav item 5×10, stat 9×12.
`comfortable`: baseline (button 36px, input 38px, table cell 9×12).
`spacious`: table cell 13×14, card body 20.

## Porting checklist for a new ERP

- [ ] Copy `theme.js` unchanged (change `KEY`, `DEFAULTS.accent`, add client brand to `ACCENTS`).
- [ ] Import it in `main.jsx` **before** CSS imports.
- [ ] `index.html`: `<meta name="theme-color">` = default primary; favicon SVG uses the same hex.
- [ ] Add `Appearance.jsx` to the top bar (right cluster, before the bell).
- [ ] Verify each of 6 accents × light/dark on: primary button, active nav pill, selected row, focus ring, progress bar, hero gradient. Reject any hard-coded blue.
- [ ] Fix the amber/green white-text contrast problem (see 02-color-system.md) if either is offered.
