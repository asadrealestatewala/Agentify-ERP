# Field-agent location sharing and coverage

Employees can share their **last-known location** with their manager and HR. It is explicit, employee-started and
foreground-only. There is no background tracking. A route history for replay exists only when an admin switches it on (see *Route replay*).

## How it works

| Piece | Where |
| --- | --- |
| Tables `field_agents` (one row per employee: last reading, availability, service area, sharing session) and `field_consents` | `server/src/fieldSchema.js` (created with `CREATE TABLE IF NOT EXISTS`, additive) |
| Rules: consent, sessions, readings, scope, retention | `server/src/services/fieldLocation.js` |
| API `/api/field/*` | `server/src/routes/field.js` |
| Employee page **My Space → My Location**, manager page **My Space → Field Coverage**, top-bar indicator with Stop | `client/src/pages/FieldLocation.jsx`, `client/src/fieldLocation.js` |

* **Off by default.** An admin (`settings:edit`) turns it on under Field Coverage → *Location sharing settings*. Turning it
  off ends every open sharing session.
* **Consent.** Each employee must read the workspace's notice and agree before anything is accepted. Editing the notice
  bumps its version and everyone has to agree again. The phone/browser permission is only a technical permission.
* **One-time share** sends one reading. **Share while the app is open** sends one every *interval* seconds, only while the
  page is visible. The session id lives in memory, so reload, close, logout, another user or another workspace ends it,
  and the server refuses pings for an ended session (409 `sharing_stopped`) or a different user (409 `session_mismatch`).
* **Readings** carry the device capture time (`captured_at`), accuracy in metres and the server receive time. Future-dated
  readings and readings older than *fresh for* minutes are refused. An older reading never replaces a newer one.
  Readings are not queued offline; a missed reading is skipped.
* **Denied / unavailable / timeout** are stored as `last_error`, separate from any location.
* **Freshness** (fresh / recent / stale / none) is computed from capture time. **Availability** (available, busy, on
  break, off duty) is set by the employee and never derived from location.
* **Who sees what.** Employees act only on themselves. Managers see their direct and indirect reports (via
  `employees.manager_id`). HR (`hrm:view`) and Super Admin see everyone in the workspace. Service area is edited with
  `hrm:edit`. Each workspace has its own database, so nothing crosses workspaces.
* **Retention.** `purgeFieldLocations()` runs with the 30-minute tenant jobs: it deletes readings older than the retention
  days (default 30) and ends foreground sessions that went quiet. Withdrawing consent deletes the location at once.
* **Plans.** The API is the `field` plan module (`/field` paths in `services/plans.js`). Plans with `modules: null` include
  it; plans or overrides that list modules explicitly must add `field`.
* **Map.** A live map of agents (`client/src/components/LiveMapLibre.jsx`) on free MapLibre GL vector tiles (OpenFreeMap), no key needed:
  initials markers coloured by freshness, smooth movement between readings, accuracy circle, refresh every 15 s. At most 150
  markers are drawn (the picked agent, then the most recently seen); the pulsing halo is switched off above 40. Google Maps
  (`LiveMap.jsx`) is used only when `MAP_PROVIDER=google` (or the platform setting `map_provider`) AND `GOOGLE_MAPS_API_KEY` is set;
  if Google rejects the key the page switches to the free map. Browsers without WebGL fall back to the OpenStreetMap embed.
  Optional `MAPTILER_API_KEY` adds a Map/Satellite switch. Config comes from `GET /api/platform/maps-config` (`services/maps.js`).
  Setting *Map* to *No embedded map* leaves the list and links only. The *Navigate* button (`shared/navigate.js`) opens Google Maps,
  or Apple Maps first on Apple devices, with directions; it needs no key.
* **Place search** (property editor) uses Photon (free, no key) first, LocationIQ first when `LOCATIONIQ_KEY` is set, and the public
  Nominatim as the last resort (`services/geocode.js`, `GEOCODE_PROVIDER` pins the first choice). Calls are spaced per provider,
  answers cached for a day, a 429 is retried once then falls through to the next provider.
* **Time and units.** Stored as UTC ISO; shown in the workspace timezone with the zone name. Accuracy is stored in metres
  and shown in feet for imperial regions.

## Route replay (v1.61)

* **Off by default.** Setting `route_history` (Field Coverage → Location sharing settings). Turning it on rewrites the "No route history is kept"
  sentence of the notice (or appends a route sentence to a custom notice) and bumps the notice version, so every employee has to agree again.
  Turning it off deletes every saved route and restores the sentence (also a new version).
* **What is stored.** Table `field_points` (user, lat, lng, accuracy, capture time, source). A point is added with each accepted reading, unless the
  person moved under 10 m in under 5 minutes. Nothing is added by the app in the background; only readings the employee chose to share.
* **Who sees it.** Same rule as the coverage list (reporting line, HR, Super Admin): `GET /api/field/team/:userId/route?from&to` (max 3 days, max 5000
  points, readings worse than 500 m accuracy left out). Each view is written to the audit log.
* **Deleted** with the retention purge (`retention_days`), when the employee withdraws consent, and when route history is switched off.
* **UI.** *Replay route* under the map on Field Coverage (`client/src/components/RouteReplay.jsx`): day picker (workspace timezone), play/pause, 1-8×, slider.
  Lines are straight between readings; gaps mean no sharing.

## Directions in the app (v1.61)

`GET /api/directions?from=lat,lng&to=lat,lng&mode=driving|walking|cycling` (staff only, 30/min per user, `DIRECTIONS_LIMIT`). Free routing, no key:
OSRM on `routing.openstreetmap.de` (car/bike/foot servers; `OSRM_URL` overrides, with `{profile}`), falling back to Valhalla on `valhalla1.openstreetmap.de`
(`VALHALLA_URL`). Calls are spaced, cached 5 minutes and only the two coordinates leave the server (`services/directions.js`). The *Directions in the app*
button (`NavigateButton` → `DirectionsModal.jsx`) shows the route line and written steps; *Follow me* uses the foreground GPS only while the window is open.
The public OSM servers are for light use; point `OSRM_URL`/`VALHALLA_URL` at your own server before heavy traffic.

## Android app

`mobile/android/app/src/main/AndroidManifest.xml` now declares `ACCESS_COARSE_LOCATION` and `ACCESS_FINE_LOCATION`
(no background location). Capacitor's web view asks the user at run time. The APK must be rebuilt for this to take effect.

## Not legal advice

The notice text, retention and access settings are tools. They do not by themselves make a workspace compliant with
employment or privacy law in any country; each customer must check their own obligations.
