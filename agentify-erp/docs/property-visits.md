# Property visits

Visits are appointments (`/api/appointments`) with a life cycle and check-in evidence. Code: `server/src/routes/appointments.js`,
shared rules in `shared/visits.js`, screens in `client/src/components/Visits.jsx` (Appointments page, contact workspace
"Appointments" tab, property page "Visits" tab). Tests: `server/test/visits.test.js`.

## States

`scheduled` → `in_progress` (check-in) → `completed` (check-out with an outcome), or `scheduled`/`in_progress` → `no_show`,
`scheduled` → `canceled`. Completed, canceled and no-show are final; only scheduled visits can be edited. Older rows keep
the stored spelling `canceled`; the API also accepts `cancelled`.

## Who can do what

* Same module permission as appointments: `crm:view` to see, `crm:edit` to schedule, cancel and mark no-show.
* Own-scope roles (Sales Agent) see and manage only visits assigned to them, can only book themselves, and only with
  contacts assigned to them and properties they may see.
* Only the assigned agent can check in or out, from their own sign-in. A manager cannot record evidence for them.
* Each workspace has its own database, so visits never cross workspaces.

## Time zones

* Every visit is fixed in one IANA time zone: the one chosen when scheduling, else the workspace's. Pick the property's
  zone when it differs from the office (e.g. a New York brokerage booking a Chicago viewing).
* `starts_at`/`ends_at` are the wall-clock time in that zone (as appointments always stored them); `starts_utc`/`ends_utc`
  are the same instants in UTC. Check-in/out stamps are UTC from the server clock.
* Screens show the visit in its own zone with a label (e.g. `CST · Chicago`) and add "Your time" when the viewer's device
  is in another zone. The agent's zone never changes the appointment.
* DST: offsets are looked up for each instant, never fixed. A time inside the spring-forward gap moves forward by the gap;
  a time in the repeated fall-back hour means its first occurrence (an end time takes the second when needed). Default
  length is one real hour.
* Canada's pack now lists its zones (`timezones`), like the US pack.

## Location evidence

* The device is asked once per check-in/out (no background or continuous tracking). Before the first request each user
  sees a notice (workspace text, or a neutral built-in one).
* The server classifies each reading: `verified` (fresh), `stale` (older than the configured age when it arrived, missing
  its capture time, or stamped in the future), `denied`, `unavailable`, `manual` (only when the workspace allows manual
  exceptions; a reason is required, no coordinates are kept).
* Distance is computed in metres only for verified readings when the property has coordinates. The indicator
  (`near`, `near_uncertain`, `uncertain`, `far`, `unknown`) takes the reading's accuracy into account. It is an
  indicator, never proof of presence, and the screens say so.
* Display unit comes from the region pack's `distance_unit` (`mi` for US and UK, `km` for Canada, UAE and Pakistan);
  numbers use the workspace locale. Property area units and currency are untouched.

## Retries, tasks, reminders

* Booking, check-in and check-out take a request key (`client_key` or `Idempotency-Key`). Repeating a request with the
  same key returns the first result (`replayed: true`) and records nothing twice. The app keeps the key, the reading and
  its capture time when a request fails for lack of connection, so "Try again" is safe. Visits are not put in the
  general offline queue.
* At most one follow-up task per visit (CRM task on the contact, else on the property, assigned to the agent).
* Reminders reuse notifications with de-duplication keys: one "Coming up" an hour before, one "Not checked in" 30
  minutes after the start. They run every five minutes for each workspace.

## Settings (Appointments page, settings editors)

`visit_proximity_m` (default 200), `visit_max_fix_age_s` (120), `visit_manual_exception` (off),
`visit_retention_days` (0 = keep coordinates with the visit; otherwise coordinates are cleared after N days and the check
record stays), `visit_location_notice` (text shown to staff). These are technical settings; they do not by themselves
establish legal compliance, and the notice text is the business's own to review.
