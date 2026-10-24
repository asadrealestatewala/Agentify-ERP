<?php
defined( 'ABSPATH' ) || exit;

/** Receives Agentify change notifications. Anything without a valid signature is refused and nothing is changed. */
class Agentify_Webhook {
	public static function init() {
		add_action( 'rest_api_init', function () {
			register_rest_route( 'agentify/v1', '/webhook', array(
				'methods'             => 'POST',
				'callback'            => array( __CLASS__, 'handle' ),
				'permission_callback' => '__return_true', // authenticated by the signature, not by a WordPress login
			) );
		} );
	}

	public static function valid( $header, $body, $secret, $now = null ) {
		if ( ! $secret || ! $header ) {
			return false;
		}
		$parts = array();
		foreach ( explode( ',', $header ) as $p ) {
			$kv = explode( '=', trim( $p ), 2 );
			if ( 2 === count( $kv ) ) {
				$parts[ $kv[0] ] = $kv[1];
			}
		}
		if ( empty( $parts['t'] ) || empty( $parts['v1'] ) || abs( ( $now ?? time() ) - (int) $parts['t'] ) > 300 ) {
			return false;
		}
		return hash_equals( hash_hmac( 'sha256', $parts['t'] . '.' . $body, $secret ), $parts['v1'] );
	}

	public static function handle( WP_REST_Request $req ) {
		$o = Agentify_Client::options();
		if ( ! self::valid( $req->get_header( 'agentify-signature' ), $req->get_body(), $o['webhook_secret'] ) ) {
			return new WP_REST_Response( array( 'ok' => false ), 401 );
		}
		Agentify_Listings::flush();
		return new WP_REST_Response( array( 'ok' => true ), 200 );
	}
}
