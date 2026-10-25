# Employee onboarding checklists

HR → Onboarding (`/hrm/onboarding`), My Space → My onboarding (`/my/onboarding`). API under `/api/hrm/onboarding`, so the
HR plan module gates it like the rest of HR (tenant entitlements, no country switch).

## Model

* `onboarding_templates` / `onboarding_template_items`: reusable checklists. Each item has a section (profile, documents,
  policies, accounts, equipment, training, manager review, other), required/optional, who is responsible (employee,
  manager, HR, a specific person), a due offset in **working days** from the joining date (negative = before day one)
  and how it is shown done (`criteria`: manual, note, document, asset, profile fields, employee acknowledgement).
* `onboardings`: one per employee at a time (unique index on open rows), started from a template with a joining date
  (defaults to the employee's recruitment date). Retries with the same `Idempotency-Key` header / `idempotency_key`
  return the first result.
* `onboarding_items`: a **copy** of the template items made at start, so template edits never change a running
  onboarding. States `pending → in_progress → completed`, or `waived` (HR approvers only, reason required); completed
  and waived items can be reopened by HR or the manager (manager items) with a reason.
* `onboarding_item_events`: every transition with actor, UTC time, reason and evidence.
* `work_tasks.onboarding_item_id`: each assigned item becomes a work task for its assignee, so it shows on My Tasks and
  reuses the task due/overdue reminders. Item and task stay in step; an item that needs evidence cannot be finished from
  My Tasks.

Evidence is a reference to existing records (the employee's uploaded document, an asset assigned in the Asset Library),
never a copy. Completing an "account setup" item records what was done; it never changes roles or permissions.
Progress = required items completed or waived ÷ required items, read from the item rows each time.

## Who sees what

HR (`hrm:view`) sees all onboarding; `hrm:edit` manages templates, starts and cancels; `hrm:approve` waives and edits the
working calendar. A manager sees their direct reports (employees whose reporting manager is them). The employee sees their
own checklist. Anyone else assigned an item sees only their items (and only the document categories those items ask for).
Unrelated staff get 404. Each workspace has its own database, so nothing crosses workspaces.

## Time, calendar and reminders

* Due dates are calendar dates in the workspace's IANA timezone; event times (`*_at`) are stored as UTC ISO strings and
  shown in the workspace timezone.
* Weekend days: workspace setting (HR → Onboarding → Working calendar), else the region pack's `work_week.weekend`
  default (PK: Sunday; US/UK/CA/UAE: Saturday + Sunday), else Sunday. Holidays come from HR → Holidays. Working hours
  reuse `work_start` / `work_end`.
* Overdue notices to HR editors and the manager go out once per working day at most (first overdue day, then weekly),
  only after the working day has started, each with a dedupe key so restarts never duplicate them.

## Not decided here (needs the workspace's own policy / legal input)

* Which identity, right-to-work, tax or bank documents each country requires. The starter template names none; edit it.
* Whether an employee acknowledgement in the app is sufficient as a signed policy acceptance in a given jurisdiction.
* Retention period for onboarding evidence and history.
* Attendance and leave still treat only Sunday as the weekend (unchanged); moving them to the working calendar is a
  separate change.
