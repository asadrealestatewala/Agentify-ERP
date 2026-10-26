# Lead conversion (v1.15)

Everything below runs inside one workspace. Nothing here reads another workspace, and no client-supplied tenant id is trusted.

## Routing
* Settings > Lead Routing. Rules are checked in order; the first that matches a new lead wins. A rule can match source, city, property type and project, and shares leads **round robin**, **weighted** (smooth weighted round robin, saved per rule so the order survives restarts) or **manual** (the lead waits in a queue and the manager is told).
* Eligibility per agent: active staff, marked available, on the rule's team, covering the lead's project and city (profile lists are optional filters), and under their open-lead limit.
* No eligible agent: the rule's fallback owner, then the workspace default owner, then the sales manager; otherwise the lead waits unassigned and the manager is notified.
* With **no rules** the earlier behaviour (round robin among Sales Agents) is unchanged. An owner set on a website connection, or the agent of the listing, still wins.
* Saving or enabling a rule **never moves an existing lead**. A repeat enquiry from a person already in the CRM keeps their owner.
* Choosing the agent and writing the assignment happen in one database transaction (`BEGIN IMMEDIATE`), so simultaneous leads cannot read the same round-robin position. Each assignment row records rule, reason, actor, time and deadlines.
* Manual assignment (contact editor, bulk assign, `/api/leadflow/contacts/:id/assign`) writes the same record with kind `manual`. An agent who adds a lead for themselves has accepted it.

## Response targets
Four separate facts are stored in `lead_assignments` / `lead_events`: **assigned**, **accepted**, **contact attempt**, **human response**.
* A human response is a completed outbound call by the assigned agent found in the call log (`evidence = call_log`), or a response recorded by staff (`manual_log`, labelled "manual record" everywhere). An attempt, an automated acknowledgement and a sequence email are stored with `automated = 1` or as attempts and **never** satisfy a target.
* Deadlines are computed when the assignment is made from the workspace working calendar (weekend, holidays, hours, IANA timezone) via `shared/visits.js` wall-clock helpers, so DST and zones other than the server's work. "Working hours only" can be switched off for plain elapsed time. They are never rewritten later.
* Job (every minute per workspace): reminder at a % of the time, manager alert after the deadline, optional reassignment N minutes later, capped per lead, never back to someone who already had the lead. Each step fires once (dedupe keys), stops when the target is met, and closing the lead ends the assignment.

## Duplicates
* Inbound enquiries get a fingerprint (last 10 phone digits or e-mail, form, normalised message or external id). Seen again within 24 hours it is recorded as a `repeat` in the source history and creates nothing new and notifies nobody.
* A shared phone/e-mail is not proof of one person: if the names share no word (or initial) the enquiry becomes its **own contact** and a pending review is opened. Nothing merges automatically.
* A manager merges from Settings > Lead Routing > Duplicates. All tables with `contact_id` or `entity_type/entity_id = contact` move to the kept contact (activities, notes, tasks, calls, appointments, attribution, lead history); blanks on the kept contact are filled; a snapshot of the merged contact is kept in `contact_merges`.
* Marketing consent ticked on a website form is stored as consent evidence (source `website_form`). Imports never create consent.

## Sequences
* Trigger: started by hand, new website enquiry, viewing booked, viewing completed. Steps: email or task with a wait, a condition (always / no reply / nobody responded personally / lead still open), a sending window (hours, working days) in the workspace timezone, a weekly cap and a minimum gap.
* Versions are immutable. Saving a change to the steps adds a version; people already enrolled finish the version they started with. Renames do not version.
* The runner uses the existing tenant email queue: verified sender, consent, suppression, quotas and idempotency all still apply (`seq:<enrolment>:<step>` is the idempotency key, so a restart never double-sends). Marketing steps without consent are **skipped, not forced**. No verified sender or allowance pauses the enrolment (`blocked:*`) and it resumes by itself.
* Stops: customer reply, appointment booked (configurable), opt-out, address suppressed, lead won/lost, manual cancel. A queued but unsent email is cancelled by the send guard. Manual pause/resume per contact.
* **Reply detection** needs an inbound domain on the server (Phase 1 setup). Without it the UI says so and staff use Pause or "Customer replied". Opens and clicks are not used. There is no Gmail/Outlook mailbox connection.
* Templates (new inquiry, viewing follow-up, long-term nurture) exist in English, French and Arabic. **French and Arabic are machine-prepared and need native review.** Arabic text renders right to left in the editor and preview.
* Test send goes only to the signed-in user's own address and counts against the allowance.

## Appointments
Creating a viewing/site visit records `appointment_booked`, stops sequences that stop on booking and starts "viewing booked" sequences. Completing a visit (check-out) starts "viewing completed" sequences. A second booking for the same lead, kind and start is returned as the existing one; the same enrolment key stops a second enrolment, and an identical open task is never created twice.

## Conversion report (CRM > Lead Conversion)
Definitions are in the page and in `server/src/services/conversion.js`. Rates carry `n of d`; an empty denominator shows "–", never 0%. Leads from before tracking are listed as "not tracked" and left out of response figures. Automated messages are shown on their own line. Agents with own-scope access see only their own leads and no ranking of colleagues.

## Not done / not verified
* Nothing was sent to a real recipient; the provider is a test double. Real Resend delivery and inbound reply webhooks are untested.
* Legal text for consent, quiet-hour rules per country (e.g. Canadian CASL, UK PECR, UAE rules) and holiday data per country need a business/legal decision; the workspace holiday list is used as is.
* Multi-day SLA across a holiday uses the workspace holiday table only.
* No Gmail/Outlook OAuth, WhatsApp, IDX, GPS or support-center work was added.
