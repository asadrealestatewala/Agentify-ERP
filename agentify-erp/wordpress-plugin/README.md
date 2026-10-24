# Agentify Connect (WordPress plugin)

GPL-2.0-or-later plugin in `agentify-connect/`. Talks to the Agentify Integration API v1 (see `../docs/website-integrations/developer-guide.md`).

## Use
Copy `agentify-connect/` to `wp-content/plugins/`, activate, then Settings > Agentify Connect. Shortcodes: `[agentify_form]`, `[agentify_listings]`. Details in `agentify-connect/readme.txt`.

## What it does and does not do
- The key is stored in the WordPress options table (or in `wp-config.php` as `AGENTIFY_API_KEY`) and is used only by the server. It is never printed in a page or in settings (only the last four characters).
- Enquiry form: honeypot, five enquiries per ten minutes per visitor, duplicate suppression, privacy tick-box (consent is sent and stored in the CRM). No nonce, because the form must work on cached pages.
- Listings are cached for five minutes. Change notifications need the site to be reachable on public https.
- Not built yet: Gutenberg blocks, automatic one-click connect (the key is pasted by hand), WordPress.org submission, translations.

## Test it locally
`tests/e2e.mjs` drives a real WordPress and a real Agentify server (settings page, nonce and key handling, enquiry form, consent, honeypot, listings, signed notifications):

1. Start Agentify on port 4100 with demo data (`PORT=4100 npm --prefix server start`, data dir in /tmp).
2. Install WordPress (any, with the plugin folder linked into `wp-content/plugins`) on `http://localhost:8080`, with an admin user.
3. `WP_DIR=/path/to/wordpress WP_ADMIN=admin WP_PASS=... node wordpress-plugin/tests/e2e.mjs`

The CLI needs PHP 7.4+ and Node 22. On a machine without MySQL, the SQLite Database Integration plugin works for the throwaway WordPress.

## Rollback
Deactivate and delete the plugin. Nothing in Agentify changes; switch the connection off in Settings > Website Integrations.
