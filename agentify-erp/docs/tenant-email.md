# Tenant email, quotas and activation (v1.14)

## Three kinds of email
| Category | What | Counted against the tenant? | Sent by |
|---|---|---|---|
| service | Verification, password reset, billing and security notices, Agentify onboarding tips | No, never blocked by a tenant allowance | `sendMail` (platform sender) |
| operational | A tenant's mail about something the recipient is already involved in: appointment confirmations/reminders, receipts | Yes | the tenant queue |
| marketing | Campaigns and nurture sequences | Yes; needs recorded consent; unsubscribe link + `List-Unsubscribe` / `List-Unsubscribe-Post` headers | the tenant queue |

Classification is the tenant's responsibility. Calling mail "operational" does not make promotional content operational.

## Sender setup (Settings > Email)
1. Add a domain the company owns. The server asks the provider (Resend `POST /domains`) for the DNS records and shows them.
2. Publish the records, press *Check now* (`POST /domains/{id}/verify`, then `GET /domains/{id}`). Failed records are listed by name.
3. Create From addresses on a verified domain (name, optional Reply-To). Only an **active address on a verified domain of that workspace** can send. Free mailbox domains (gmail.com...) and platform domains are refused.
Provider keys stay in the platform settings (encrypted) and are never sent to browsers.

## Allowances
* Configured per plan in the console plan editor (`plans.email_limits`): monthly and optional daily limit per category (operational, marketing), warning thresholds (default 70/90/100), hard stop or overage, top-ups on/off. Resolution order: workspace override (`tenants.entitlements.email`) > plan > platform default (`email_default_limits`). A category with nothing configured is **paused with an explanation**, never silently unlimited. The original single-company install is unmetered. No plan was changed by this release.
* **Usage period:** monthly windows counted from the workspace's start date (UTC), day clipped to month length (31 Jan -> 28 Feb -> 31 Mar). The anchor never moves, so upgrading, downgrading or switching to annual billing does **not** reset consumption. Annual subscribers still get the monthly allowance monthly. Raising the plan raises the allowance immediately for the current period (not prorated); lowering it below what is used stops sending until reset, with no refund of used messages.
* **Ledger:** `email_queue` (platform database) is queue and ledger, one row per recipient. `reserved` at queue time (atomic: check and insert in one `BEGIN IMMEDIATE` transaction), `committed` when the provider accepts, `released` after a definitive pre-send failure, opt-out or suppression. Accepted/delivered/bounced/failed/complained/suppressed are separate statuses.
* **Billing treatment:** a message the provider accepted stays charged even if it later bounces or draws a complaint. Delivery events never refund or re-charge.
* Top-ups are granted by a super admin for the current period (no price attached; there is no self-serve checkout, so the tenant UI shows no purchase link).

## Delivery
* Worker runs every 20 s: operational before marketing, round-robin across workspaces (default max 20 per workspace per pass), bounded retries (1, 5, 30, 120, 360 min; 5 attempts), provider 429 pauses all sending for `Retry-After`.
* Before each send it rechecks: workspace active and subscription not expired/cancelled, sender still verified/active, consent, suppression, and (for sequences) the sequence's own stop conditions.
* Idempotency: unique `(tenant, idem_key)` in our database (outlives the provider's 24 h window) plus the provider `Idempotency-Key`.
* **Ambiguous timeouts:** status `ambiguous`, quota stays reserved; the worker searches the provider's recent sends, and if nothing is found retries with the same key. After 5 attempts it is marked unconfirmed, stays charged, and a super admin can release it.
* Provider capacity: optional console limits with a "keep free for account email" reserve. Marketing yields first.
* Webhooks (`/api/platform/webhooks/resend`, Svix-signed, event-id de-duplicated): the workspace comes from our own record of the provider message id. Statuses only move forward; events for a message not yet recorded are parked and replayed. Permanent bounce -> suppress all tenant mail for that address in **that workspace only**; complaint -> suppress marketing; soft bounce -> nothing.

## Consent
`email_consents` (append-only evidence: source, time, policy version, text) and `email_suppressions` live in each workspace database. Importing contacts never grants consent. An unsubscribe (public page, one-click POST) suppresses marketing, records withdrawn consent, cancels queued marketing to that address and frees the reservations. Provider-level suppressions are not removed by tenant actions.

## Reply detection
Needs an inbound domain (console > Tenant email > Reply domain, plus Resend inbound/`email.received` webhook on that domain). Sequence mail then gets `Reply-To: reply+<id>.<signature>@<domain>`. A reply is accepted only if the signature is valid, the sender is the person we mailed, it is not an auto-reply/bounce (Auto-Submitted, Precedence, X-Autoreply, multipart/report, subject patterns) and not a duplicate. Without the inbound domain the UI says so; staff pause or log replies by hand. Opens/clicks are never used.

## Activation
Checklist (Dashboard) computed from real data and remembered once complete: verified owner, business details, a sendable sender, first lead, extra team member (only when the plan allows more than one user), first follow-up, an active sequence (appears once sequences exist). Onboarding emails (welcome after verification, day 1/3/5/7/30, paid activation with the actual package and allowances) go to the owner inside their local 09:00-18:00 (console-editable), max 3/week, each at most once, skipped when irrelevant or overdue by 48 h, off when the owner opts out. Trial reminders and expiry remain in `lifecycle.js` (relative to the real expiry; nothing is sent after payment).

## Configuration needed
* Resend API key and webhook secret (already in Integrations); add the `email.*` events and, for replies, `email.received`.
* Console > Billing > plan editor: set email allowances per plan (none are set by default).
* Console > Tenant email: optional provider limits/reserve, reply domain, manual commercial notes.
* Tenants: their own DNS (SPF/DKIM records shown in Settings > Email).

## Rollback
Additive only: new platform tables (`email_queue`, `email_topups`, `email_sender_domains`, `email_senders`, `email_unmatched_events`, `email_inbound`), new columns `plans.email_limits`, `tenants.email_prefs`, new tenant tables (`email_suppressions`, `email_consents`, `activation_progress`). Reverting the code leaves them unused. To stop sending, empty the queue (`UPDATE email_queue SET status='cancelled', quota_state='released' WHERE status IN ('queued','ambiguous')`) or remove the Resend key.
