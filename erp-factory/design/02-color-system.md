# 02 — Color system

> Exact values live in [`../tokens/design-tokens.css`](../tokens/design-tokens.css) (effective cascade). This file explains **meaning and usage**. Contrast ratios were computed (WCAG 2.x relative luminance) from the extracted values.

## Design intent: "calm"

Airy mint-tinted page, white rounded cards, deep-teal brand, soft pastel icon tiles, status colours that are *dark text on pale tint* (never saturated fills). The page background is `--bg #f4f9f7` plus a fixed 360px gradient at the top:

```css
body { background: linear-gradient(180deg, #dff4ee 0, #f4f9f7 360px) no-repeat, var(--bg); background-attachment: fixed; }  /* light only; 260px on phones */
```

Dark mode is a **deep green-black** (not blue-black): `--bg #0a1513`, `--surface #101f1c`.

## Semantic roles

| Token | Light | Dark | Use |
|---|---|---|---|
| `--primary` | #0e7c6b (accent-driven) | same | primary buttons, active tab underline, focus ring base, links, progress |
| `--primary-d` | #0b5f52 | same | hover of primary, active sidebar text |
| `--primary-l` | #e2f4f0 | `color-mix(primary 22%, #101826)` | selected row, active nav pill, hover tint, "now" step |
| `--bg` | #f4f9f7 | #0a1513 | page |
| `--surface` / `--card` | #fff | #101f1c | cards, modals, menus, topbar, inputs (light) |
| `--surface-2` | #f6faf9 | #142724 | table header/footer, inset boxes, composer foot |
| `--hover` | #f1f8f6 | #162a27 | row & list hover |
| `--grey-bg` | #edf3f1 | #182c28 | neutral pill, tag, icon-button, skeleton, kanban column |
| `--border` | #dbe6e3 | #1f3631 | card/table/separators |
| `--border-2` | #bccbc6 | #2b4741 | input/button outlines, dashed dropzones |
| `--text` | #0f2420 | #eef7f5 | primary text |
| `--muted` | #435e57 | #b9d0ca | secondary text, labels, table headers |
| `--faint` | #5d7a73 | #93b1a9 | tertiary meta, placeholders-ish, icons |
| `--green`/`-bg` | #11692f / #e3f6ec | #4ade80 / #12301f | paid, available, success |
| `--amber`/`-bg` | #8c4806 / #fdf1dc | #fbbf24 / #33270e | pending, partial, reserved, warnings |
| `--red`/`-bg` | #a51919 / #fde8e7 | #f87171 / #3a1618 | overdue, void, rejected, destructive |
| `--blue-bg` | #e4f0fe | #14274d | info alert / "open" pill background |

Status text colours are deliberately **darkened** (`--green #11692f`, not `#16a34a`) to pass contrast on their tint. Saturated `#16a34a` is reserved for *fills* (success button, "done" dot, progress.green).

## Status → colour mapping (single source: `ui.jsx TONES`)

| Tone | Statuses |
|---|---|
| green | paid, approved, available, active, published, valid, confirmed, done, completed, present |
| amber | pending, partial, partially_paid, reserved, review, submitted, on_hold, late |
| red | overdue, void, cancelled, rejected, absent |
| blue | open, featured, leave |
| purple | sold |
| grey | draft, created, hidden, inactive, **anything unknown** |

Add a status by adding it to `TONES` — never colour a badge inline. Lead stages are the exception: **colour is data** (`lookups.color`) and is rendered by `StagePill` as `bg = color + '1f'`, `text = color` (12% alpha tint).

## Pastel icon tiles (`.ic-tile`, `.ic-<tone>`)

Eight tones, each a bg/fg pair that flips in dark mode: violet, blue, orange, rose, green, teal, red, slate. Used for: KPI icons, today-feed cards, notifications by type, dashboard tabs, empty-state icon (teal), quick-action pills. Assign tone by **meaning** (money=green, people=blue, time=orange, approvals=violet, alerts=red, neutral=slate, default=teal) — see `ui.jsx TILE` map.

## Gradients

* Hero: `radial-gradient(900px 300px at 100% -20%, rgba(255,255,255,.22), transparent 60%), linear-gradient(120deg, var(--primary), color-mix(in srgb, var(--primary) 70%, #0f766e) 55%, color-mix(in srgb, var(--primary) 55%, #14b8a6))` + `box-shadow: 0 14px 34px color-mix(in srgb, var(--primary) 28%, transparent)`; a translucent white circle decorates the corner.
* Brand mark: `linear-gradient(135deg, var(--primary), color-mix(in srgb, var(--primary) 60%, #2dd4bf))` with a primary-tinted shadow.
* Auth page: two radial blobs — mint `#bff0e3` top-left, lavender `#e5ddfb` top-right (dark: `#0f3a33` / `#241c45`).
* Mobile floating tab bar: `color-mix(in srgb, var(--surface) 92%, transparent)` + `backdrop-filter: blur(12px)`.

## Contrast audit (computed)

| Pair | Ratio | Verdict |
|---|---|---|
| `--text` on white | 16.2 | AAA |
| `--muted` on white / on `--bg` | 7.05 / 6.63 | AAA |
| `--faint` on white / on `--bg` | 4.67 / **4.39** | AA on white; **fails AA (4.5) on `--bg`** — keep `--faint` for non-essential meta only |
| white on `--primary` (teal) | 5.10 | AA |
| `--primary-d` on `--primary-l` | 6.65 | AA+ |
| green / amber / red text on own tint | 6.05 / 6.17 / 6.49 | AA+ |
| Dark: text / muted / faint on surface | 15.6 / 10.5 / 7.4 | AAA |
| Dark: green / amber / red on own tint | 8.2 / 8.8 / 5.8 | AA+ |
| White on accent **blue / violet / rose** | 5.17 / 5.70 / 4.70 | AA |
| White on accent **amber** `#d97706` | **3.19** | ❌ fails AA for normal-size button text |
| White on accent **green** `#16a34a` | **3.30** | ❌ fails AA |
| `--navy-text #b6c2d9` on white | **1.79** | ❌ legacy bug (see below) |

**Factory rule:** if a client picks amber or green as the *brand* accent, use `primary-d` (`#b45309` / `#15803d`) as the button fill (white on those: 5.0 / 5.0), or switch button text to `--text`. Do not ship amber/green with the reference's white-on-`primary` pattern.

## Known colour debts in the reference (fix in new builds, do not copy)

1. `Layout.jsx` sidebar footer prints the user's role in `var(--navy-text)` (`#b6c2d9`) on the now-**white** sidebar → 1.79:1, effectively invisible. Use `--side-muted`.
2. Hard-coded blue remains where the old navy theme lived: `.assistant-fab` shadow `rgba(37,99,235,.4)`, `.offline-bar.sync #1d4ed8`, `.toast.undo .bar #60a5fa`, `.input:focus` ring base in `styles.css` (overridden by `color-mix` in the calm layer). These ignore the user's accent. Use `color-mix(in srgb, var(--primary) …)`.
3. Chart palette is hard-coded teal-first (`Charts.jsx PALETTE`) and does not follow the accent. Acceptable for categorical series; for single-series charts use `var(--primary)`.
4. `--navy*` variables are legacy but still referenced (portal header, assistant header, toasts, print header rule). A new ERP should replace them with a single `--ink-invert`/`--chrome-dark` token or fully theme the portal header.
5. **Dark-mode hero numbers lose their white** (verified at runtime, computed colour `#93c4bc` instead of `#ffffff`). The rule `:root[data-theme="dark"] a { color: color-mix(primary 45%, #fff) }` has higher specificity than `.hero-stat { color:#fff }`, and `.hero-stat` is an `<a>`; the `<b>` value inherits the tinted link colour (about 1.8:1 vs about 3.4:1 for white, estimated against the translucent tile). Fix: scope the dark link rule to `a:not([class])` or give `.hero-stat b` an explicit colour.
6. **Lead-stage pills fail AA on their own tint** (`StagePill` uses the raw lookup colour as text on a 12% tint). Computed: Non Contacted `#94a3b8` 2.33 · Contacted `#3b82f6` 3.20 · Follow Up `#f59e0b` **1.96** · Interested `#22c55e` **2.05** · Not Interested `#ef4444` 3.20 · Closed `#15803d` 4.27. Fix: text = `color-mix(in srgb, <stage colour> 55%, var(--text))` (keep the raw colour for the dot and tint). Rule for any data-driven colour: **tint and dot from the data colour, text from a darkened mix**.
7. Three more private palettes exist: landing (`--g #0e7c6b`), website (`--s-primary…` per tenant), platform console (`--pa-accent #14b8a6`, sidebar `#0f1b2d`). The *console* intentionally keeps a dark navy sidebar to feel like an operator tool; the landing/site palettes are intentionally independent so tenant branding never leaks into the product site. Keep these namespaces separate (`pa-`, `lp`, `site`), but derive their defaults from the same teal.

## Rules for new ERPs

1. Components consume variables only. A hex in a component file is a review failure — except the fixed hues listed at the bottom of `design-tokens.css` (success fill, badge red, offline bar…).
2. Every new variable ships with a **dark value in the same commit**.
3. Tints are computed with `color-mix(in srgb, var(--primary) N%, <surface>)` so they follow the accent: 7% unread row, 12–18% focus ring/glow, 20–25% selected/"now", 28–35% button shadow.
4. Printed paper (`.vp`, `.print-doc`, PDFs) is always white-on-dark-ink regardless of theme — re-declare `--muted/--border/--text/--surface-2` locally on those containers.
5. Never convey state by colour alone: pills carry a text label (and a 6px dot), overdue rows carry text, plot tiles carry the plot number and a status legend.
