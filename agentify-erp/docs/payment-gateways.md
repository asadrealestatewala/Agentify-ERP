# Online payment gateways (customer portal)

Each workspace connects its own merchant accounts in **Settings > Payment gateways**. Customers then see "Pay online with ..." in **Portal > Payments > Pay now**.

| Provider | Status | Notes |
|---|---|---|
| Stripe | adapter built, mock-tested only | Hosted Checkout. Webhook event `checkout.session.completed`, signature checked. |
| PayPal | adapter built, mock-tested only | Orders v2, captured server-side. Not offered for currencies PayPal cannot charge (e.g. PKR). Optional webhook id. |
| Tap Payments | adapter built, mock-tested only | Charges API; the webhook body is only a pointer, the charge is re-read from Tap. |
| PayPro (Easypaisa, JazzCash, NayaPay, SadaPay) | placeholder | Needs the merchant account and PayPro API documents. |
| Payoneer | placeholder | Same. |
| Bank accounts / wallets | existing | Settings > Payment methods + "I have paid" with a slip; staff confirm (Payments > Claims). |

## Money safety
* Amount is computed on the server from the selected installments (the browser amount is ignored).
* The browser redirect and the webhook never mark anything paid. They only prompt `settle()`, which asks the provider for the result and requires the same currency and amount before posting a receipt.
* Idempotent: atomic status claim, `pay_events` table, unique receipt `txn_id` (`<provider>:<payment ref>`).
* Test mode never creates receipts. Live mode needs a live key (key prefix is checked against the chosen mode).
* Keys are encrypted with `ERP_SECRETS_KEY` (table `tenant_integrations`, provider `pay_<id>`) and never returned; the screen shows the last 4 characters.
* Everything is audited; a paid-but-unpostable checkout becomes `needs_review` and finance is notified.

## Adding a provider
Add one object to `server/src/gateways/providers.js` (see the contract in that file's header): `validate`, `test`, `createCheckout`, `parseWebhook`, `confirm`. Add a mock test in `server/test/gateways.test.js`.

## Webhook addresses
`https://<workspace host>/api/hooks/pay/<provider>`; shown on the settings screen.
