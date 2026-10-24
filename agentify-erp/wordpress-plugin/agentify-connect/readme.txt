=== Agentify Connect ===
Contributors: agentifyerp
Tags: real estate, crm, leads, listings
Requires at least: 6.0
Tested up to: 6.8
Requires PHP: 7.4
Stable tag: 0.1.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Send website enquiries to your Agentify ERP CRM and show your listings on a WordPress site.

== Description ==

Agentify Connect links a WordPress site to your Agentify ERP workspace.

* `[agentify_form]` shows an enquiry form. Enquiries go to the CRM from your server; people already in the CRM get a history entry instead of a duplicate.
* `[agentify_listings per_page="9" city="" type="" featured="1"]` shows your published listings, with a detail view and an enquiry form per property.
* Optional change notifications refresh listings as soon as they change in Agentify.

This plugin talks to your own Agentify workspace (the address you enter). It makes no other external requests.

== Installation ==

1. Upload the `agentify-connect` folder to `/wp-content/plugins/` and activate it.
2. In Agentify, open Settings > Website Integrations > Connect a website > WordPress, and copy the key.
3. In WordPress, open Settings > Agentify Connect, enter your workspace address and the key, save, and use Test connection.
4. Add the shortcodes to a page.

Tip: to keep the key out of the database, add `define( 'AGENTIFY_API_KEY', 'agf_...' );` to wp-config.php.

== Privacy ==

Enquiry details (name, phone, email, message, the page address, campaign tags in the page address and the privacy choice) are sent to your Agentify workspace. No cookies are set. The visitor's IP address is not stored; a one-way hash is kept for a few minutes to limit spam. Add the plugin's use of your CRM to your privacy notice.

== Changelog ==

= 0.1.0 =
First version.
