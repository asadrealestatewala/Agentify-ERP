<?php
defined( 'WP_UNINSTALL_PLUGIN' ) || exit;
delete_option( 'agentify_connect' );
delete_option( 'agentify_cache_v' );
