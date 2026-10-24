<?php
defined( 'ABSPATH' ) || exit;

/** Settings > Agentify Connect: save the workspace address and key, test it, switch on change notifications. */
class Agentify_Settings {
	public static function init() {
		add_action( 'admin_menu', array( __CLASS__, 'menu' ) );
		add_action( 'admin_post_agentify_save', array( __CLASS__, 'save' ) );
		add_action( 'admin_post_agentify_test', array( __CLASS__, 'test' ) );
		add_action( 'admin_post_agentify_subscribe', array( __CLASS__, 'subscribe' ) );
		add_action( 'admin_post_agentify_disconnect', array( __CLASS__, 'disconnect' ) );
	}

	public static function menu() {
		add_options_page( 'Agentify Connect', 'Agentify Connect', 'manage_options', 'agentify-connect', array( __CLASS__, 'page' ) );
	}

	private static function back( $notice, $type = 'success' ) {
		set_transient( 'agentify_notice_' . get_current_user_id(), array( $type, $notice ), 60 );
		wp_safe_redirect( admin_url( 'options-general.php?page=agentify-connect' ) );
		exit;
	}

	private static function guard( $action ) {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'You do not have permission to do this.', 'agentify-connect' ), 403 );
		}
		check_admin_referer( $action );
	}

	public static function save() {
		self::guard( 'agentify_save' );
		$o    = Agentify_Client::options();
		$base = Agentify_Client::clean_base_url( wp_unslash( $_POST['base_url'] ?? '' ) );
		if ( ! $base ) {
			self::back( __( 'Enter your workspace address, for example https://yourcompany.agentifyerp.co', 'agentify-connect' ), 'error' );
		}
		$key = trim( (string) wp_unslash( $_POST['api_key'] ?? '' ) );
		if ( '' !== $key && ! preg_match( '/^agf_\d+_[A-Za-z0-9_-]{20,}$/', $key ) ) {
			self::back( __( 'That does not look like an Agentify key (it starts with agf_).', 'agentify-connect' ), 'error' );
		}
		$changes = array(
			'base_url'     => $base,
			'consent_text' => sanitize_text_field( wp_unslash( $_POST['consent_text'] ?? '' ) ),
		);
		if ( '' !== $key ) { // a blank key field keeps the saved key
			$changes['api_key'] = $key;
		}
		Agentify_Client::save( $changes );
		self::back( __( 'Saved. Use "Test connection" to check it.', 'agentify-connect' ) );
	}

	public static function test() {
		self::guard( 'agentify_test' );
		$r = Agentify_Client::request( 'GET', '/ping' );
		if ( is_wp_error( $r ) ) {
			self::back( sprintf( /* translators: %s: error */ __( 'Could not connect: %s', 'agentify-connect' ), $r->get_error_message() ), 'error' );
		}
		$scopes = implode( ', ', $r['connection']['scopes'] ?? array() );
		self::back( sprintf( /* translators: 1: workspace, 2: permissions */ __( 'Connected to %1$s. Permissions: %2$s.', 'agentify-connect' ), $r['workspace']['name'] ?? 'your workspace', $scopes ) );
	}

	public static function subscribe() {
		self::guard( 'agentify_subscribe' );
		$secret_url = rest_url( 'agentify/v1/webhook' );
		$r          = Agentify_Client::request( 'POST', '/webhooks', array( 'url' => $secret_url, 'events' => array( 'listing.published', 'listing.updated', 'listing.unpublished', 'project.updated' ) ) );
		if ( is_wp_error( $r ) ) {
			self::back( sprintf( __( 'Could not switch on notifications: %s', 'agentify-connect' ), $r->get_error_message() ), 'error' );
		}
		Agentify_Client::save( array( 'webhook_secret' => $r['secret'] ?? '', 'webhook_id' => (int) ( $r['id'] ?? 0 ) ) );
		self::back( __( 'Notifications are on. Listings here refresh as soon as they change in Agentify.', 'agentify-connect' ) );
	}

	public static function disconnect() {
		self::guard( 'agentify_disconnect' );
		$o = Agentify_Client::options();
		if ( $o['webhook_id'] ) {
			Agentify_Client::request( 'DELETE', '/webhooks/' . (int) $o['webhook_id'] );
		}
		delete_option( Agentify_Client::OPTION );
		Agentify_Listings::flush();
		self::back( __( 'Disconnected. Remember to switch the connection off in Agentify as well.', 'agentify-connect' ) );
	}

	public static function page() {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}
		$o      = Agentify_Client::options();
		$notice = get_transient( 'agentify_notice_' . get_current_user_id() );
		delete_transient( 'agentify_notice_' . get_current_user_id() );
		echo '<div class="wrap"><h1>Agentify Connect</h1>';
		if ( $notice ) {
			printf( '<div class="notice notice-%s"><p>%s</p></div>', esc_attr( $notice[0] ), esc_html( $notice[1] ) );
		}
		echo '<p>' . esc_html__( 'Create a connection in Agentify under Settings > Website Integrations, then paste its address and key here. The key is used only by your server, never by visitors.', 'agentify-connect' ) . '</p>';
		echo '<form method="post" action="' . esc_url( admin_url( 'admin-post.php' ) ) . '"><input type="hidden" name="action" value="agentify_save">';
		wp_nonce_field( 'agentify_save' );
		echo '<table class="form-table">';
		printf( '<tr><th><label for="ag-url">%s</label></th><td><input id="ag-url" name="base_url" type="url" class="regular-text" value="%s" placeholder="https://yourcompany.agentifyerp.co"></td></tr>', esc_html__( 'Workspace address', 'agentify-connect' ), esc_attr( $o['base_url'] ) );
		$has = $o['api_key'] ? sprintf( /* translators: %s: last four characters */ __( 'Saved (ends in %s). Leave blank to keep it.', 'agentify-connect' ), substr( $o['api_key'], -4 ) ) : '';
		printf( '<tr><th><label for="ag-key">%s</label></th><td><input id="ag-key" name="api_key" type="password" autocomplete="off" class="regular-text" placeholder="agf_..."><p class="description">%s</p></td></tr>', esc_html__( 'Key', 'agentify-connect' ), esc_html( $has ) );
		printf( '<tr><th><label for="ag-consent">%s</label></th><td><input id="ag-consent" name="consent_text" class="large-text" value="%s" placeholder="%s"><p class="description">%s</p></td></tr>', esc_html__( 'Privacy tick-box text', 'agentify-connect' ), esc_attr( $o['consent_text'] ), esc_attr__( 'I agree to the privacy notice', 'agentify-connect' ), esc_html__( 'Shown beside the tick-box on the enquiry form. Leave blank for no tick-box.', 'agentify-connect' ) );
		echo '</table>';
		submit_button( __( 'Save', 'agentify-connect' ) );
		echo '</form>';
		if ( Agentify_Client::is_configured() ) {
			foreach ( array( 'agentify_test' => __( 'Test connection', 'agentify-connect' ), 'agentify_subscribe' => $o['webhook_id'] ? __( 'Renew change notifications', 'agentify-connect' ) : __( 'Switch on change notifications', 'agentify-connect' ), 'agentify_disconnect' => __( 'Disconnect', 'agentify-connect' ) ) as $act => $label ) {
				echo '<form method="post" style="display:inline-block;margin-right:8px" action="' . esc_url( admin_url( 'admin-post.php' ) ) . '"><input type="hidden" name="action" value="' . esc_attr( $act ) . '">';
				wp_nonce_field( $act );
				submit_button( $label, 'agentify_disconnect' === $act ? 'delete' : 'secondary', '', false );
				echo '</form>';
			}
			echo '<p class="description">' . esc_html__( 'Change notifications need your site to be reachable on https. Without them, listings refresh every five minutes.', 'agentify-connect' ) . '</p>';
		}
		echo '<h2>' . esc_html__( 'Add to a page', 'agentify-connect' ) . '</h2><p><code>[agentify_form]</code> &nbsp; <code>[agentify_listings per_page="9" city="" type="" featured="1"]</code></p></div>';
	}
}
