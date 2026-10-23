# Public landing page (`/` on the platform domain)

CRM-first home page for real estate brokerages, with the wider ERP as the supporting story.

## Where things live

| Piece | File |
|---|---|
| Page shell, header, footer, other public pages | `client/src/marketing/Marketing.jsx` |
| Market (country/city) selection, country menu, page titles | `client/src/marketing/core.jsx` |
| Home page sections | `client/src/marketing/home/Home.jsx`, `Hero.jsx`, `Tour.jsx`, `Sections.jsx` |
| Sample data for every product preview | `client/src/marketing/home/sample.js` |
| Owner-supplied logos and store links | `client/src/marketing/home/config.js` |
| Styles (also sets the public site's palette) | `client/src/marketing/home/home.css` |
| Headline copy per market and city | `server/src/regions/marketingCopy.js` (`GLOBAL_CRM_COPY`, `COUNTRY_COPY[cc].crm`) |
| Location lookup | `server/src/services/geo.js`, `GET /api/platform/geo` |
| In-app install page | `client/src/pages/InstallApp.jsx` (`/my/install-app`, My Space › Install the app) |

## Location-aware headline

Order of precedence (see the comment at the top of `core.jsx`):

1. `?country=xx` or `/us /uk /ae /pk /ca` in the address (a shared link; this visit only).
2. A country picked in the country menu. Stored in `localStorage` (`agentify_country_choice`) until the visitor chooses **Use detected location** / **Reset to automatic** in the same menu.
3. The approximate location of the connection, from `GET /api/platform/geo`, asked once per browser session (cached in `sessionStorage`, 2.5 s timeout).
4. Otherwise the global headline. The browser time zone then only picks the currency and number formats.

The hero renders with the global headline first and switches once when detection answers. A city-specific line is shown only when the detected city is in that market's `cities` list; otherwise the country line. Unsupported countries, failures and blocked requests keep the global line. Nothing is inferred about language, nationality or anything else; prices only change where the plan configuration already has prices in that currency.

### Configure detection (server environment)

Nothing configured = no lookup, global headline for everyone (the menu still works).

| Variable | Meaning |
|---|---|
| `GEO_TRUST_HEADERS=1` | Read `CF-IPCountry` / `CF-IPCity` (Cloudflare) or `X-Geo-Country` / `X-Geo-City` set by your reverse proxy (for example nginx with a GeoIP2 module). Only enable when the proxy overwrites these headers. |
| `GEO_PROVIDER=ipinfo` + `GEO_TOKEN` | ipinfo.io lookup (country and city; token required). |
| `GEO_PROVIDER=ipapi` (+ optional `GEO_TOKEN`) | ipapi.co lookup (country and city; small free allowance without a key). |
| `GEO_TIMEOUT_MS` | Provider timeout, default 1500. |

Before enabling a provider, review its terms, privacy policy, data retention, rate limits and price. The server never sends the key to the browser.

### Privacy

- Only country and city are used, to choose a headline. No precise location is requested from the device.
- The address is not written to disk or logs. Results are kept in memory for 6 hours (10 minutes after a failure) under a salted hash that changes on every restart, then forgotten. Maximum 5,000 entries.
- The endpoint is rate-limited (60 requests per minute per address) and answers with `Cache-Control: private`.
- The country menu explains this in one sentence; consider adding the same sentence to the privacy policy (Console › Content › Legal).

### Edit the copy

Change `GLOBAL_CRM_COPY` and the `crm` block of each country in `server/src/regions/marketingCopy.js`: `hook`, `sub`, `city_hook` (with `{city}`), `cities`, `emphasis`. Keep every line free of claims about local offices, customers, listings or prices.

## Product tour and previews

All previews are React components with fixed sample data from `sample.js`, labelled "Sample data". Nothing a visitor does in them is sent anywhere. Each tab says whether the feature is fully in the product or only partly (for example, there is no automatic lead-to-property matching).

## Content the owner still needs to supply

- **Customer logos:** only with written permission. Add them to `APPROVED_LOGOS` in `home/config.js`; until then a neutral capability line is shown.
- **Customer stories:** add in the console (Content › Testimonials) with name, role, company, optional two-letter country code and confirmation of permission. Until then a founding-customer invitation is shown.
- **App store links:** set `VITE_ANDROID_STORE_URL` / `VITE_IOS_STORE_URL` at build time once the apps are published. Until then the page says store versions are not published.
- **Prices:** the plan prices in `server/src/services/plans.js` are still marked as placeholders in the README. Confirm them before launch.

## Home page layout (current)

- **Hero:** the headline is fixed ("Every real estate lead. Every follow-up. One CRM."). Under it, the visitor's market adds one line (`crm.hook`, or `crm.city_hook` when the detected city is on that country's `cities` list) and its own sub-headline. The market wording is used only when the visitor chose the country or the server detected it; otherwise the global wording shows. A country the visitor picks is remembered; "Use detected location" clears it.
- **Perspective tunnel:** on wide, tall windows with motion allowed, six decorative product cards fly towards the visitor as the page scrolls (`glow/Tunnel.jsx`). Progress comes from the scroll position only; no wheel or touch event is intercepted and no animation library is used. It switches off on phones and narrow windows (< 900 px), short windows (< 640 px), reduced motion and low-memory or two-core devices. The six buttons under the hero buttons open the same screens of the live demo and are the keyboard route.
- **Beyond the CRM** (`glow/Extra.jsx`): the ERP capabilities behind the CRM. **Customer stories** (same file) render only when permitted testimonials exist in the console; with none, the section is absent.
- **Android app:** `client/public/downloads/agentify-erp.apk` is served at `/downloads/agentify-erp.apk`; see `mobile/README.md` to rebuild it. The Download app buttons link to it on Android and use the browser's one-click install elsewhere.
