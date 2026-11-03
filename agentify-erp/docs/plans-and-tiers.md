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
