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

## Connecting Resend (Super Admin console > Tenant email)
1. Paste the API key under Integrations > Email (stored encrypted with `ERP_SECRETS_KEY`, shown only as its last 4 characters). Use a key with **full access**: a send-only key cannot manage domains, webhooks or usage, and the panel says so.
2. **Test connection** checks domains, webhooks and usage separately and stores the result.
3. **Register webhook** is idempotent: it looks for a webhook at our address first. Outcomes: `created` (none existed), `adopted` (existing one already had every event we need, used as is) or `adopted_updated` (missing events added, the webhook's own extra events such as `inbox.email.received` kept). It never makes a second one. The signing secret comes from Resend when it returns it; otherwise paste it in the panel's secret field (encrypted, never shown back; rotating it at Resend first is fine). When none exists it creates `https://<console host>/api/platform/webhooks/resend` at Resend for `email.sent, delivered, delivery_delayed, bounced, complained, failed, suppressed, received` and stores the returned signing secret encrypted. Only a public https host is accepted. If Resend does not return the secret, paste it from the Resend dashboard into Integrations (events are refused until it is saved). Webhooks are Svix-verified; the workspace is always found from our own message record.
4. **Send a test email to me** is the only real send in the panel, to the signed-in operator's own address.
5. Inbound replies need a reply domain with inbound email enabled at Resend (`email.received` webhook, full message fetched from `/emails/receiving/:id`). The panel lists domains already at Resend (sending/receiving) read only; an already verified domain is never re-created. Reply detection stays OFF until the operator saves a reply domain (a separate name such as `reply.<domain>` keeps ordinary mail on the main domain). A workspace adding a domain that exists at Resend but is not verified adopts it; one already verified there must be linked by support.

**Verified with recorded-shape HTTP only** (stubbed fetch checking method, path, headers, body): send, domain list, webhook list/create, error mapping, restricted-key detection. **Not verified against a real account:** domain create/verify, usage response shape (`GET /usage` is shown exactly as returned), webhook delivery and `signing_secret` in the create response, inbound receiving.

Live smoke test: Test connection; send a test email to yourself; Register webhook then use Resend's "Send test event" and watch Last event update; verify one domain in a test workspace; send one test message from it to your own address.

Plan allowances (monthly per category, optional daily, 70/90/100 warning points, hard stop, top-ups) are edited in Super Admin > Plans; nothing is preset and a plan without an allowance cannot send tenant email.

## Usage by plan and workspace
`GET /api/platform/email/summary` also returns `by_plan` and `workspaces` (`usageByPlan` in `services/tenantEmail.js`): used vs allowance per category for each workspace's CURRENT period, and the same summed per plan. Periods start on each workspace's own anchor day, so plan totals mix periods. Unmetered workspaces are listed but add nothing to totals; used mail with no allowance set is shown separately. Counts only; no recipients or content.

## Billing mail (v1.31)
* **Sender:** all `billing` / `billing_notice` mail (receipts, payment confirmation/rejection, renewal and trial notices) is sent from `Agentify ERP Billing <billing@agentifyerp.co>` with Reply-To `billing@agentifyerp.co`. Override the address with the console setting `billing_mail_address` or env `BILLING_MAIL_ADDRESS`. The domain must be verified at Resend (agentifyerp.co already is).
* **Receipt:** one per payment, headed "Payment received successfully", with amount, currency, plan, date, method, reference and paid-until, ending "Have a question? Mail us at billing@agentifyerp.co". Triggered by approving a customer-submitted transfer, recording a manual payment, a gateway payment confirmed by the provider, and a paid Stripe invoice (amount above zero). Idempotent through `billing_receipts.receipt_key` (`local:<submission id>`, `invoice:<provider>:<invoice id>`): retried webhooks and double clicks send nothing more. No keys, links or card data are included.
* **Console:** Billing & Payments > Billing mail & receipts lists receipts (sent / not sent, with the reason) and can re-send one; it also shows whether the billing@ inbox exists and can create it (Resend `POST /inboxes`, unverified against a live account).
* **Inbox:** billing@ must be a Resend inbox on a domain that receives mail (like hello@ and admin@). Once it exists, it appears in Mailbox (Platform Owner / Super Admin) with read, reply and forward. Nothing else is needed in DNS because agentifyerp.co already receives mail at Resend.

## Tenant billing documents (v1.33)
Settings > Plan & Billing (workspace admins):
* **Payment history:** every bank/wallet/gateway submission (waiting, paid, not accepted + reason) and every card invoice. Source: `payment_submissions` + `invoices`.
* **Statement** (`GET /api/billing/statement?format=pdf|csv&from=&to=`): invoices as charges, paid invoices as payments, refunds. Balance due = charges - payments; Net paid = payments - refunds. Both run from the first record, so a date range shows correct opening figures. Pending/rejected transfers are not counted. CSV cells starting with `= + - @` are prefixed with `'` (spreadsheet formula safety).
* **Receipt PDF** (`GET /api/billing/invoices/:id/pdf`) for any own invoice, issued as Agentify ERP. No tax is calculated, so it says "Receipt", not "tax invoice".
* **Proof of payment** (`POST /api/billing/payments/:id/proof`, field `file`): PNG/JPG/WEBP/PDF up to 5 MB, type checked from the file's first bytes, only while the payment is pending, stored at `data/billing-proofs/<workspace id>/<random>`. Readable by that workspace (`GET .../proof`) and by billing staff in the console (`GET /api/platform/admin/payments/:id/proof`, shown as a link on Payment approvals). Served inline with `nosniff`, a sandbox CSP and `no-store`. Back up `data/billing-proofs` with the database.
