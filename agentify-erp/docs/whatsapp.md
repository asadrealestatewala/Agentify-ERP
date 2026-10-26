# WhatsApp inbox (Botlinkd)

Added in v1.24. Tenants read and answer customer WhatsApp chats inside the CRM through their **own** Botlinkd account.

## What Botlinkd actually offers (read from https://botlinkd.com/api-documentation, 2026-10-26)

* It documents the **official WhatsApp Business Cloud API**. Its docs say QR / WhatsApp Web session endpoints are excluded, so there is **no scan-a-QR flow** to build. The number is onboarded with Meta inside the Botlinkd dashboard.
* Send: `POST https://botlinkd.com/api/whatsapp/message`, multipart form fields `appkey`, `authkey`, `to` (digits, country code first), `message`. The response body is not documented (we treat HTTP 2xx without an error field as accepted; accepted does not mean delivered). Business-started messages outside the customer-service window need an approved template (template endpoints exist, **not used** in this release).
* Receive: no polling API. In the Botlinkd dashboard, platform > Auto Reply Settings > External Webhook, mode "Events Only". Botlinkd POSTs JSON `message.received` (`event_id`, `occurred_at`, `data.message.{type,text}`, `data.sender.{wa_id,name}`, `data.platform.uuid`). Optional per-platform HMAC-SHA256 signing; **the header name and signed string are not documented**.
* Not documented: delivery/status events, media download, rate limits, numeric error codes, any read-only "check my keys" call. Hence the test is one real message to a number the admin types.
* Botlinkd's Terms and Privacy Policy were not read (only linked from its footer). The owner should read them before launch.

## Why not QR gateways
QR-linked gateways drive an unofficial WhatsApp Web session. WhatsApp/Meta can ban a number for it, with no appeal path we control. The Cloud API (what Botlinkd resells) is the permitted route. The alternative to Botlinkd is a direct Meta Cloud API integration (own Meta business verification, webhooks, templates); the adapter in `server/src/integrations/botlinkd.js` is the only provider-specific file, so another gateway can be swapped in.

## Model
* **Per workspace**: each workspace saves its own App key + Auth key (+ number, optional signing secret). Stored encrypted in `tenant_integrations` (provider `botlinkd`), never returned (only the last 4 characters). A random webhook token in the address `/api/hooks/whatsapp/<token>` selects the connection; the workspace itself comes from the host name, so a token from another workspace never works. If a signing secret is saved the HMAC is also required.
* **Console** (Integrations > WhatsApp (Botlinkd)): the platform's own keys (used for the test message only), platform identifier (e.g. 447544440352), master switch, default entitlement and caps. Switching the master on gives nobody access.
* **Entitlement** (`services/whatsappAccess.js`): master switch AND (platform default < plan `whatsapp_limits` < workspace override `entitlements.whatsapp`) with `{enabled, monthly, daily}`; an inactive subscription or suspended workspace turns it off. Workspace override API: `PUT /api/platform/admin/whatsapp/tenants/:id`. Plan field `whatsapp_limits` is accepted by the plan API (no plan-editor UI yet).
* Tables in each workspace DB: `wa_threads`, `wa_messages` (unique `event_id` makes repeats no-ops), `wa_optouts`. Times are UTC ISO.

## Reused, not rebuilt
Contacts and phone matching, lead creation (`submitLead`, so routing rules, dedupe and response targets apply), lead SLA (`logHumanResponse`, channel `whatsapp`), contact timeline (`activity`), notifications, audit log, roles (CRM view/edit/create; Settings edit for the connection; own-scope roles see only their conversations).

## Safeguards
No bulk send and no automated outbound message at all (not even a STOP confirmation). Reply only within 24 h of the customer's last message. STOP/UNSUBSCRIBE/CANCEL/END/QUIT/"do not contact" block the number until START or a staff decision with a written reason. 20 sends/min per person; daily and monthly caps per workspace; failures are recorded and never retried (a retry could message twice).

## Not verified / not built
* Nothing was run against the real Botlinkd: tests use a fake provider. Real response shape, signature header, `wa_id` formats, status events and media are unverified.
* Inbound media is stored as a placeholder; outbound media, templates, delivery ticks, and starting a conversation are not built.
* Opt-out keywords are English only. Consent law per country (opt-in evidence, quiet hours) needs legal input.
* The chat polls every 10 s (no websocket).

## Optional QR mode (v1.25, off by default, unofficial)
Botlinkd has no QR/session API (confirmed on its FAQ). QR linking therefore needs a **separate gateway service** that runs a WhatsApp Web session; none is bundled, chosen or bought here. WhatsApp can restrict or ban numbers linked this way and nobody can reverse that.

Switches (all default OFF): Console > Integrations > "WhatsApp QR gateway" (gateway https address, bearer token, master switch) AND the workspace's WhatsApp entitlement AND the workspace owner switching it on in Settings > WhatsApp with a ticked risk acknowledgement (stored with who and when). Switching a workspace off unlinks and forgets the session; the official connection is used again.

Gateway contract (`server/src/integrations/qrGateway.js`), requests carry `Authorization: Bearer <token>`:
- `POST /sessions` `{session_id, webhook_url, webhook_secret}` → 2xx
- `GET /sessions/{id}` → `{status: qr|connecting|connected|disconnected, qr_image?: data:image/png;base64,…, number?}`
- `DELETE /sessions/{id}`; `POST /sessions/{id}/messages` `{to, text}` → `{id?}`; `GET /health`
- The gateway POSTs customer messages to `webhook_url` in the `message.received` JSON shape above with header `X-Signature` = HMAC-SHA256(webhook_secret, raw body) (hex). The QR webhook is always signed.

Everything else is shared with the official mode: inbox, 24-hour reply rule, no bulk or automated sending, STOP blocking, per-person/daily/monthly limits. Tested with a fake gateway only; no real gateway or WhatsApp session has been run.
