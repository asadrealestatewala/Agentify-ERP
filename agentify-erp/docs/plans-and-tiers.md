# Plans, content tiers and the launch offer (v1.71)

Extends the existing plans system (`plans`, `plan_prices`, `services/plansStore.js`, console Plans). Nothing is a second copy.

## What was added
* `plans.allowances` (JSON) and `plans.launch_offer` (0/1): additive columns, safe for existing rows. `allowances` = `{ credits: {PKR,USD,GBP,CAD}, posts_per_day, posts_per_month, reel_seconds (8/16/24), flags {content_calendar, bulk_generator, brand_kit, listing_to_post, priority_queue} }`.
* `CURRENCIES` now PKR, USD, GBP, CAD (the old GBP/CAD placeholder price rows are used as they are).
* Three hidden plans seeded once (`seeded_content_tiers_v1`): `tier1` Small realtor, `tier2` Growth, `tier3` Pro, with the approved demo prices. They are **hidden** until the owner turns on "Visible" in Console > Plans. Existing plans and workspaces are untouched.
* Emails per month use the existing `email_limits` (tier caps 1,000 / 2,500 / 6,000 split 40% appointments, 60% campaigns). Storage uses the existing storage limit.

## Where the caps are enforced
| Cap | Where |
|---|---|
| Credits | `aiGate.creditsAllowance`: the workspace's own override, else the plan's credits in the workspace currency, else the platform default |
| Posts per day / month | `socialCalendar.capReason` reads `billingState().limits`; counts every post marked posted (Zernio or manual tick-off) |
| Reel length | `creativeJobs` (`planReelSeconds`): refuses and offers upgrade; the length picker only lists allowed lengths |
| Emails | existing tenant email metering |
| Storage | existing `assertStorageAvailable` |
| Feature flags | stored and returned in `limits.flags`; the features themselves arrive in Part 4 |

Instagram stays at 25 posts per account per 24 hours.

## Margin view (Console > Plan margins)
`services/planMargin.js`. Inputs are editable and saved in `platform_settings.margin_settings`: server, Resend (shared), object storage per GB, paying workspaces sharing fixed costs, typical use, payment fee, tax per country (prices are tax-inclusive), commission estimate, target multiple, exchange rates, credit mix. AI cost per credit comes live from `aiPricing.js`. Red = price below cost at full use; orange = below the target multiple (a Pakistan launch price in orange is allowed and blocks nothing). Commission is a cost estimate only: no tracking or payouts.

## Launch offer (Console > Launch offer)
`services/launchOffer.js`, setting `launch_offer`. Per country: discount % and months. Banner text, button text, optional end date, optional founding spots, and two switches (show days left, show spots left) that are off by default. When the offer is off, past its end date or out of spots, `publicOffer()` returns `{on:false}` and the banner, crossed-out prices and checkout discount all disappear together.
* Billing: `commerce.quote()` adds a `launch_offer` line for monthly billing of plans flagged `launch_offer`, for the first N paid periods. Workspaces whose first paid invoice came before the offer was switched on keep their price. Month N+1 is the normal price.
* Manual (bank/wallet) and online gateway checkouts use `quote()`. **Stripe card checkout uses fixed Stripe prices and does not apply the launch price** (it would need a Stripe coupon); keep card checkout off for launch-offer plans or add a Stripe coupon first.
* Landing page: `OfferBar` and `PriceBlock` in `client/src/marketing/Marketing.jsx` read `offer` from `/api/platform/marketing`. The country switcher and detection already existed; the offer follows the chosen country's currency.

## Zernio
Default billing mode is now `workspace`: each workspace connects its own Zernio account and pays Zernio directly. Zernio is not in plan costs or the margin view and there are no per-tier account limits.

## The Pakistan plan ladder (v1.72, six tiers since v1.89)
Seeded once as **hidden** plans (`seeded_ladder_v1`, `services/planLadder.js`). Nothing public changes until the owner uses **Console > Plans > Switch to the 7-tier ladder**, which puts the 7 plans on sale and takes every other public plan off sale (subscribers keep their plan and can renew; nothing is deleted). Switching off restores the previous sale page exactly.

| Tier | Plan id | PKR / month | Users | Adds |
|---|---|---|---|---|
| 1 Agent Plus (entry) | `lad_agent_plus` | 1,500 | 2 | listings, leads, CRM, installments, receipts, WhatsApp reminders, Android + installable desktop app (offline queue for notes, tasks, leads) |
| 2 Agency Starter | `lad_agency_starter` | 5,000 | 5 | vouchers/accounting, reports, HRM, free website-only site |
| 3 Agency Growth | `lad_agency_growth` | 12,000 | 10 | visual website, custom domain, property visits, field-location sharing, tenant email, AI (150 credits/month), content calendar |
| 4 Agency Pro | `lad_agency_pro` | 18,000 | 15 | AI 500 credits, Creative Studio reels to 16 s, Meta (Facebook/Instagram) connection, social scheduler + Zernio posting, **lead scoring + follow-up queue** |
| 5 Developer | `lad_developer` | 35,000 | 40 | developer portal, plot rebates, projects/inventory, construction (bundle), 1,200 credits, assisted migration |
| 6 Enterprise (from) | `lad_enterprise` | 85,000 | unlimited | branches, API + MLS/portal feeds, white-label, dedicated database, 2FA enforcement, priority support |

**Billing periods.** `month`, `half` (6 months, 10% off) and `year` (20% off). `INTERVALS` in `plans.js` is the one list; `plan_prices` was rebuilt once to allow `half`. Stripe card checkout still sells month and year only; the 6-month period is for bank, wallet and online-gateway payments.

**Add-ons.** `extra_user` (+1 seat, PKR 700/month; 3,780 per 6 months; 6,720 per year, quantity 1-1000). AI top-up packs `ai_topup_100/300/700` (PKR 3,000 / 8,000 / 16,000): one-time, added to the current month's credits when the payment is approved, never recurring and not counted in MRR (carried as the one-time amount of the payment).

**Feature switches.** `FEATURE_GATES` in `plans.js` lists each switchable feature and the API paths it owns. A plan turns a feature off with `allowances.flags.<feature> = false`; `billingGuard` then answers 402 `feature_not_in_plan`. A feature a plan never mentions stays on, so every older plan and trial keeps everything. `project_inventory` blocks writes only, so project dropdowns elsewhere still read. Edit the switches in the plan editor (Plan features).

**Not built, promise only (flag + wording, no code behind it):** branches, white-label, dedicated database, 2FA enforcement for all staff, priority support, assisted migration. They are marked `service` in `FEATURE_GATES`.

**Prices are PKR only.** Other currencies have no ladder price, so switch the ladder on for Pakistan first. Credits and the margin view are proposals the owner tunes (Console > Plan margins includes the ladder).

**v1.89 migration (`seeded_ladder_v2`).** Solo Agent (`lad_solo_agent`) is retired: hidden and off sale, its workspaces move to Agent Plus (they keep the price they already pay). Agent Plus is now PKR 1,500 and Agency Starter PKR 5,000 (new price rows; subscribers keep their price). New feature switch `hrm` (Agency Starter and up); the `social_posting` switch now also covers the Meta/LinkedIn/TikTok connect paths. Apps: there is an Android app and an installable web app for desktop; no native desktop installer exists.
