# Integrations: setup guide and limits

This is for the platform owner (who registers one app per provider) and for support staff (who help workspace owners connect their own accounts). Workspace owners see the same steps inside the app under **Settings > Integrations**.

## What each integration needs

| Integration | Who sets it up | What is needed | Verified how |
|---|---|---|---|
| Twilio calling and texting | Each workspace | Their own Twilio Account SID, Auth Token and a Twilio number | The CRM asks Twilio for the account and the number before it says Connected |
| Pakistan voice provider (robocall) | Each workspace | The provider's call endpoint, API key and caller number | A test request to the endpoint; the provider's field names can be mapped |
| Google sign-in and Google Calendar | Platform owner once, then each user connects | A Google Cloud OAuth client (Web) with the Calendar API enabled | The console Test button sends a deliberately wrong code: Google answers differently for a wrong client than a right one |
| Sign in with Apple | Platform owner once | Apple Services ID, Team ID, Key ID and the .p8 private key | Only that a client secret can be signed; Apple needs a real sign-in to test further |
| Facebook / Instagram | Platform owner once (app review), then each workspace connects pages | A Meta app with the Pages and Instagram permissions approved | The console Test asks Meta for an app token |
| LinkedIn, TikTok | Platform owner once (app review), then each workspace connects | A LinkedIn or TikTok developer app with posting products approved | The console Test sends a wrong code and reads the answer |
| Property portals and MLS | Each workspace | Their own agreement with the portal or MLS board | Feeds work immediately; pushing over an API needs the board's endpoint and token |
| Your own domain | Each workspace | A domain they own and access to its DNS | The CRM reads their DNS before it serves the domain |

Redirect address to register at Google, Apple, Meta, LinkedIn and TikTok (one address for every workspace, on the main domain):

```
https://<main domain>/api/platform/oauth/<provider>/callback
provider = google | apple | meta | linkedin | tiktok
```

Enter the app credentials in the Super Admin console under **Integrations**. They are stored encrypted. Providers review apps before they allow posting or calendar access for other people's accounts; until that review passes, workspace connections fail with the provider's own message.

## Calls

**Twilio.** The workspace owner creates a Twilio account, buys a number (links are shown in the app), pastes the Account SID, Auth Token and number, and presses Save and test. In the dialer, pressing Call makes Twilio ring the agent's own phone first; when the agent answers, Twilio connects the lead and shows the Twilio number as caller ID. Twilio calls our web hook `/api/hooks/twilio/bridge`; every request is checked against Twilio's signature with that workspace's Auth Token. Browser calling (WebRTC) is not part of this release.

**Do not call.** Choosing "Asked not to be called" as the call outcome blocks calls and texts to that person and removes them from the Call next list. Telemarketing law (for example TCPA in the US, PECR in the UK, TDRA rules in the UAE) is the workspace's responsibility; the product records consent-related outcomes but does not decide legality.

**Pakistan.** I do not have a specific robocall provider's API specification, so the provider connection is generic: HTTPS endpoint, API key in a header, and three mappable body fields. Send the provider's API documentation to support so the field names can be set once for all customers.

## Call next

The dialer ranks contacts by: follow-up overdue (highest), follow-up due today, new lead not yet called, never called, high priority and no contact for a week or more. It excludes people who asked not to be called and people called in the last hours. Each row says why it is there. The ranking is a transparent rule set, not a machine-learning model.

## Custom domains

1. The owner adds the domain in Settings > Integrations > Your own web address.
2. They add two DNS records: a TXT record `_agentify-challenge.<domain>` with the value shown, and a CNAME to `<workspace>.<main domain>` (an A record to `ERP_SERVER_IP` for an apex domain).
3. Verify checks both. Only then does the domain serve the workspace.

**HTTPS certificates.** The application does not terminate TLS. The web server must issue a certificate for each verified domain on demand and ask the application first. With Caddy:

```
{
  on_demand_tls {
    ask http://127.0.0.1:4000/api/platform/domain-check
  }
}
https:// {
  tls { on_demand }
  reverse_proxy 127.0.0.1:4000
}
```

`GET /api/platform/domain-check?domain=<host>` answers 200 only for verified customer domains and our own subdomains. The current Contabo deployment uses nginx; to serve customer domains over HTTPS either move to Caddy as above or run certbot per domain. Set `ERP_SERVER_IP` to the server's public IPv4 address so apex-domain instructions show the right address.

## Property portals and MLS

Each portal gets a feed at `/api/hooks/feeds/<portal>.xml|csv|json?token=...`. The token is per workspace and can be changed. A listing is included only when it is published on the website, published to that portal and complete for it (photo, bedrooms and so on, the UAE advertising permit number, the UK tenure). Zillow, Rightmove, Zoopla, Bayut, Property Finder and most MLS boards approve brokers individually, so the portal list shows how to apply; the XML is a neutral feed that these portals' onboarding teams can map. For boards that give a RESO Web API, enter its endpoint and token and publishing posts the listing JSON there.

## Social media

Facebook Pages and Instagram business accounts (publish and read likes, comments, reach), LinkedIn profiles (publish) and TikTok (video upload by address). Posts publish now or at a chosen time; a job checks every minute. A failed post keeps the provider's message and can be retried. Reports show posts, results and totals; LinkedIn and TikTok do not expose per-post numbers to this kind of app.

## Landing page content

Testimonials are shown only when real quotes are entered in the console (the marketing content `testimonials` list; an optional `country` field limits a quote to one country). The site does not contain invented reviews. The "Example: Call next" panel on the landing page is labelled as an example.

## AI (Claude, ChatGPT, Gemini and any OpenAI-compatible model)
- Workspace owners paste their own API key under Integrations → Claude and ChatGPT. The key is tested against the provider, stored encrypted and never returned to the browser.
- **Ask your data** (AI Studio): the model calls read-only tools (sales, leads, calls, listings summaries) limited to what the signed-in user may see. Customer names are hidden unless the owner switches that on.
- **Promo videos**: the model writes the script and captions from the listing's real facts. Language models do not produce video, so the browser draws the video from the listing photos (canvas and MediaRecorder) and uploads it to the workspace.
- Speech-to-text uses OpenAI Whisper (files over 25 MB are not transcribed) or, with only a Gemini key, Gemini (18 MB limit). Gemini keys come from aistudio.google.com/apikey.

## Call recording, scripts and statistics
- Recording is off until a workspace turns it on in the Dialer. Every recorded call opens with a spoken notice. Recording laws differ by country and state; the workspace owner is responsible for consent.
- The Dialer board shows calls made, connected, connect rate, average call length, talk time and recordings, and a script window beside Call next. Scripts support placeholders for the contact, agent and company.

## Video meetings
- Schedule from Meetings; send each person a personal link by email, text message (Twilio) or a ready WhatsApp message (a `wa.me` link opened from the agent's own WhatsApp; there is no WhatsApp Business connection). Staff also get an in-app notification; 15-minute reminders are sent automatically.
- Platform limits (console → Integrations → Video meetings: limits): longest meeting, people per meeting (peer to peer, keep it small), room-opens-early minutes, days ahead, recording on/off. A meeting ends automatically at its time limit with 5 and 1 minute warnings.
- In the room: camera, microphone, screen sharing, pen and pointer drawn over the shared screen, live captions (Chrome/Edge speech recognition, saved as the meeting transcript), background blur or colour (MediaPipe, runs on the device), host recording to the workspace, script panel for staff.
- Not possible in a browser: taking remote control of another person's computer. The pen and pointer replace it.
- Reliability: set `ERP_ICE_SERVERS` (JSON array) to your TURN server for people behind strict firewalls; the default is a public STUN server only.
- **Other models:** choose "Other model (OpenAI-compatible)", then enter the service address (https only, public hosts only), the model name and the key. This covers Groq, Mistral, DeepSeek, OpenRouter, Together, Azure OpenAI and similar. The connection is tested with a real one-word request. Tool calling needs a model that supports it; if it does not, questions are answered without looking at your data.

## Workspace addresses on a live server
Each company opens at `https://<name>.<your domain>`. That needs two things: a wildcard DNS record (`*.<your domain>` pointing at the server) and an https certificate per workspace. The deploy workflow checks for the wildcard record. When it exists, it switches the server's web front end from nginx to Caddy, which gets a certificate for each real workspace the first time it is opened (the app answers `/api/platform/domain-check` so only existing workspaces qualify). Without the record the deploy prints exactly what to add and leaves nginx as it was. Set the secret `TLS_PROXY` to `nginx` to keep nginx. The sign-up and sign-in pages check that a workspace address opens before sending anyone there, and explain it if not.

## Sign up with Google, and e-mail through Resend

**Continue with Google on the signup page.** Once the platform owner has saved the Google client (Console, Integrations, "Google app (sign-in and connections)"), the signup page at `/signup` shows **Continue with Google**. Google verifies the address; the page then asks only for the company and country, no password. The workspace owner is created for that address (already confirmed), signs in with the one-time code, and signs in later with Google on the workspace login page (or sets a password with Forgot password). Nothing is created until the signup form is submitted, and the token that carries the Google name and email is signed and valid for 15 minutes. Register this redirect address in the Google Cloud console (Credentials, OAuth client, Authorized redirect URIs): `https://<main domain>/api/platform/oauth/google/callback`.

**Resend.** Console, Integrations, "Transactional email (Resend)": paste the API key (starts with `re_`) and the sender (for example `Agentify ERP <noreply@your-verified-domain>`; the domain must be verified in Resend, with its SPF and DKIM records) and press Test. Welcome and confirmation mails, invitations, password resets, trial and billing notices, and demo-request alerts all use it. Without a key mail is only written to the server log.

**Notification e-mails.** A workspace administrator switches on *E-mail* in Settings, Notifications. Every in-app notification is then also e-mailed to the person it is for (confirmed staff addresses only, at most five per person every ten minutes). It does nothing until the Resend key is saved.

## Mailbox (Super Admin console, Platform Owner and Super Admin only)

Console menu: Mailbox, with Inbox, Sent log and Settings. It reads and sends company mail through Resend Inboxes (hello@ and admin@; noreply@ has no inbox and is never offered as a sender), using the Resend key already saved under Integrations. The browser never calls Resend.

After the first deploy, once:

1. In Resend, Webhooks, add `https://<your console domain>/api/platform/webhooks/resend` and select the e-mail events (sent, delivered, delivery delayed, bounced, complained, failed, suppressed, received).
2. Copy the webhook's signing secret (starts with `whsec_`) and paste it into Console, Integrations, Transactional email (Resend), field "Webhook signing secret".
3. Optional: Mailbox, Settings, "Reply-To for automated e-mails" (default `hello@agentifyerp.co`). Use Sent log, "Import from Resend" once to bring in mail sent before the log existed.

Notes: the permission is `mailbox.manage` (not given to Platform Administrator or any other role); the webhook is Svix-signed (5 minute tolerance) and idempotent by event id; the sent log keeps subject, type and delivery events only, never a code or link; inbound HTML is sanitised and remote images stay blocked until "Show images".
