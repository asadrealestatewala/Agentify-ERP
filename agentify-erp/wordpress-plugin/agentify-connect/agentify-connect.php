<?php
/**
 * Plugin Name:       Agentify Connect
 * Description:       Sends website enquiries to your Agentify ERP CRM and shows your listings on a WordPress site.
 * Version:           0.1.0
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       agentify-connect
 */

defined( 'ABSPATH' ) || exit;

define( 'AGENTIFY_CONNECT_VERSION', '0.1.0' );
define( 'AGENTIFY_CONNECT_FILE', __FILE__ );

require_once __DIR__ . '/includes/class-agentify-client.php';
require_once __DIR__ . '/includes/class-agentify-settings.php';
require_once __DIR__ . '/includes/class-agentify-form.php';
require_once __DIR__ . '/includes/class-agentify-listings.php';
require_once __DIR__ . '/includes/class-agentify-webhook.php';

add_action( 'plugins_loaded', function () {
	Agentify_Settings::init();
	Agentify_Form::init();
	Agentify_Listings::init();
	Agentify_Webhook::init();
} );
