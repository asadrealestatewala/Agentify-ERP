# Free websites (website-only signup)

People can create a free website-only account at agentifyerp.co. The site is served only from a separate **sites domain** (for example `agentifysites.co`), never from the main app domain. This keeps free-site spam away from the main domain's reputation (Google Safe Browsing flags a whole domain), and keeps cookies and scripts of free sites apart from the ERP.

## What a free site includes

- Website editor, SEO manager, website assistant, forms, blog and pages, Website Integrations (API, webhooks, WordPress plugin).
- 2 users, 200 MB storage.
- The workspace stays at `<name>.<base domain>` for editing. Only the public site moves to `<name>.<sites domain>`.

Not included: CRM, listings inventory, accounting and all other ERP modules. The server refuses those API paths (`403 free_site_only`), so hiding them in the menu is not the only barrier.

## Setup (one time)

1. Buy the sites domain.
2. Add two DNS A records pointing to the server: `*` and `@` (apex) to the server IP. Set `ERP_SERVER_IP` on the server so the console can check them.
3. In the Super Admin console open **Website builder > Free websites**, enter the domain, press **Check DNS now**, then switch **Free website signup** on.

Until a domain is saved and signup is switched on, signup for free sites is closed and nothing is served on the sites domain.

## Abuse controls

- Signup rate limit, one free site per email address.
- A free site stays offline until its owner has confirmed their email address (publish, go-online and restore are refused otherwise).
- Certificates are issued on demand only for the apex and for existing free-site names under the sites domain. Customers cannot attach custom domains under the sites domain.
- Suspending a tenant from the console takes its site down.

Not built: a captcha (for example Cloudflare Turnstile). Add it if signup abuse appears.

## Rollback

- Switch signup off: no new free sites; existing ones keep working.
- Clear the domain: existing free sites stop being served on the sites domain (they remain editable in their workspace).
- Revert the PR to remove the feature entirely.

## Not verified yet

DNS resolution, HTTPS issuance and the live domain cannot be tested from the build environment. The DNS check proves DNS only, not HTTPS. Test with the first free site after setup.
