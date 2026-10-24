# Agentify ERP Integration API v1: developer guide

The machine-readable reference is [openapi-v1.yaml](openapi-v1.yaml). This guide covers how to use it.

## Get a key
In the workspace, open **Settings > Website Integrations > Connect a website**, choose a platform and the permissions the site needs. The key (`agf_<id>_<secret>`) is shown **once**. Only a hash is stored, so a lost key cannot be recovered; rotate it instead (the old key keeps working for 24 hours).

Send it as a header. A key in the address is never accepted.

```
curl https://YOUR-WORKSPACE/api/v1/ping -H "Authorization: Bearer agf_..."
```

Keys only work on the workspace that made them. Permissions: `leads:write`, `listings:read`, `projects:read`, `agents:read`, `webhooks:manage`.

## Send a lead
```
curl -X POST https://YOUR-WORKSPACE/api/v1/leads \
  -H "Authorization: Bearer agf_..." -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"name":"Sara Khan","phone":"+1 415 555 0142","message":"Interested in a viewing",
       "property_ref":"LST-1001","enquiry_type":"visit",
       "consent":{"privacy":true,"marketing":false,"text":"I agree to the privacy notice","at":"2026-10-24T10:00:00Z"},
       "source":{"form":"Contact page","page_url":"https://example.com/contact","utm_source":"google"}}'
```
- Reply `201 {"lead_ref":"WEB-123","result":"created"}`; if the person is already in the CRM (same phone in any spelling or same e-mail) the reply is `200` with `"result":"matched"` and their history gets an entry.
- **Idempotency-Key** is required. Retrying with the same key and body returns the first answer (header `Idempotent-Replay: true`) and creates nothing. The same key with a different body gives `422 idempotency_conflict`. Keys are kept 24 hours.
- Consent is stored exactly as sent. If the connection requires privacy consent, `consent.privacy` must be `true` or you get `400 consent_required`.
- `"test": true` tags the lead `test` and sends no notification.

## Listings, projects, agents
`GET /listings` (`page`, `per_page` up to 100, `type`, `city`, `purpose`, `project_id`, `featured=1`, `include_sold=1`, `updated_since`), `GET /listings/{id-or-code}`, `GET /projects`, `GET /projects/{ref}`, `GET /agents`. Only fields the public website already shows are returned. The connection's choice (all, featured only, or chosen projects) limits what it can see.

## Errors
Always `{"error":{"code":"...","message":"..."}}`. Statuses: 400 invalid_request, 401 invalid_key, 403 forbidden / insufficient_scope, 404 not_found, 422 idempotency_conflict, 429 rate_limited.

## Rate limits
300 requests a minute per key (RateLimit headers say what is left), plus a stricter limit on wrong keys per address. On 429, wait the `Retry-After` seconds.

## Webhooks
`POST /webhooks` with `{"url":"https://...","events":["listing.updated"]}` (public https only). The signing secret is returned once. Events: `listing.published`, `listing.updated`, `listing.unpublished`, `project.updated`, `lead.created`. Payloads contain ids and public listing data only; `lead.created` carries a lead reference and enquiry type, never personal details.

Each delivery is `POST` JSON `{"id","type","created_at","data"}` with headers `Agentify-Signature: t=<unix>,v1=<hex>`, `Agentify-Event-Id` (stable across retries; use it to ignore duplicates), `X-Agentify-Event`, `Agentify-Delivery-Attempt`.

Verify (Node):
```js
import crypto from 'node:crypto';
function verify(rawBody, header, secret) {
  const { t, v1 } = Object.fromEntries(header.split(',').map((p) => p.split('=')));
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;      // reject old deliveries
  const mac = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  return v1?.length === mac.length && crypto.timingSafeEqual(Buffer.from(v1), Buffer.from(mac));
}
```
Answer with any 2xx within 8 seconds. Other answers are retried after 1, 5, 30, 120 and 720 minutes, then marked failed (you can retry from the Website Integrations screen). `410 Gone` switches the subscription off. Redirects are not followed.

## Hosted form (no code)
In the connection, add a **form**. You get a publishable key (`pk_...`), an allow-list of website addresses, and two snippets: an iframe and a one-line script (`/embed/agentify-form.js`). The key has no secret and can only submit leads from the allowed addresses, at most 8 a minute per visitor. A hidden `website` field catches bots; the answer is the same for new and known people.

## Not covered yet
The WordPress plugin lives in `wordpress-plugin/` and is not yet published on WordPress.org. Website-only signup (Phase 4) and Webflow/Wix/Squarespace presets (Phase 5) are not built. Embeds on those builders are not tested.
