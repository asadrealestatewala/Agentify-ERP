# 01 — Typography

> Extracted from `client/index.html`, `styles.css`, `styles2.css`, `styles3.css` (the "legibility pass" block at the end of `styles3.css` is what actually wins). Every rule below is what the reference **renders**, not what an early CSS file declares.

## Font families

| Role | Stack | Loaded from |
|---|---|---|
| UI (everything in the staff app, portals, auth, landing headings) | `'Plus Jakarta Sans', 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif` | Google Fonts, `index.html` |
| Fallback / landing body | `Inter` | same link |
| Public website (`.site`) | **Per-tenant**: `--s-font-h` (headings) and `--s-font-b` (body), chosen in the Website Editor; Google font injected at runtime | `site/siteCore.jsx` |
| Printed vouchers / PDFs | PDFKit built-in Helvetica family (server side, `services/pdf.js`) | n/a |

Google Fonts link (exact):

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
```

Rules: load only the weights used (400–800 Jakarta, 400–700 Inter), `display=swap`, `preconnect` first. The CSP must allow `fonts.googleapis.com` (style) and `fonts.gstatic.com` (font). If a client forbids third-party calls, self-host the same files and keep the stack identical.

## Base settings

| Property | Value | Notes |
|---|---|---|
| Root `font-size` | **14px** (comfortable) · **13px** (compact density) · 14px (spacious) | `styles3.css` "Legibility pass" overrides the 13px in `styles.css` |
| Large-text option | `html[data-text="large"] { zoom: 1.1 }` | accessibility switch in Appearance menu |
| Body weight | **500** (not 400) | deliberate: heavier, higher-contrast text was a user request |
| `input, select, textarea, button` weight | 500 | |
| Line height | 1.45 (body); 1.55 (portal, site); 1.75 (long-form `.rich`) | |
| Smoothing | `-webkit-font-smoothing: antialiased` | |
| Numbers | `font-variant-numeric: tabular-nums` via `.mono` and every `td.num` | **mandatory for any money/quantity column** |
| Links | `font-weight: 600`, colour `--primary`; in dark mode `color-mix(in srgb, var(--primary) 45%, #fff)` | |
| Placeholder | `#587670` (dark `#8aa8a0`), weight 400, opacity 1 | |

## Type scale (as rendered, comfortable density)

| Use | Size | Weight | Tracking | Where |
|---|---|---|---|---|
| Auth hero H1 | `clamp(30px, 4.4vw, 50px)` / lh 1.08 | 700 | -.03em | `.auth2-copy h1` |
| Landing H1 | `clamp(34px, 5.4vw, 58px)` | 800 | -.02em | `landing.css` |
| Greeting hero H2 | 24px (20px ≤700px) | 700 | -.02em | `.hero h2` |
| **Page title** `h1` | **22px** (16px ≤860px) | 700 | -.02em | `.page-head h1` |
| Modal title | 15px | 700 | -.02em | `.modal-h h3` |
| Card title | **15px** | 700 | -.02em | `.card-h h3` |
| Stat value (KPI) | **24px** (18px ≤520px) | 700 | -.02em | `.stat .value`, tabular |
| Hero stat value | 22px | 700 | -.02em | `.hero-stat b` |
| Body / inputs / buttons | 14px / 14px / 13.5px | 500 / 500 / 600 | 0 | |
| Sidebar group item | 14px | 600 | 0 | `.sidebar .nav-item` |
| Sidebar sub item | 13.5px | 500 | 0 | `.sidebar .sub .nav-item` |
| Table cell | 13.5px | 500 | 0 | `.t td` |
| Table header | **12px UPPERCASE** | 700 | .04em | `.t th` |
| Field label | 13px | 700 | 0 | `.field > label` |
| Hint / help | 12px | 500 | 0 | `.field .hint`, `--muted` |
| Pill / tag | 12px | 600 | 0 | |
| Section title (eyebrow) | 12px UPPERCASE | 700 | .06em | `.section-title` |
| Kicker (hero) | 12px | 500 | 0 | |
| Palette group label | 10.5px UPPERCASE | 600 | .07em | |
| Tiny meta (kbd, voucher footer) | 10–11.5px | 500 | 0 | never for essential info |

Headings (`h1–h4`) always `letter-spacing: -.02em; font-weight: 700` in the calm layer.

## Rich text (`.rich`) — website articles and the editor

17px / 1.75 (16px ≤600px). `h2` 1.6em with 3px primary underline (fit-content), `h3` 1.28em with 4px accent left bar, `h4` uppercase .04em primary. Block quote 5px primary bar on 7% primary tint. Callouts at 10% tint; tip `#ecfdf3`, warn `#fff7e6`. Image sizes `.img-sm/md/lg/full` = 30/50/75/100%.

## Rules for new ERPs

1. Keep **Plus Jakarta Sans + Inter** as the default unless the client brand dictates otherwise; swap only `--font-ui` (factory alias) and the Google link.
2. Body weight 500, table header uppercase 12px/700, page title 22px/700 — this is the recognisable "Agentify look".
3. Tabular numerals on every number that is compared down a column.
4. Never go below 12px for anything a user must read; 10–11px is reserved for decorative meta.
5. Money format: `PKR 1,234,567` (`format.js money()`), compact `1.2M / 450K` (`moneyShort`) only in charts and tight tiles. Dates `07-Oct-2026`, date-times `07-Oct-2026 03:05 PM`. For other locales change **only** `format.js` (locale string + currency code); never format inline in a page.
6. Text-size setting (`data-text`) must keep working: no fixed pixel heights on text containers.

## Known deviations in the reference (do not copy)

* `styles.css` still declares `font-size: 13px` and Inter-first stack; three later blocks override it. A new ERP should declare the final values once.
* `.vp` (voucher preview) uses its own 12–12.5px scale and fixed greys so paper stays identical in dark mode — that one is intentional.
* `window.prompt` is used for naming saved views (`ViewsBar`) — functional but unstyled; replace with a small inline input in new builds.
