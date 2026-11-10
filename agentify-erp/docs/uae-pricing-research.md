# UAE pricing: competitor research and the AED plan ladder (v1.91)

Researched 2026-11-10 from public web pages. **Almost every price below comes from vendor-run comparison pages and blogs, not from the vendors' own price lists, and they disagree with each other.** Treat every number as indicative and re-check the vendor's own page before quoting a competitor anywhere. We make no claims about competitors on the site.

## What UAE real-estate software costs (reported figures)

| Product | What it is | Reported price (AED) | Notes |
|---|---|---|---|
| PropSpace | Brokerage CRM, portal syndication | 220 per user a month; minimum monthly invoice 500; 12-month minimum term; Property Management 11 per unit | Stated in the vendor's own guide ([PropSpace](https://www.propspace.com/blog/real-estate-crm-dubai-complete-guide)). Includes RERA forms, Property Finder API, off-plan database, optional Trakheesi permit check |
| Ruby CRM | AI real-estate CRM | 150 per user a month billed yearly, 210 monthly | Vendor page ([Ruby CRM](https://www.rubycrm.ai/)); publishes to Bayut, Property Finder, Dubizzle |
| WIYO | Real-estate CRM | 1,000 solo; 2,650 for 5 agents; 5,500 for 15; 9,900 for 50 | Vendor page ([WIYO](https://www.wiyo.ae/real-estate-crm-dubai)); the dearest published tiers |
| Propwise | CRM and agent AI | 249 a month, or 3,999 per seat a year (Pro, yearly only) | ([Propwise](https://www.propwise.com/)) |
| Mindall | CRM | 59 solo; 590 up to 10 users; from 1,190 up to 30 users | ([Mindall](https://mindall.co/en/)) |
| COM8 Realty | CRM | Free for 1 agent; 79 for up to 3 seats; team plans 99 and 149 per seat, yearly | Own comparison page ([COM8](https://www.com8.io/blog/best-real-estate-crm-dubai-uae)) |
| REM | CRM | From 99 a month by team size | ([REM](https://remcrm.ae/top-real-estate-crm-in-uae)) |
| HelloGrowthCRM, Vedain | Budget / generic CRM | About 44 and 25 per user a month | Generic CRMs, not real-estate specific; low reliability |
| Zoho CRM | General CRM | About 73 (Standard) to 145 (Enterprise) per user a month, plus 5% VAT | Reseller figures ([Cloudfy](https://cloudfysystems.com/blog/zoho-crm-pricing-uae-2026)); real-estate fit needs customising |
| Bitrix24, Salesforce | General CRM | Sources conflict (Bitrix24 about USD 69 to 124; Salesforce est. AED 3,000 to 15,000+ a month per brokerage with set-up) | Competitor blogs; unreliable |

Not found: official price lists for the Property Finder and Bayut agent tools (portal listing fees are a separate cost and are not our market).

## What the research says

* Per-user pricing dominates: **about AED 100 to 220 per user a month** for real-estate CRMs, so a 10-agent brokerage pays roughly AED 1,000 to 2,200 a month. The cheapest credible team option is about AED 590 for 10 users (Mindall).
* Most of that money buys portal syndication (Property Finder, Bayut), lead import and RERA forms. We do not yet ship live portal feeds (MLS and portal feeds are an Enterprise item) or generated RERA forms, so we price **at or below the budget team tools** and sell breadth: CRM, accounting, HRM, a free website, AI and social scheduling in one flat price.
* Flat team pricing (our ladder) is easier to explain than per-user billing, and it undercuts per-user pricing from about 5 users up.

## The AED ladder (same six plans and limits as Pakistan and the USA; only price and wording differ)

AED prices are set at about the USD price x 3.67 (the dirham is pegged), rounded to a clean ending (9s).

| Plan | Users | AED / month | 6 months | Yearly | Closest reference point |
|---|---|---|---|---|---|
| Agent Plus | 2 | 99 | 535 | 950 | REM entry 99, COM8 79 to 99 per seat; adds receipts, rentals, off-plan |
| Agency Starter | 5 | 299 | 1,615 | 2,870 | About AED 60 per user; under Ruby (750) and PropSpace (1,100) for 5; adds accounting, HRM, free website |
| Agency Growth | 10 | 549 | 2,965 | 5,270 | Just under Mindall's 10-user plan (590); a quarter of PropSpace (2,200) |
| Agency Pro | 15 | 899 | 4,855 | 8,630 | Under WIYO 15 agents (5,500) and Ruby (2,250); adds AI, social posting, lead scoring |
| Developer | 40 | 1,649 | 8,905 | 15,830 | Under Mindall 30 users (1,190+) once projects, inventory and construction are counted |
| Enterprise | unlimited | from 3,699 | | | WIYO 50 agents (9,900), Salesforce-style quotes |

Period discounts are the ladder rules: 6 months 10% off, yearly 20% off. **Add-ons (AED):** extra user 45 a month; AI top-up packs 100 / 300 / 700 credits for 55 / 145 / 290 (one-time).

## UAE specifics

* **VAT 5%.** Ladder prices are treated as tax-inclusive, like the rest of the billing code. If you want VAT shown on top, that is a billing-tax change and not part of this release. The margin settings now carry a 5% tax rate for AED. A UAE VAT registration, tax invoices and e-invoicing rules need an accountant's input.
* **Wording** lists only what exists today: RERA permit number and title deed fields, Dubai DLD transfer-cost calculator, sale, rental and off-plan listings, mortgage tracking, Bayut / Property Finder / Dubizzle as lead sources (manual sources, not live feeds), receipts, WhatsApp reminders, accounting, HRM, website, AI, Meta and social scheduling. It leaves out installments with plot rebates and the US dialer wording.
* **Arabic.** The UAE pack lists Arabic, but `client/src/locales/ar.json` has not had a native review, so the plan wording does not advertise Arabic. Add it once the review is signed off.
* **Dubai only** for DLD costs (SRS default). No other-emirate fee rules yet. UAE legal templates are samples needing legal review.
* Currency: `AED` is now a price currency (Console > Plans, add-ons, margin settings, launch offer).

## What the owner must do

1. **Stripe prices (cards).** Create a recurring AED price per plan (monthly and yearly; Enterprise is quote-only), and paste ids into the `lad_..._month_aed` and `lad_..._year_aed` slots on Console > Billing > Stripe. Until filled, a UAE workspace choosing card sees "Card payment is not configured for this plan yet"; bank transfer and gateways work. An AED card is never charged with another currency's price. The 6-month period is not sold by card. Check your Stripe account can charge AED.
2. The ladder switch is shared by all countries (Console > Plans). If it is on, AED plans appear when this release deploys, to workspaces and visitors on AED.
3. Open items: UAE legal review, Arabic review, VAT presentation, live portal feeds.
