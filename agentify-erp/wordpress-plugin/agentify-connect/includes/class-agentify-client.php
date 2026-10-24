<?php
defined( 'ABSPATH' ) || exit;

/** Talks to the Agentify Integration API v1. The key never leaves the server and is never printed. */
class Agentify_Client {
	const OPTION = 'agentify_connect';

	public static function options() {
		$o = get_option( self::OPTION, array() );
		$o = is_array( $o ) ? $o : array();
		if ( defined( 'AGENTIFY_API_KEY' ) && AGENTIFY_API_KEY ) {
			$o['api_key'] = AGENTIFY_API_KEY; // a key kept in wp-config.php wins over the database copy
		}
		return $o + array( 'base_url' => '', 'api_key' => '', 'webhook_secret' => '', 'webhook_id' => 0, 'consent_text' => '' );
	}

	public static function save( array $changes ) {
		$o = get_option( self::OPTION, array() );
		update_option( self::OPTION, array_merge( is_array( $o ) ? $o : array(), $changes ), false );
	}

	public static function is_configured() {
		$o = self::options();
		return $o['base_url'] && $o['api_key'];
	}

	/** Only https workspace addresses (plain http is allowed for localhost development). */
	public static function clean_base_url( $url ) {
		$url = untrailingslashit( esc_url_raw( trim( (string) $url ) ) );
		$p   = wp_parse_url( $url );
		if ( empty( $p['host'] ) || empty( $p['scheme'] ) ) {
			return '';
		}
		$local = in_array( $p['host'], array( 'localhost', '127.0.0.1' ), true );
		if ( 'https' !== $p['scheme'] && ! ( $local && 'http' === $p['scheme'] ) ) {
			return '';
		}
		return $p['scheme'] . '://' . $p['host'] . ( isset( $p['port'] ) ? ':' . $p['port'] : '' );
	}

	public static function base_url() {
		$o = self::options();
		return $o['base_url'];
	}

	/** @return array|WP_Error decoded JSON body */
	public static function request( $method, $path, $body = null, $headers = array() ) {
		$o = self::options();
		if ( ! $o['base_url'] || ! $o['api_key'] ) {
			return new WP_Error( 'agentify_not_configured', __( 'Agentify is not connected yet.', 'agentify-connect' ) );
		}
		$args = array(
			'method'      => $method,
			'timeout'     => 10,
			'redirection' => 0,
			'headers'     => array_merge(
				array(
					'Authorization' => 'Bearer ' . $o['api_key'],
					'Accept'        => 'application/json',
					'User-Agent'    => 'AgentifyConnect/' . AGENTIFY_CONNECT_VERSION . '; ' . home_url(),
				),
				$headers
			),
		);
		if ( null !== $body ) {
			$args['body']                    = wp_json_encode( $body );
			$args['headers']['Content-Type'] = 'application/json';
		}
		$res = wp_remote_request( $o['base_url'] . '/api/v1' . $path, $args );
		if ( is_wp_error( $res ) ) {
			return $res;
		}
		$code = wp_remote_retrieve_response_code( $res );
		$data = json_decode( wp_remote_retrieve_body( $res ), true );
		if ( $code >= 400 ) {
			$msg = is_array( $data ) && isset( $data['error']['message'] ) ? $data['error']['message'] : 'HTTP ' . $code;
			return new WP_Error( is_array( $data ) && isset( $data['error']['code'] ) ? $data['error']['code'] : 'agentify_http_' . $code, $msg, array( 'status' => $code ) );
		}
		return is_array( $data ) ? $data : array();
	}

	/** Absolute address for a path the API returned (for example /uploads/photo.jpg). */
	public static function media_url( $path ) {
		return $path ? self::base_url() . $path : '';
	}
}
