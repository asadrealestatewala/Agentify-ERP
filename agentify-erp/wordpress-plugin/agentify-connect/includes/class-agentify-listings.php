<?php
defined( 'ABSPATH' ) || exit;

/** [agentify_listings]: published listings from Agentify, cached for five minutes and refreshed when Agentify says they changed. */
class Agentify_Listings {
	const TTL = 300;

	public static function init() {
		add_shortcode( 'agentify_listings', array( __CLASS__, 'render' ) );
	}

	public static function flush() {
		update_option( 'agentify_cache_v', (int) get_option( 'agentify_cache_v', 1 ) + 1, false );
	}

	private static function cached( $path ) {
		$key = 'agentify_c_' . (int) get_option( 'agentify_cache_v', 1 ) . '_' . md5( Agentify_Client::base_url() . $path );
		$hit = get_transient( $key );
		if ( false !== $hit ) {
			return $hit;
		}
		$r = Agentify_Client::request( 'GET', $path );
		if ( ! is_wp_error( $r ) ) {
			set_transient( $key, $r, self::TTL );
		}
		return $r;
	}

	private static function error( $e ) {
		return current_user_can( 'manage_options' ) ? '<p><em>' . esc_html( sprintf( 'Agentify Connect: %s', $e->get_error_message() ) ) . '</em></p>' : '';
	}

	private static function price( $l ) {
		return $l['price'] ? esc_html( trim( ( $l['currency'] ?? '' ) . ' ' . number_format_i18n( (float) $l['price'] ) ) ) : '';
	}

	public static function render( $atts = array() ) {
		if ( ! Agentify_Client::is_configured() ) {
			return current_user_can( 'manage_options' ) ? '<p><em>' . esc_html__( 'Agentify Connect: finish the connection under Settings > Agentify Connect.', 'agentify-connect' ) . '</em></p>' : '';
		}
		$ref = isset( $_GET['agentify_listing'] ) ? sanitize_text_field( wp_unslash( $_GET['agentify_listing'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification
		if ( preg_match( '/^[A-Za-z0-9._-]{1,60}$/', $ref ) ) {
			return self::detail( $ref );
		}
		$a    = shortcode_atts( array( 'per_page' => 9, 'city' => '', 'type' => '', 'purpose' => '', 'featured' => '', 'project_id' => '' ), $atts, 'agentify_listings' );
		$page = max( 1, (int) ( $_GET['ag_page'] ?? 1 ) ); // phpcs:ignore WordPress.Security.NonceVerification
		$q    = array( 'per_page' => min( 50, max( 1, (int) $a['per_page'] ) ), 'page' => $page );
		foreach ( array( 'city', 'type', 'purpose', 'project_id' ) as $k ) {
			if ( '' !== $a[ $k ] ) {
				$q[ $k ] = $a[ $k ];
			}
		}
		if ( $a['featured'] ) {
			$q['featured'] = '1';
		}
		$r = self::cached( '/listings?' . http_build_query( $q ) );
		if ( is_wp_error( $r ) ) {
			return self::error( $r );
		}
		if ( empty( $r['data'] ) ) {
			return '<p class="agentify-empty">' . esc_html__( 'No properties to show right now.', 'agentify-connect' ) . '</p>';
		}
		$out = '<div class="agentify-listings" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:16px">';
		foreach ( $r['data'] as $l ) {
			$link = add_query_arg( 'agentify_listing', rawurlencode( $l['code'] ?: $l['id'] ) );
			$out .= '<article class="agentify-card">';
			if ( ! empty( $l['cover_image'] ) ) {
				$out .= '<a href="' . esc_url( $link ) . '"><img src="' . esc_url( Agentify_Client::media_url( $l['cover_image'] ) ) . '" alt="' . esc_attr( $l['title'] ) . '" loading="lazy" style="width:100%;height:auto"></a>';
			}
			$out .= '<h3><a href="' . esc_url( $link ) . '">' . esc_html( $l['title'] ) . '</a></h3>';
			$out .= '<p>' . esc_html( implode( ', ', array_filter( array( $l['area_name'] ?? '', $l['city'] ?? '' ) ) ) ) . '</p>';
			$out .= '<p><strong>' . self::price( $l ) . '</strong></p></article>';
		}
		$out  .= '</div>';
		$pages = (int) ceil( ( $r['total'] ?? 0 ) / max( 1, $r['per_page'] ?? 1 ) );
		if ( $pages > 1 ) {
			$out .= '<nav class="agentify-pages">';
			for ( $i = 1; $i <= $pages; $i++ ) {
				$out .= $i === $page ? '<strong>' . (int) $i . '</strong> ' : '<a href="' . esc_url( add_query_arg( 'ag_page', $i ) ) . '">' . (int) $i . '</a> ';
			}
			$out .= '</nav>';
		}
		return $out;
	}

	private static function detail( $ref ) {
		$l = self::cached( '/listings/' . rawurlencode( $ref ) );
		if ( is_wp_error( $l ) ) {
			return '<p>' . esc_html__( 'This property is no longer available.', 'agentify-connect' ) . '</p><p><a href="' . esc_url( remove_query_arg( 'agentify_listing' ) ) . '">' . esc_html__( 'Back to all properties', 'agentify-connect' ) . '</a></p>';
		}
		$out = '<div class="agentify-detail"><p><a href="' . esc_url( remove_query_arg( 'agentify_listing' ) ) . '">&larr; ' . esc_html__( 'All properties', 'agentify-connect' ) . '</a></p>';
		$out .= '<h2>' . esc_html( $l['title'] ) . '</h2><p><strong>' . self::price( $l ) . '</strong></p>';
		foreach ( array_slice( $l['images'] ?? array(), 0, 8 ) as $img ) {
			$out .= '<img src="' . esc_url( Agentify_Client::media_url( $img['url'] ) ) . '" alt="' . esc_attr( $img['caption'] ?? $l['title'] ) . '" loading="lazy" style="max-width:100%;height:auto;margin:4px 0">';
		}
		$out .= '<div>' . wp_kses_post( wpautop( $l['description'] ?? $l['short_description'] ?? '' ) ) . '</div>';
		$out .= do_shortcode( '[agentify_form title="' . esc_attr__( 'Ask about this property', 'agentify-connect' ) . '" enquiry_type="inquiry" property_ref="' . esc_attr( $l['code'] ?: $l['id'] ) . '"]' );
		return $out . '</div>';
	}
}
