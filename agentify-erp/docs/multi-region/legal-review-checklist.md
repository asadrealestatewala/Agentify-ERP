# Legal and professional review checklist

Every rule below will ship as **editable data** with `needs_legal_review = true`. None is authoritative: rates, thresholds, deadlines and legal text change, and each must be verified by a qualified local professional (lawyer, tax adviser, licensed broker or compliance officer) before a customer relies on it. This list starts from the requirements in the brief and will be completed as each pack is built; every new rule row must add a line here. Nothing in the product should say it "complies with" any regulation.

Status legend: `open` (not yet implemented), `draft` (implemented as editable data), `verified` (reviewed by a professional, with name and date).

## All regions
| Rule / content | Status | Reviewer |
|---|---|---|
| Privacy: data-subject export/delete flows and retention periods per region (CCPA/state laws, PIPEDA, UK GDPR, UAE PDPL) | open | |
| Marketing consent wording and records (TCPA/DNC, CAN-SPAM, CASL, PECR, UAE rules) | open | |
| Identifier handling (SSN last-4, SIN, NI number, Emirates ID, national IDs): what may be stored and for how long | open | |
| All seeded template texts (contracts, offer letters, disclosures, receipts, invoices) | open | |
| Data residency approach and customer-facing statements | open | |

## United States
| Rule / content | Status | Reviewer |
|---|---|---|
| State license number formats, expiry rules and renewal reminders | open | |
| Commission split/cap models and team splits; referral-fee limits (RESPA) | open | |
| Contingency and earnest-money deadline defaults; escrow/closing steps by state | open | |
| Lead-based paint disclosure (pre-1978) and state-specific disclosure packages | open | |
| Fair Housing wording guardrails for listings and marketing templates | open | |
| TCPA/DNC and CAN-SPAM consent text; ESIGN/UETA e-sign records | open | |
| 1099-NEC / 1099 reporting thresholds and export format | open | |
| Mortgage types, PMI, LTV and DTI defaults; pre-approval letter wording | open | |
| Construction: AIA G702/G703 field mapping, retainage limits by state, lien waiver forms, preliminary-notice and lien deadlines by state, prevailing-wage options, OSHA log fields, COI minimums | open | |

## Canada
| Rule / content | Status | Reviewer |
|---|---|---|
| GST/HST/PST/QST rates and rules by province; effective dates | open | |
| Land transfer tax brackets (provincial and municipal); first-time buyer and new-housing rebates; speculation/vacancy/non-resident taxes | open | |
| Provincial regulator license tracking (RECO, BCFSA, OACIQ and others) | open | |
| Dual agency and representation disclosure wording; Quebec notary workflow and French-language requirements | open | |
| FINTRAC identity verification, large-transaction reporting and record retention | open | |
| PIPEDA and CASL consent text and record keeping | open | |
| Mortgage types: insured vs uninsured thresholds, amortisation limits, stress-test rate and qualification rules | open | |
| Construction: provincial lien act holdback percentages, release dates and prompt-payment timelines, WSIB/WCB clearance, new-home warranty enrolment, CCDC contract types | open | |

## United Kingdom
| Rule / content | Status | Reviewer |
|---|---|---|
| SDLT, LBTT and LTT bands, surcharges, first-time-buyer relief; effective dates by nation | open | |
| VAT treatment of fees; Client Money Protection and client-account rules | open | |
| Sales process variants: England/Wales/NI vs Scotland (offers, Home Report) | open | |
| Lettings: tenancy law by nation, deposit protection schemes and deadlines, Right to Rent checks, EPC/Gas Safe/EICR/smoke-CO requirements and expiry rules | open | |
| HMRC AML supervision records; redress scheme; UK GDPR and PECR text | open | |
| FCA-regulated mortgage introducer disclosures; mortgage product types; Lifetime ISA use | open | |
| Construction: CIS deductions and returns, VAT domestic reverse charge, retention, CDM 2015 documents, Building Regulations stages, Building Safety Act documents, warranty bodies | open | |

## United Arab Emirates
| Rule / content | Status | Reviewer |
|---|---|---|
| RERA/DLD and ADREC broker and agent card (ORN/BRN) tracking; Trakheesi advertising permit format and display requirements | open | |
| Form A/B/F agreements and MoU templates; Arabic/English wording | open | |
| DLD/transfer fees, registration fees, brokerage commission norms; 5% VAT on commission | open | |
| Off-plan: Oqood registration steps, escrow milestone rules, post-handover payment plans, SPA content | open | |
| Secondary sales: NOC, manager's cheque and transfer-day workflow by emirate | open | |
| Rentals: Ejari steps, rent-increase rules, PDC handling, deposit norms, service-charge rules | open | |
| AML/CFT: customer due diligence, PEP and sanctions screening, goAML report content and thresholds | open | |
| UAE PDPL consent and retention; Golden Visa property-value eligibility thresholds | open | |
| Mortgage: Islamic products (Murabaha, Ijara, Diminishing Musharaka) wording; LTV caps by resident status and price band | open | |
| Construction: authority permits and NOCs by emirate, escrow milestone and inspection certificates, defect-liability periods, bank guarantee types | open | |

## Pakistan (preserved behaviour)
| Rule / content | Status | Reviewer |
|---|---|---|
| Existing receipt, voucher and statement wording and terms (unchanged; customer-editable) | open | |
| Any future tax feature (none exists today) | n/a | |

## Mortgage and financing module (Phase 3)

- [ ] **Referral fees.** The app only records a referral fee after the user ticks that it was disclosed to the customer, and only marks it received once the loan is funded. Whether a fee may be taken at all, and what disclosure is required, differs by country and state (for example US RESPA/Section 8, UK FCA mortgage-intermediary rules, Canadian provincial brokerage law, UAE Central Bank rules). A lawyer must confirm the rule for each region before the `mortgage` switch is turned on there.
- [ ] **Calculators are estimates.** Payment, amortisation and affordability results are illustrative. Canadian fixed-rate mortgages use semi-annual compounding (set `mortgage_compounding` in the pack); other regions use monthly. Confirm each region's quoting conventions and required wording.
- [ ] **Financial advice.** Screens say the figures are estimates and that a lender decides. Confirm the wording is acceptable and that the product does not need a licence in any region.
- [ ] **Personal financial data.** Finance profiles hold income, debts and credit band. Confirm retention and access rules per region (the privacy tooling phase covers deletion and export).

## Document templates and compliance checklists (Phase 4)

- [ ] **Starter templates** (offer, agency agreement) in each pack are generic sample wording, flagged `needs_legal_review`, and every render shows a notice to that effect. A licensed professional per region must review or replace them before the `templates` switch is turned on.
- [ ] **Starter checklists** (US purchase, UK sale progression, Canada purchase, UAE sale) are prompts for a broker's own process, not a statement of what the law requires. Confirm each item list, and which items must be required, per region and sub-region.
- [ ] Edits to a template create a new version and reset it to "needs review".

## Privacy export and erasure (Phase 5)

- [ ] **What erasure removes and keeps.** Erasing a contact removes personal details, notes, tasks, documents (and files), identity numbers, region fields and finance profile, and signs out and disables any portal login. Sales, receipts and accounting entries are kept, detached from the person's name. Confirm per region (GDPR/UK GDPR, CCPA/CPRA, PIPEDA and Quebec Law 25, UAE PDPL, Pakistan) what must be erased, what must be kept, and the response deadlines.
- [ ] **Backups.** Erased data may remain in backups until they expire. State this in the privacy policy.
- [ ] **Export contents.** The export never includes full identity numbers (only masked). Confirm that satisfies access requests.

- [ ] **Website assistant country knowledge** (`shared/countryKnowledge.js`, PK/US/UK/AE/CA): general descriptions of process, typical taxes and fees, documents and renting. Written from general knowledge, not from legal sources; every answer carries a not-advice caveat. A qualified local professional per country should check each entry, and rates or thresholds that have changed must be corrected or removed.
