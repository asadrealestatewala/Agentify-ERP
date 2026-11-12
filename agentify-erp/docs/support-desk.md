# Support desk (in-app ticketing)

Workspace users raise support tickets from **Menu > Help & Support**; the Agentify team answers them in
**Console > Support > Support desk**. Nothing leaves the product: no third-party help-desk service is involved, and a
ticket travels only over the app's own HTTPS connection.

## Where the code is

| Part | File |
| --- | --- |
| Lists, targets and all screen/e-mail text in 4 languages | `shared/supportDesk.js` |
| Storage, rules, SLA clocks, attachments, e-mail | `server/src/services/supportDesk.js` |
| Workspace API (`/api/support`) | `server/src/routes/support.js` |
| Console API (`/api/platform/admin/support/...`) | `server/src/routes/platformAdmin.js` |
| Workspace page | `client/src/pages/Support.jsx` (route `/support`) |
| Console page | `client/src/pages/platform/SupportDesk.jsx` (route `/platform/support`) |
| Tests | `server/test/support-desk.test.js` |

## Data

Tickets live in the **platform database**, not in a workspace database, so one console queue covers every workspace:

* `support_tickets` — workspace (id, slug, name, region), requester (user id, name, e-mail), language, subject,
  category, priority, status, assignee, first-response and solved times, unread flags for each side.
* `support_messages` — one row per message; `author_type` is `customer` or `staff`; `internal = 1` is a console-only
  note the customer never sees.
* `support_files` — up to 3 attachments per message, each at most 450 KB, PNG/JPG/WebP/PDF only. The file's own
  signature is checked, not just the declared type. Files are served back by the app itself, never from a third party.

Who sees what: a person sees their own tickets; a workspace's **Super Admin** role sees every ticket raised from that
workspace. A sign-in from one workspace can never reach another workspace's tickets (`tenant_id` is taken from the
request's workspace context, never from the request body).

## Statuses and targets

Statuses: `open` → `pending` (waiting for the customer) → `solved` → `closed`. A customer reply moves a ticket back to
`open`; a closed ticket cannot be replied to.

Reply targets (minutes to first reply / to solved) default to urgent 60/480, high 240/1440, normal 480/2880,
low 1440/7200 and are editable in **Console > Support > Support desk > Reply targets and alerts** (stored as the
platform setting `support_sla`). Each ticket shows `met`, `on track`, `due soon` or `overdue` for both clocks, measured
in plain clock time from when the ticket was raised.

New-ticket and customer-reply alerts go to `support_notify_email` (console), falling back to
`PLATFORM_SUPPORT_EMAIL`.

## Languages

English is always offered. Each region pack adds its own language:

| Region | Language | Direction |
| --- | --- | --- |
| PK | Urdu (اردو) | right to left |
| AE | Arabic (العربية) | right to left |
| CA | French (Français) | left to right |
| UK, US | English | left to right |

The page, the pick-lists and the three notification e-mails (received, replied, solved) all follow the language the
person chose, and the e-mail HTML is marked `dir="rtl"` for Urdu and Arabic. The person's choice is stored on their
ticket, so a reply typed months later is still sent in their language.

**Native review still needed.** The Urdu, Arabic and French text in `shared/supportDesk.js` was drafted by machine and
has not been read by a native speaker. It is listed alongside the other region text in
`docs/multi-region/translation-review.md`. Console replies are typed by the support team, so they are only as native as
the person writing them.

## Limits and safeguards

* 5 new tickets per person per hour; 20 customer messages per ticket per hour.
* Subject 140 characters, message 6,000 characters.
* The console permission `support.manage` is required for every console support route (Platform Owner, Super Admin,
  Platform Administrator, Support Manager, Customer Success Manager, Technical Administrator).
* Every console reply, note, status change and settings change is written to the platform audit log.
* No salary, CNIC/ID, bank or password data is read by this feature; only what the person types.

## Not built

* No live chat, no phone channel, no customer-facing knowledge base search inside the ticket form (the Ask assistant
  already answers "how do I…" from `shared/help/guides.js`).
* No inbound e-mail into a ticket: a customer replies on the page, not by answering the notification.
* No satisfaction rating, no attachment virus scanning, no per-plan ticket limits.
