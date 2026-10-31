# Developer partner portal (Pakistan joint-venture inventory): design

Status: DRAFT for the owner's review. Nothing here is built. Merging to `main` deploys to production, so each phase ships as a draft PR and waits for an explicit yes.

## 1. What the owner asked for

Pakistani tenants sell two kinds of stock.

* **Company-owned plots and houses.** The existing flow. Developers have nothing to do with them. Nothing in this design changes them.
* **Developer (joint-venture) inventory.** The company does not buy the land. It has a contract with a developer to sell the developer's plots. The developer receives the customer's money directly (so the company carries no liability for annual filing and tax on those receipts), approves each payment, and pays the company a commission/rebate at each stage. Defaults and cancellations are handled by the company taking the file over and reselling it.

## 2. What already exists (reuse, do not rebuild)

| Need | Existing piece | Where |
| --- | --- | --- |
| Plots, size, unit, photos | `properties` (`area_size`, `unit`, `plot_no`, `project_id`), `media` | `server/src/schema.js` |
| Booking, installments, balloon | `sales` + `installments` (`booking`, `advance`, `installment`, `balloon`), `planSchedule`, `createSale` | `services/sales.js` |
| Customer ledger, receipts | `customerLedger`, `receivePayment`, `receipt_allocations`, `receipt_sales` | `services/payments.js` |
| "Customer says I paid, finance verifies" | `payment_claims` (pending, verifying, paid/rejected), proof slip upload, txn-id matching | `services/claims.js`, `routes/portal.js` |
| Journal engine | `postJournal`, `reverseJournal`, chart of accounts | `services/accounting.js`, `seed.js` |
| Agent commission (a different thing) | `commission_rules`, `commissions`, account 5700/2300 | `services/commissions.js` |
| A second portal login type | Vendor portal: `users.vendor_id`, role `Vendor` (`portal=1`), `requireVendor`, `notifyVendor` | `rbac.js`, `services/vendorAccount.js`, `routes/vendorPortal.js` |
| Cancel a sale | `cancelSale` (blocks while valid receipts exist; reverses the journal) | `services/sales.js` |
| Audit trail, notifications | `audit_log`, `audit()`, `notify()` | `audit.js` |
| Developer name | only free text `projects.developer` | `schema.js` |

Two gaps matter. There is no developer entity, and `cancelSale` refuses to cancel a sale that has receipts, so the cancellation/takeover flow needs its own path. Agent commission (company pays its own sales agent) is unrelated to developer rebate (developer pays the company); the two must never share a table or account, only the screens may sit near each other.

## 3. Concepts and vocabulary

* **Developer**: the partner who owns the land. A new entity with its own portal login.
* **Agreement**: the company-developer contract: per-sqft or per-plot rates, rebate rates per stage, default cancellation window and deduction schedule.
* **Developer file**: a plot sold to a customer under an agreement. It is an ordinary `sales` row with developer fields attached, so installments, ledger and receipts keep working.
* **Rebate**: money the developer owes the company on each verified customer payment (stage = down payment / booking, installment, balloon).
* **Takeover**: after a cancellation the file's holder becomes the company. The developer sees the company's name where the customer's name was.
* **Resale**: the company sells the taken-over file to a new customer at a revised price.

## 4. Data model (all additive, all `IF NOT EXISTS` / `addCol`, so existing tenants migrate safely)

New tables, created in a new `developerSchema.js` the way `constructionSchema.js` is.

```
developers(id, name, company, phone, email, ntn, address, bank_details, status, notes, created_at)
developer_agreements(id, developer_id, project_id NULL, title,
  pricing_basis            -- 'per_sqft' | 'per_plot'
  developer_rate, company_rate,             -- e.g. per sqft; informational + rebate basis if rebate_basis='spread'
  rebate_basis             -- 'percent_of_payment' | 'spread'
  rebate_down_pct, rebate_installment_pct, rebate_balloon_pct,
  cancel_window_days, cancel_tiers JSON,    -- e.g. [{"to_day":90,"pct":20},{"to_day":180,"pct":15},{"pct":10}]
  effective_from, effective_to, status, document_path, created_at)
developer_collections(id, sale_id, installment_ids JSON, amount, method, txn_id, bank, paid_date,
  proof_path, reported_by_user, reported_via,   -- 'customer_portal' | 'staff' | 'developer'
  status,                  -- 'awaiting_developer' | 'approved' | 'rejected' | 'cancelled'
  decided_by_user, decided_at, reject_reason, receipt_id, created_at)
developer_rebates(id, developer_id, sale_id, collection_id, stage, base_amount, rate, amount,
  status,                  -- 'due' | 'received' | 'waived' | 'reversed'
  recognised_journal_id, received_journal_id, received_on, received_method, reference_no, created_at)
file_events(id, sale_id, event, from_state, to_state, actor_user, actor_role, amount, note, created_at)
file_transfers(id, original_sale_id, new_sale_id, paid_at_cancel, deduction_pct, deduction_amount,
  refund_amount, developer_balance_after, resale_price, created_at)
```

Existing tables, new nullable columns:

* `properties`: `inventory_source` (`own` default | `developer`), `developer_id`, `agreement_id`, `registration_no`. Area in sqft is always derived from `area_size` + `unit` through the region pack (marla/kanal ratios are config-driven, not hard-coded).
* `sales`: `developer_id`, `agreement_id`, `booking_id` (auto, e.g. `BK-00042`, from `nextNo`), `file_state`, `cancel_window_until`, `cancel_deduction_pct` (snapshot of the agreement at booking so later agreement edits never rewrite history), `holder` (`customer` | `company`), `previous_sale_id` (resale chain).
* `users`: `developer_id` (like `vendor_id`). New system role **Developer**, `portal=1`, no staff permissions.

## 5. Roles, permissions, field-level hiding

* New staff module `developers` with the usual actions (`view`, `create`, `edit`, `approve`, `export`). `approve` is for company-side overrides and rebate confirmation.
* The **Developer** role is a portal role. A new `requireDeveloper` middleware mirrors `requireVendor`. Every query is scoped by `developer_id` taken from the session, never from the request.
* Developer-facing API returns only **allow-listed fields** built by one serializer function (`toDeveloperFile`), not `SELECT *` and not the generic sale/contact serializers. Visible: booking date, `booking_id`, registration number, plot size in marla/kanal and sqft, plot no/block, photos, customer **display name**, payments (amount, stage, date, method, status), outstanding, file state. **Never sent**: CNIC, phone, email, address, WhatsApp, agent, internal notes, lead history, company-side margins, the company's other developers' data. A test walks the whole developer API response for any key or value matching the contact's CNIC/phone to prove nothing leaks.
* After takeover the serializer substitutes the company name for the customer name (and, if the owner wants, hides the resale customer's name; see question 9).
* Customer portal and company staff views are unchanged except for a read-only "Developer file" block.

## 6. Payment approval flow

```
 customer pays the DEVELOPER (bank / JazzCash / cash at developer office)
        │ reported by: customer portal, staff, or developer
        ▼
 developer_collections: awaiting_developer   ── developer is notified, sees amount, method, txn id, proof
        │ developer checks their own bank/cash
        ├── Approve → status approved → one DB transaction:
        │       1. allocate to installments (existing `allocate`/`applyAllocation`)
        │       2. update sales.paid_amount, customer ledger, receipt record
        │       3. post pass-through journal (section 7)
        │       4. create developer_rebate row (stage by installment kind) and post rebate income
        │       5. notify customer, agent, finance
        └── Reject (reason required) → customer and staff are told; nothing is posted
```

Rules: the company cannot post a developer-collected payment as received without the developer's approval (finance can chase, not override; an override, if the owner wants one, needs the `approve` permission and is flagged in the audit log). Same transaction id and amount cannot be approved twice (reuse the `txn_id` uniqueness guard and `payment_feed` matching). A developer may also add a payment themselves (walk-in cash); it is approved by definition but staff are notified. Reversal of an approved payment is a developer-initiated request that finance confirms (void the receipt, reverse journals and rebate).

## 7. Accounting: pass-through is not revenue

Principle: money that belongs to the developer never reaches the company's income statement. Revenue is only the rebate and the cancellation deduction (and the resale gain).

New accounts (added by a tenant migration, the same way `5800` was added): `1350 Developer Rebate Receivable`, `2610 Developer Clearing (customer contracts)`, `2620 Developer Payable (taken-over files)`, `1450 Resale File Inventory`, `4500 Developer Rebate Income`, `4510 Cancellation Deduction Income`, `5150`-style cost-of-sale account for resale files (exact codes chosen at build time to avoid clashes).

| Event | Debit | Credit | P&L effect |
| --- | --- | --- | --- |
| Developer file booked at price C | 1300 Customer receivable C | 2610 Developer clearing C | none |
| Developer approves customer payment X | 2610 Developer clearing X | 1300 Customer receivable X | none (no cash touches the company) |
| Rebate R on that payment | 1350 Rebate receivable R | 4500 Rebate income R | **revenue R** |
| Developer pays the rebate | Bank R | 1350 Rebate receivable R | none |
| Customer A cancels: paid P, deduction D (% of down payment), refund P-D, remaining O = C-P | 2610 Clearing O; 1450 File inventory C | 1300 Receivable O; Cash/Bank P-D; 4510 Deduction income D; 2620 Developer payable O | **revenue D** |
| Company pays developer an installment y | 2620 Developer payable y | Bank y | none |
| Resale to B at price C2 | 1300 Receivable C2 | Property sales C2 | revenue C2 |
| Cost of the resold file | Cost of sales C | 1450 File inventory C | cost C, so gain = C2 - C |
| B pays the company | Bank | 1300 Receivable | none |

Checks the build will test: every journal balances; clearing account 2610 returns to zero when a file completes; a file's revenue is exactly rebates + deduction + (resale price - file cost); developer payables never appear in revenue. This is a proposal for the owner's accountant to confirm (question 11). Rebate recognition timing (when the payment is approved, or when the developer actually pays) is a policy choice (question 5).

## 8. Cancellation, takeover and resale state machine

```
booked ──► active ──► completed ──► transferred (to customer)
              │
              └─ cancellation requested (only after cancel_window_days, or as the agreement says)
                      ▼
                 under review (finance: deduction %, refund amount shown for approval)
                      ▼ approve
                 cancelled & taken over  (holder = company; developer sees company name)
                      │  company keeps paying the developer the original schedule
                      ▼
                 listed for resale ──► resold (new sale B, previous_sale_id = A)
                                              ▼
                                   B pays the company; company pays the developer
                                              ▼
                                   completed ──► transferred (to B)
```

* Cancellation is a guarded transition: needs a reason, shows `P`, `D`, `P-D` and the new developer balance before confirm, and writes a `file_events` row and an `audit_log` row.
* The deduction is the snapshot % applied to the **down payment** (as the owner described; whether installments paid are refunded in full is question 7). It is read from the snapshot taken at booking; finance can change it for one file only with the `approve` permission and a reason.
* The refund `P-D` is paid by the company (a normal outgoing payment against account 1300/2200 handling, to be designed with the existing `Refund` payment type).
* The resale price must be at least the cost basis unless a user with `approve` confirms a loss.
* Transfer to the final owner (the plot registered in their name) is a manual, dated step after the developer confirms it is fully paid.
* Edge cases handled in the design: cancellation while a claim is `awaiting_developer`; cancelling a file with a partially paid installment; the developer disputing a takeover; the resale customer defaulting too (the chain simply repeats, `previous_sale_id` links the history).

## 9. Notifications and audit

* Developer is notified of every new payment waiting for approval, every cancellation/takeover, every resale transfer and every rebate statement. Reuse `notify()` (in-app plus push) and the branded email templates; no proof or payment text goes to the developer by default over WhatsApp.
* Everything that changes money or ownership writes `audit_log` and `file_events` with actor, role and old/new state. Developer approvals record user, time and IP.

## 10. Screens

Company side (ERP):
1. **Developers**: list, profile, agreements, files, rebate statement, payables.
2. **Property form**: `Source: Own / Developer`, developer, agreement, registration number, sqft shown beside marla/kanal.
3. **New sale**: when the property is developer inventory, show the agreement summary, auto `booking_id`, cancellation window and deduction snapshot.
4. **Developer collections**: payments awaiting the developer, with age and a reminder button.
5. **Rebates**: per customer, per stage, per developer; due, received, outstanding; export.
6. **File actions**: cancel (with calculation preview), take over, resell, transfer.
7. **Reports**: developer payables, rebate income, deduction income, resale gains, files by state.

Developer portal (mobile-first, brand teal, SVG icons, no emoji):
1. **Dashboard**: files by state, payments awaiting my approval, rebate due this month.
2. **My files**: list and detail (plot facts, photos, customer display name, schedule, payment history).
3. **Approve payments**: proof viewer, approve, reject with reason.
4. **Rebates**: what I owe the company by customer and stage, and what I have paid.
5. **Statement** download (PDF/Excel, existing export helpers).

## 11. Delivery plan (every phase a draft PR, no merge without the owner's yes)

1. **Foundation**: developers, agreements, property/sale columns, booking ID, accounts migration, staff screens, tests, region-pack unit helpers.
2. **Developer portal (read-only)**: role, scoped API, allow-listed serializer, leak test, files list/detail.
3. **Payments and rebates**: collections, approval, posting, rebate ledger, statements.
4. **Cancellation, takeover, resale, transfer**: state machine, calculations, journals, developer view changes.
5. **Reports, notifications, PDFs, polish**, plus What's new entry per CLAUDE.md release rules.

Each phase includes server tests (journals balance, permissions, no PII leak, tenant isolation) and a browser check before it is called done.

## 12. Assumptions (flagged so the owner can correct them)

* The developer receives the customer's gross payment; the company's income from that file is the rebate only.
* Rebate is a configurable percentage per stage (down payment, installment, balloon) set per agreement; it can alternatively be the spread between the two per-sqft rates.
* A developer is a separate company with its own login; one developer can have many agreements and many projects.
* The company-developer rates are agreement data and are never hard-coded; the numbers in the original message look like typos and are not used (question 1).
* Marla and kanal sizes come from the region pack (a Punjab marla is 272.25 sqft, a kanal is 20 marla); a tenant in a city with a different marla size sets it once.
* After takeover the original schedule's amounts and dates continue to be paid by the company to the developer.
* Currency PKR, whole rupees, matching the existing ledger.
* Tax, withholding and legal treatment are not decided here and need professional review (question 11).

## 13. Questions the owner must answer

1. **The example numbers.** A 5 marla plot is about 1,361 sqft (at 272.25 sqft per marla). At 1,000/sqft that is about 13.6 lakh and at 1,500/sqft about 20.4 lakh, so "2500k" and "300k" in the message cannot both be right. What are real figures for one plot (developer rate, company sale rate, down payment, installments)?
2. **How the company earns.** Is the company's income the percentage rebate the developer pays on each payment, or the spread between 1,000 and 1,500 per sqft, or both? Can the rate differ for down payment, installment and balloon?
3. **Who holds which price.** The customer pays the developer the full 1,500/sqft price and the developer pays the company back its rebate. Is that right, or does the developer keep only 1,000/sqft and the company keeps the rest?
4. **Who records a customer payment.** The customer in their portal, the sales agent, the developer, or any of these? Is a payment proof (slip, screenshot) mandatory? Does the developer have a time limit to approve, and what happens if they do not?
5. **When rebate counts as company income.** When the developer approves the payment, or when the developer actually pays the rebate? How does the developer pay it (cash, bank, deducted from something)?
6. **The cancellation window and deduction.** Is "after 3 months" the earliest a customer may cancel, or the period after which the deduction % changes? Please give the real tiers (for example 20% up to 3 months, 15% to 6 months, 10% after). Set per file at booking, or per developer agreement?
7. **What is refunded.** The deduction is a percentage of the down payment only. Are installments the customer paid refunded in full? The refund is paid by the company, how soon after approval?
8. **After takeover.** Does the company pay the developer the same original amounts on the same dates? Does the developer still pay the company a rebate on those payments?
9. **What the developer sees after resale.** Only the company name until the new customer finishes paying, or the new customer's name from the start?
10. **Resale price.** Typed by finance per file, or a rule (for example current rate per sqft)? Must a human approve a resale below the cost?
11. **Legal and tax.** Which taxes and withholding apply (FBR, advance tax on property, the developer's NTN), and is an accountant or lawyer reviewing the agreement and the accounting in section 7 before this goes live?
12. **Receipts and messages.** Who issues the receipt to the customer, the developer or the company? Which notifications should the developer get (in-app, email, WhatsApp)?
13. **Scope.** Which tenant uses this first, how many developers do they have, and is any existing developer stock already in the system that should be converted?
