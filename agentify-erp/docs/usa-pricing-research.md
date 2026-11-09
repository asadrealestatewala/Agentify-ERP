# USA pricing: competitor research and the USD plan ladder (v1.90)

Researched 2026-11-09 from public web pages. **Most vendors hide prices behind a demo, and the figures below come largely from review and price-comparison sites that disagree with each other.** Treat every number as indicative and re-check the vendor's own page before quoting a competitor in marketing. We make no claims about competitors on the site.

## What US real-estate software costs (public or reported figures)

| Product | What it is | Reported price | Notes |
|---|---|---|---|
| Follow Up Boss | Agent / team CRM | Grow $69 per user a month ($58 yearly); Pro $499 a month with 10 users; Platform $1,000 a month with 30 users | Vendor page lists these; 14-day trial; calling add-on about $39 per user ([FUB](https://followupboss.com/pricing), [CloudTalk summary](https://www.cloudtalk.io/blog/follow-up-boss-pricing/)) |
| Wise Agent | Budget agent CRM | About $49 a month or $499 a year, up to 5 team members | Third-party reports ([The Close](https://theclose.com/wise-agent-crm-review-packs-a-mean-punch-for-agents-teams)) |
| Real Geeks | CRM plus IDX website, lead generation | About $299 to $399 a month for 2 users plus $250 to $500 setup; extra users about $25 | Reports disagree ([Luxury Presence](https://www.luxurypresence.com/blogs/best-real-estate-crms/)) |
| Sierra Interactive | CRM plus IDX website | About $300 to $600 a month, setup about $500 | Reported ([Luxury Presence](https://www.luxurypresence.com/blogs/sierra-interactive-pricing/)) |
| Top Producer | Agent / team CRM | About $130 to $180 a month entry; team tiers about $400 to $1,200 | Sources differ ([Luxury Presence](https://www.luxurypresence.com/blogs/top-producer-pricing/)) |
| kvCORE (Inside Real Estate) | Brokerage platform | Not published; estimates $500 to $1,800 a month | Quote only ([Luxury Presence](https://www.luxurypresence.com/?p=43348)) |
| Lofty, BoomTown | Team / brokerage CRM and lead gen | Not published; third-party estimates start around $450 a month | Quote only |
| Propertybase | Brokerage CRM | About $69 per user a month, billed yearly (G2 listing) | Unverified ([G2](https://www.g2.com/products/propertybase/pricing)) |
| LionDesk | Budget CRM | Older listings $30 to $39 | Reported discontinued as a standalone CRM in 2025; unreliable |
| Buildium / AppFolio | Property management | Buildium about $58 to $65, $183 to $202 and $375 to $420 a month; AppFolio about $1.40 to $3.20 per unit with a $280 to $300 monthly minimum | Property management is not our product ([Costbench](https://costbench.com/compare/buildium-vs-appfolio/)) |
| Buildertrend, CoConstruct | Residential construction | Last published tiers $499 / $799 / $1,099 a month; newer estimates $339 to $1,099 | Quote only now ([Projul](https://projul.com/blog/buildertrend-pricing-analysis-2026/)) |

## What the research says

* US buyers expect to pay **per user ($50 to $70) or a flat $450 to $1,000 a month for a 10-person team**. Cheapest credible solo option is about $49 a month.
* Most of that money buys **lead generation, IDX websites and dialers that we do not ship** (we have no MLS/IDX search for sale by default; MLS and portal feeds are an Enterprise item). We therefore price **below** the team CRMs and above the budget tools, and sell breadth: CRM, accounting, HRM, website, AI and social in one price.
* A flat price by team size (our existing ladder) matches how Follow Up Boss Pro and Platform are sold, and is easier to explain than per-user billing.

## The USD ladder (same six plans and limits as Pakistan; only price and wording differ)

| Plan | Users | USD / month | 6 months | Yearly | Closest reference point |
|---|---|---|---|---|---|
| Agent Plus | 2 | $29 | $157 | $278 | Below Wise Agent (about $49) |
| Agency Starter | 5 | $79 | $427 | $758 | Under Top Producer entry; adds accounting, HRM, free website |
| Agency Growth | 10 | $149 | $805 | $1,430 | A third of Follow Up Boss Pro (10 users) |
| Agency Pro | 15 | $249 | $1,345 | $2,390 | Under Real Geeks / Sierra, with AI, social posting, lead scoring |
| Developer | 40 | $449 | $2,425 | $4,310 | Under Follow Up Boss Platform ($1,000, 30 users); adds construction, projects |
| Enterprise | unlimited | from $999 | | | Quote-only competitors (kvCORE, Lofty) |

Period discounts are the existing ladder rules: 6 months 10% off, yearly 20% off. **Add-ons (USD):** extra user $12 a month; AI top-up packs 100 / 300 / 700 credits for $15 / $39 / $79 (one-time).

Trial, limits, AI credits per month, email caps and feature switches are unchanged from the Pakistan ladder. Prices are a proposal: change any of them in Console > Plans (USD column) without a release.

## How it works in the product

* The ladder plans now have USD price rows (migration `seeded_ladder_us_v1`; fills gaps only, never overwrites a price the owner set). USD add-on prices are merged into the add-on rows.
* New column `plans.regional` holds per-currency wording (`{ USD: { description, features } }`). The pricing page, landing page plans and in-app Plan and Billing show the wording for the visitor's currency. The USD wording lists only things that exist today: dialer with the workspace's own Twilio number, mortgage lender and loan tracking (US pack), receipts, WhatsApp reminders, accounting, HRM, website, AI, Meta and social scheduling, lead scoring, construction. It leaves out Pakistan-only items (installment plans, plot rebates). It is seeded from `LADDER_REGIONAL` in `services/planLadder.js`; there is no console editor for it yet.
* **Plans with no price in the visitor's currency are hidden** on the pricing and product pages and in the in-app plan chooser (a workspace always still sees its own current plan). Before this, such plans showed a dash.
* The ladder is **one switch for all countries**: Console > Plans > Switch to the plan ladder (already used for Pakistan). Once it is on, US visitors see the USD plans. If it is already on, the USD plans appear when this release deploys.

## What the owner must do

1. **Stripe prices (cards).** A Stripe price has one currency, so the ladder needs separate USD prices. In Stripe create a recurring USD price for each of the six plans (monthly and yearly; Enterprise is quote-only, skip it), then paste the ids into the new `lad_..._month_usd` and `lad_..._year_usd` slots on Console > Billing > Stripe. Until a slot is filled, a US workspace that picks card gets "Card payment is not configured for this plan yet"; bank transfer and online gateways work without it. A USD card is never charged with the Pakistan price. The 6-month period is not sold by card.
2. The launch-offer rules, coupons and tax text are unchanged. US sales tax and a US legal review are still open items from the Global Launch SRS.
3. The US go-to-market still needs a US-hosted payment account and a support channel; this change only makes the plans and prices available.
