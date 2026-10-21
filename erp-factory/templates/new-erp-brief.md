# New ERP brief — <Client name>

> Copy to `<project>/docs/BRIEF.md`. Answer what you know; write assumptions as **ASSUMED:** and keep going. Claude Code reads this before Phase 1.

## 1. Company
- Legal / trading name:
- Industry & what they sell (goods / services / contracts / subscriptions):
- Size: staff count · branches · expected concurrent users:
- Countries, languages (RTL needed? y/n):

## 2. Locale & compliance
- Currency (code, minor units?) · timezone · date format:
- National ID / tax numbers captured (CNIC, NTN, GST, VAT…) and where they must print:
- Fiscal year start · tax lines on documents:

## 3. Tenancy
- [ ] Single company (own install)   [ ] Multi-tenant SaaS (plans, billing, platform console)
- If SaaS: plan names/limits · billing provider (manual / Stripe / local methods) · custom domains?

## 4. People & access
| Identity class | Who | Own-scope rows? | Portal? |
|---|---|---|---|
| Staff roles (list) | | | |
| Customers / clients | | — | y/n |
| Vendors / suppliers | | — | y/n |
| Agents / reps | | y | |

Approvals needed (who approves what, thresholds):

## 5. Money flows (write each as "X → Dr … / Cr …" if you can)
- Revenue event(s):
- Collection event(s) (cash, bank, wallet, cheque, gateway):
- Purchase / expense event(s) and approval chain:
- Payroll / commissions:
- Assets / inventory valuation:
- Chart-of-accounts specifics (existing COA to import?):

## 6. Modules (tick from `erp-factory/modules/40-module-catalog.md`)
CRM · Sales/Orders · Receipts · Expenses · Vendors · Tenders · HR · Payroll · Assets · Projects/Cost centres · Inventory (vertical) · Portal(s) · Website/CMS · Content calendar · Assistant · Reports (list the 10 they care about):

## 7. Integrations
Website sync · bank/wallet feed · WhatsApp · email (provider) · SMS · payment gateway · accounting export · biometric attendance · other:

## 8. Brand
- Name as shown in the app · logo files · default accent (one of blue/teal/violet/rose/amber/green or a hex) · document letterhead text · fonts if mandated:

## 9. Data
- Existing system / spreadsheets to import (entities, row counts):
- Demo data wanted for training? y/n

## 10. Success criteria
- The three demos that must work on go-live day:
- Reports the owner opens every morning:
- Deadline / phases:
