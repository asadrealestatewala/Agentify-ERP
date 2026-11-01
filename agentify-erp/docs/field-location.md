# Field-agent location sharing and coverage

Employees can share their **last-known location** with their manager and HR. It is explicit, employee-started and
foreground-only. There is no route history and no background tracking.

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
* **Map.** A live Google map (`client/src/components/LiveMap.jsx`) when the platform has a browser key
  (`GOOGLE_MAPS_API_KEY`, see `services/maps.js` and `GET /api/platform/maps-config`): initials markers coloured by
  freshness, smooth movement between readings, Map/Satellite, Street View, accuracy circle, refresh every 15 s.
  Without a key (or if Google rejects it) it falls back to the free OpenStreetMap embed. Setting *Map* to
  *No embedded map* leaves the list and links only.
* **Time and units.** Stored as UTC ISO; shown in the workspace timezone with the zone name. Accuracy is stored in metres
  and shown in feet for imperial regions.

## Android app

`mobile/android/app/src/main/AndroidManifest.xml` now declares `ACCESS_COARSE_LOCATION` and `ACCESS_FINE_LOCATION`
(no background location). Capacitor's web view asks the user at run time. The APK must be rebuilt for this to take effect.

## Not legal advice

The notice text, retention and access settings are tools. They do not by themselves make a workspace compliant with
employment or privacy law in any country; each customer must check their own obligations.
