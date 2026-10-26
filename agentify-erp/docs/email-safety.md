# Email codes, new sign-in alerts and disposable-email blocking (v1.29)

## What it does

1. **Signup code.** Before a workspace is created the owner types a 6-digit code emailed to the address they entered. The server then returns a single-use, 30-minute proof that the signup form sends back. Applies to the normal and free-website signup. Google sign-up skips it (Google already verified the address).
2. **Sign-in code (optional per workspace).** Settings: *My Space > Security > Email sign-in code*: `off` (default), `new_device`, `always`. After a correct password, staff must type a code emailed to them. People who use an authenticator app (2FA) are asked for that instead. Portal customers and vendors are not asked. Google/Apple sign-in is not asked (the provider verified the address).
3. **New sign-in alert.** Every staff sign-in is remembered as a (browser cookie `erp_device`, IP) pair in `login_devices`. Email is sent when the IP is new **and** the browser cookie is unknown. The first sign-in only records a baseline. Max 3 alert mails per person per day. Console users get the same email on a new IP (they already got an in-console notification).
4. **Wrong-password warning (v1.30).** 5 wrong passwords against a real account within 15 minutes email its owner once (max one per hour) with the IP. Unknown accounts get nothing. Table `login_failures`.
5. **Devices list.** My Space > Security > "Where you have signed in" lists browsers and addresses seen at sign-in (not live sessions), marks the current browser, and "Sign out of every other device" bumps `token_version` (this browser gets a fresh cookie).
6. **Disposable-address blocking.** Applied at signup, staff invitations and admin-created users:
   1. Super Admin list (*Console > Security & Access > Email safety*): `allow` beats everything, `block` refuses; a rule covers subdomains.
   2. Built-in list of 148 known disposable domains + telltale words (`tempmail`, `mailinator`, `yopmail`, ...).
   3. DNS check that the domain has MX or address records. A DNS error or timeout **allows** the address (an outage never blocks real customers); only a definite "no such domain" refuses.
   4. Switches (all default on): `signup_email_code`, `block_disposable_email`, `check_email_mx`.

## Limits (be honest with customers)

* No list is complete; new disposable services appear daily. The emailed code stops lazy abuse but a person with a real, free mailbox (Gmail, Outlook) can still make many accounts. Pair with the one-trial-per-email rule and watch Workspaces for patterns.
* The signup code and the sign-in code only apply when a mail provider is connected (Integrations > Resend). Without one nothing is enforced, because the code could not be delivered.
* "New IP" alerts can be noisy for people on changing mobile IPs; the device cookie keeps the usual browser quiet. Clearing cookies makes the next sign-in look new.
* A workspace whose email stops working can be unlocked by support: Workspaces > user > *Turn off the workspace email sign-in code*.

## Security details

* Codes: `crypto.randomInt`, HMAC-SHA256 with the server secret stored (never the code), 10-minute expiry, 5 wrong guesses burn the code, 30 s resend cooldown, 5 codes per address per hour, plus per-IP limiter (`SIGNUP_CODE_LIMIT`, default 30/h) and the login limiter.
* Table `email_otps` (platform DB), rows older than a day are deleted on each send.
* Tables in each workspace DB: `login_devices`, `login_alerts`.
* Tests: `server/test/email-otp.test.js` (DNS stubbed, Resend mocked). Outside tests the DNS resolver is real; in tests (`NODE_TEST_CONTEXT`) it defaults to "accepts".

## Not verified

Real delivery through Resend, rendering in mail clients, and real DNS from the production server.
