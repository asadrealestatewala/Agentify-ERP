<?php
defined( 'ABSPATH' ) || exit;

/** [agentify_form]: an enquiry form that sends the lead to the CRM from the server (the key is never in the page). */
class Agentify_Form {
	const UTM = array( 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content' );

	public static function init() {
		add_shortcode( 'agentify_form', array( __CLASS__, 'render' ) );
		add_action( 'admin_post_nopriv_agentify_lead', array( __CLASS__, 'submit' ) );
		add_action( 'admin_post_agentify_lead', array( __CLASS__, 'submit' ) );
	}

	public static function render( $atts = array() ) {
		$a = shortcode_atts( array( 'title' => '', 'button' => __( 'Send enquiry', 'agentify-connect' ), 'enquiry_type' => 'inquiry', 'property_ref' => '', 'project_ref' => '' ), $atts, 'agentify_form' );
		if ( ! Agentify_Client::is_configured() ) {
			return current_user_can( 'manage_options' ) ? '<p><em>' . esc_html__( 'Agentify Connect: finish the connection under Settings > Agentify Connect.', 'agentify-connect' ) . '</em></p>' : '';
		}
		$o      = Agentify_Client::options();
		$status = isset( $_GET['agentify'] ) ? sanitize_key( wp_unslash( $_GET['agentify'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification
		$out    = '<style>.agentify-form input:not([type=checkbox]),.agentify-form textarea{width:100%;max-width:480px;box-sizing:border-box}</style><div class="agentify-form" id="agentify-form">';
		if ( 'ok' === $status ) {
			return $out . '<p class="agentify-thanks" role="status">' . esc_html__( 'Thank you. We have your details and will be in touch soon.', 'agentify-connect' ) . '</p></div>';
		}
		if ( 'err' === $status ) {
			$out .= '<p class="agentify-error" role="alert">' . esc_html( self::flash() ) . '</p>';
		}
		if ( $a['title'] ) {
			$out .= '<h3>' . esc_html( $a['title'] ) . '</h3>';
		}
		$out .= '<form method="post" action="' . esc_url( admin_url( 'admin-post.php' ) ) . '">';
		$out .= '<input type="hidden" name="action" value="agentify_lead">';
		$out .= '<input type="hidden" name="ag_title" value="' . esc_attr( $a['title'] ?: get_the_title() ) . '">';
		$out .= '<input type="hidden" name="enquiry_type" value="' . esc_attr( $a['enquiry_type'] ) . '">';
		$out .= '<input type="hidden" name="property_ref" value="' . esc_attr( $a['property_ref'] ) . '">';
		$out .= '<input type="hidden" name="project_ref" value="' . esc_attr( $a['project_ref'] ) . '">';
		$out .= '<input type="hidden" name="page_url" value="' . esc_url( self::current_url() ) . '">';
		foreach ( self::UTM as $k ) {
			if ( ! empty( $_GET[ $k ] ) ) { // phpcs:ignore WordPress.Security.NonceVerification
				$out .= '<input type="hidden" name="' . esc_attr( $k ) . '" value="' . esc_attr( sanitize_text_field( wp_unslash( $_GET[ $k ] ) ) ) . '">';
			}
		}
		$out .= '<p><label>' . esc_html__( 'Your name', 'agentify-connect' ) . ' *<br><input name="name" required maxlength="120" autocomplete="name"></label></p>';
		$out .= '<p><label>' . esc_html__( 'Email', 'agentify-connect' ) . '<br><input name="email" type="email" maxlength="120" autocomplete="email"></label></p>';
		$out .= '<p><label>' . esc_html__( 'Phone', 'agentify-connect' ) . '<br><input name="phone" type="tel" maxlength="30" autocomplete="tel"></label></p>';
		$out .= '<p><label>' . esc_html__( 'Message', 'agentify-connect' ) . '<br><textarea name="message" rows="4" maxlength="2000"></textarea></label></p>';
		$out .= '<p style="position:absolute;left:-9999px" aria-hidden="true"><label>Leave this empty<input name="website" tabindex="-1" autocomplete="off"></label></p>';
		if ( $o['consent_text'] ) {
			$out .= '<p><label><input type="checkbox" name="consent" value="1" required> ' . esc_html( $o['consent_text'] ) . '</label></p>';
		}
		return $out . '<p><button type="submit">' . esc_html( $a['button'] ) . '</button></p></form></div>';
	}

	private static function current_url() {
		global $wp;
		return home_url( add_query_arg( array(), $wp->request ?? '' ) );
	}

	private static function flash() {
		$msg = get_transient( 'agentify_flash_' . self::visitor() );
		return $msg ?: __( 'Sorry, we could not send your enquiry. Please try again in a moment.', 'agentify-connect' );
	}

	private static function visitor() {
		return substr( hash_hmac( 'sha256', $_SERVER['REMOTE_ADDR'] ?? '', wp_salt() ), 0, 16 ); // never the raw address
	}

	private static function back( $ok, $msg = '' ) {
		$to = wp_get_referer() ?: home_url( '/' );
		$to = remove_query_arg( 'agentify', $to );
		if ( $msg ) {
			set_transient( 'agentify_flash_' . self::visitor(), $msg, 120 );
		}
		wp_safe_redirect( add_query_arg( 'agentify', $ok ? 'ok' : 'err', $to ) . '#agentify-form' );
		exit;
	}

	public static function submit() {
		$post = wp_unslash( $_POST ); // phpcs:ignore WordPress.Security.NonceVerification -- a public enquiry form on cached pages; abuse is limited by the honeypot and the rate limit below
		if ( ! empty( $post['website'] ) ) {
			self::back( true ); // bots fill the hidden field; they get the same thank-you
		}
		$bucket = 'agentify_rate_' . self::visitor();
		$n      = (int) get_transient( $bucket );
		if ( $n >= 5 ) {
			self::back( false, __( 'Too many enquiries from this connection. Please wait a few minutes.', 'agentify-connect' ) );
		}
		set_transient( $bucket, $n + 1, 10 * MINUTE_IN_SECONDS );

		$o    = Agentify_Client::options();
		$lead = array(
			'name'         => sanitize_text_field( $post['name'] ?? '' ),
			'email'        => sanitize_email( $post['email'] ?? '' ),
			'phone'        => sanitize_text_field( $post['phone'] ?? '' ),
			'message'      => sanitize_textarea_field( $post['message'] ?? '' ),
			'enquiry_type' => sanitize_key( $post['enquiry_type'] ?? 'inquiry' ),
		);
		foreach ( array( 'property_ref', 'project_ref' ) as $k ) {
			$v = sanitize_text_field( $post[ $k ] ?? '' );
			if ( preg_match( '/^[A-Za-z0-9._-]{1,60}$/', $v ) ) {
				$lead[ $k ] = $v;
			}
		}
		$lead = array_filter( $lead, 'strlen' );
		$src  = array( 'form' => 'WordPress: ' . sanitize_text_field( $post['ag_title'] ?? 'form' ), 'page_url' => esc_url_raw( $post['page_url'] ?? '' ), 'referrer' => wp_get_referer() ?: '' );
		foreach ( self::UTM as $k ) {
			if ( ! empty( $post[ $k ] ) ) {
				$src[ $k ] = sanitize_text_field( $post[ $k ] );
			}
		}
		$lead['source'] = array_filter( $src );
		if ( $o['consent_text'] ) {
			if ( empty( $post['consent'] ) ) {
				self::back( false, __( 'Please tick the box to accept the privacy notice.', 'agentify-connect' ) );
			}
			$lead['consent'] = array( 'privacy' => true, 'text' => $o['consent_text'], 'at' => gmdate( 'c' ) );
		}
		// the same details sent twice in a row (double click, refresh) are sent once
		$lock = 'agentify_dup_' . md5( wp_json_encode( $lead ) . self::visitor() );
		if ( get_transient( $lock ) ) {
			self::back( true );
		}
		$r = Agentify_Client::request( 'POST', '/leads', $lead, array( 'Idempotency-Key' => wp_generate_uuid4() ) );
		if ( is_wp_error( $r ) ) {
			$status = $r->get_error_data()['status'] ?? 0;
			// the CRM's own wording for mistakes the visitor can fix (a name with digits, a missing phone), a generic line otherwise
			self::back( false, 400 === $status || 422 === $status ? $r->get_error_message() : '' );
		}
		set_transient( $lock, 1, 30 );
		self::back( true );
	}
}
