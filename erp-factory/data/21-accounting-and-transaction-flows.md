# 21 — Accounting engine & transaction flows

Source: `services/accounting.js`, `payments.js`, `sales.js`, `expenses.js`, `commissions.js`, `schedule.js`, `seed.js COA`, `ARCHITECTURE.md §2–3`.

## The one rule

> **Nothing writes a balance.** Every financial event is a balanced double-entry journal created by `postJournal()`. Reports, ledgers, dashboards and portals are queries over `journal_lines` plus the sub-ledgers.

```js
postJournal({ date, memo, refType, refId, projectId, userId, reversalOf,
  lines: [{ account: '1300' | id, debit, credit, projectId, contactId, vendorId, saleId, memo }] })
```
Guards inside: ≥ 2 non-zero lines · no negative amounts · a line can't carry both debit and credit · **Σdebit = Σcredit or throws** · runs in `tx()` · numbers `JV-000001` · account given by **code** is resolved via a per-tenant cache (`acct(code)`), and a missing code throws "Account X is missing from the chart of accounts".

`reverseJournal(id)` posts the mirror image with `reversal_of` and refuses a second reversal. **Void = reversal; rows are never deleted.**
Opening balances are journals (`postOpening` → Dr/Cr 3100 Capital). `accountBalance`, `trialBalance({from,to,projectId})`, `assertFunds` (cash/custody can't go negative; bank/online can), `assertTreasury`.

## Chart of accounts shipped (by code)

| Code | Name | Type / subtype | Code | Name | Type |
|---|---|---|---|---|---|
| 1100 | Cash (1110 Till, 1120 Petty, 1130 Finance-manager custody) | asset / cash, custody | 3100 | Capital | equity |
| 1200 | Bank (1210 Main, 1220 Second, 1230 Online) | asset / bank, online | 3200 | Retained Earnings | equity |
| **1300** | **Accounts Receivable (Customers)** | asset / receivable | 4100 | Property Sales | income |
| 1400 | Property Inventory | asset | 4150 | Construction Contract Income | income |
| **2100** | **Vendor Payables** | liability / payable | 4200/4300/4400/4900 | Booking · Installment · Balloon · Other income | income |
| 2200 | Customer Advances | liability | 5100–5160 | Construction (bricks, cement, steel, wood, water, labour) | expense |
| 2300 | Commission Payable | liability | 5200 · 5300 · 5400 · 5500 · 5600 | Marketing · Salaries · Utilities · Transport · Office | expense |
| 2400 | Salary Payable | liability | 5700 · **5800** · 5900 | Commission Expense · Assets & Equipment Purchases · Other | expense |

Tree via `parent_id`; `is_system=1` rows can't be deleted; treasury picker = `subtype IN (cash,bank,custody,online)`; expense picker = leaf `expense` accounts. **For a new vertical, keep the codes 1xxx–3xxx and the control accounts (1300, 2100, 2200, 2300, 3100) stable and swap only the 4xxx/5xxx revenue & expense leaves.**

## Posting table (event → journal)

| Event | Debit | Credit | Extra effects |
|---|---|---|---|
| Sale confirmed (property) | 1300 Receivable (customer, sale, project) | 4100 Property Sales | installments generated, property→sold, contact→customer (`customer_code`), commission by rule, optional booking receipt, portal login, activity+audit+notify, webhook |
| Construction contract | 1300 | 4150 | same engine, `kind='construction'`, own commission rule (default 1.5%) |
| Receipt (≤ outstanding) | chosen Cash/Bank/Till | 1300 (one credit line **per sale** for split receipts) | allocation to installments (preferred kind first, oldest due first) → installment status → `sales.paid_amount` |
| Receipt excess (flagged overpayment) | Cash/Bank | 2200 Customer Advances | |
| Refund | 1300 | Cash/Bank | `payment_type='Refund'` negative share |
| Expense voucher **approved** | Expense acct (project, vendor) | 2100 Vendor Payables (vendor) | accrual at approval; asset purchase (5800) auto-creates Asset Library rows |
| Vendor payment | 2100 | Cash/Bank/Custody | `assertFunds`; voucher → partial/paid |
| Treasury transfer / custody handover | destination | source | |
| Commission approved | 5700 Commission Expense | 2300 Commission Payable | |
| Commission paid | 2300 | Cash/Bank | partial payments allowed |
| Salary paid | 5300 Salaries (net − commission part) | Cash/Bank | commission part settles approved commissions oldest-first via `payCommission`; cannot exceed approved-unpaid |
| Void receipt / cancel sale | reversal of the original | | commission cancelled, installment allocations rolled back |

Project economics: income = sales booked to the project; collections = receipts; receivable = sales − collections; expense = project-tagged expense lines (`journal_lines.project_id`).

## Transaction flows (all inside one DB transaction)

### Sale
validate customer + property state (not sold / not draft / reservation owner) → `planSchedule()` → insert `sales` → insert `installments` → property `sold` → `ensureCustomerCode` → contact→customer & stage Closed → `postJournal` → `generateCommission(pickRule)` → optional booking `receivePayment` → bundle join (`linked_sale_id`) → portal user (random 10-hex password shown once) → activity + audit + notify + website webhook.

**`planSchedule` algorithm** (shared with the website calculator via `shared/installmentPlan.js`): `net = price − discount`; `remaining = net − booking − advance`; balloons = `count × amount` must fit; `regular = remaining − balloons`; installment i due `addMonths(first_due, i)`; **last installment absorbs rounding**; balloons dated explicitly or every `balloon_interval` (default 6) months; rows sorted by date (balloon after installment on tie); `seq` assigned; fails with a plain-language message if the balance isn't covered.

### Receipt
validate method fields (online ⇒ txn id + bank; cheque ⇒ no. + bank) → amount ≤ outstanding unless flagged overpayment → `allocate()` → `receipts` + `receipt_sales` (+ `receipt_allocations`) → apply to installments (`paid`, `status`, `paid_date`) → journal → `sales.paid_amount` → activity/audit/notify (customer + finance) → QR payload for voucher verification.

### Expense
`created → submitted → approved → partial → paid` (or `rejected`). Create validates account/project/vendor/contract consistency; approve posts accrual and, for assets, files them; pay posts vendor payment; credit purchases keep `due_date` and age in the Credit Book; vendor is notified on approval/payment; WhatsApp-share prompt after approval.

### Payroll
`generate(period)` pulls approved-unpaid commission into the payslip (UNIQUE employee+period) → `Pay` splits net into commission settlement + salary journal; payslip visible to the employee only when `status='paid'`.

### Customer-reported payment (claims)
Portal shows dues with computed state `overdue | due | upcoming | in_process | verifying`; customer reports a payment (+ slip) → WhatsApp message to company number with ref `CLM-00012` → finance sets *verifying* → **approve** issues the real receipt through `receivePayment` (so the ledger moves exactly once) → or **auto-matched** when the bank/wallet feed (`POST /api/payment-feed` with `X-Feed-Key`, or statement upload) contains the same normalised txn id + amount (`UNIQUE(txn_norm, amount)`).

### Schedule intelligence (`services/schedule.js`)
Progress is **never typed**: planned % from dates; `actual_end` ⇒ complete; overdue capped at 95; forecast finish propagates through finish-to-start predecessors; project % weighted by duration × weight; status & health computed on read (nothing stored) so delays appear and clear by themselves.

## Reports available from the engine

Trial balance, income statement, balance sheet (assets = liabilities + equity + current profit check), account statement/ledger, treasury balances, project financials, customer ledger (per sale or combined bundle), vendor ledger (opening balance + date filter), agent commission ledger, receivables ageing, credit book — all exportable via `sendTable`.

## Rules for a new vertical

1. Model every money movement as a journal; if you can't name its debit and credit you don't understand the process yet.
2. Keep sub-ledgers (installments, vouchers, commissions) **and** control accounts, and add a test that proves they reconcile.
3. Put posting in a service function with `tx()`; never post from a route.
4. Void instead of delete; reverse instead of edit.
5. Approval gates sit *before* the journal (voucher approve, commission approve), not after.
6. Currency is one integer unit; multi-currency is out of scope of the reference (currency code stored in settings only).
