<?php
/**
 * Plugin Name: CreaLibro - Libri illustrati personalizzati
 * Description: Configuratore di libri illustrati personalizzati a doppia pagina: il cliente crea il bambino, sceglie l'ambientazione e compone la storia a blocchi. Editor visuale in wp-admin, carrello WooCommerce e PDF di stampa a pagine singole.
 * Version: 2.0.0
 * Author: Giuseppe Calò
 * Text Domain: crealibro
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class CreaLibro {

	const VERSION = '2.0.0';

	const PHASES = array(
		'equilibrio'     => 'Equilibrio iniziale',
		'rottura'        => 'Rottura dell\'equilibrio',
		'peripezie'      => 'Peripezie dell\'eroe',
		'ristabilimento' => 'Ristabilimento dell\'equilibrio',
	);

	private static $instance = null;
	private $upload_dir;
	private $upload_url;

	public static function get_instance() {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	private function __construct() {
		$upload           = wp_upload_dir();
		$this->upload_dir = trailingslashit( $upload['basedir'] ) . 'crealibro/';
		$this->upload_url = trailingslashit( $upload['baseurl'] ) . 'crealibro/';

		add_action( 'init', array( $this, 'ensure_environment' ) );
		add_shortcode( 'crealibro', array( $this, 'render_shortcode' ) );
		add_action( 'wp_enqueue_scripts', array( $this, 'register_assets' ) );
		add_action( 'admin_enqueue_scripts', array( $this, 'register_admin_assets' ) );

		add_action( 'admin_menu', array( $this, 'register_admin_menu' ) );
		add_action( 'admin_post_crealibro_save_catalog', array( $this, 'handle_save_catalog' ) );

		add_action( 'wp_ajax_crealibro_add_to_cart', array( $this, 'ajax_add_to_cart' ) );
		add_action( 'wp_ajax_nopriv_crealibro_add_to_cart', array( $this, 'ajax_add_to_cart' ) );

		add_filter( 'woocommerce_get_item_data', array( $this, 'display_cart_item_data' ), 10, 2 );
		add_filter( 'woocommerce_cart_item_thumbnail', array( $this, 'custom_cart_thumbnail' ), 10, 3 );
		add_action( 'woocommerce_before_calculate_totals', array( $this, 'lock_custom_book_price' ), 20, 1 );
		add_action( 'woocommerce_checkout_create_order_line_item', array( $this, 'save_order_item_meta' ), 10, 4 );
		add_action( 'add_meta_boxes', array( $this, 'register_order_print_metabox' ) );
	}

	/* =========================================================
	 * Ambiente e catalogo
	 * ========================================================= */

	public function ensure_environment() {
		if ( ! file_exists( $this->upload_dir . 'orders/' ) ) {
			wp_mkdir_p( $this->upload_dir . 'orders/' );
		}
		if ( ! file_exists( $this->upload_dir . 'catalog.json' ) ) {
			$this->write_catalog( $this->get_default_catalog() );
		}
	}

	public function load_catalog() {
		$file = $this->upload_dir . 'catalog.json';
		if ( file_exists( $file ) ) {
			$decoded = json_decode( file_get_contents( $file ), true );
			if ( is_array( $decoded ) && ! empty( $decoded['stages'] ) ) {
				return $decoded;
			}
		}
		return $this->get_default_catalog();
	}

	private function write_catalog( $catalog ) {
		return file_put_contents( $this->upload_dir . 'catalog.json', wp_json_encode( $catalog, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES ) );
	}

	private function get_or_create_wc_product() {
		$product_id = (int) get_option( 'crealibro_wc_product_id', 0 );
		if ( $product_id && get_post_status( $product_id ) === 'publish' ) {
			return $product_id;
		}
		if ( ! class_exists( 'WC_Product_Simple' ) ) {
			return 0;
		}
		$catalog = $this->load_catalog();
		$price   = isset( $catalog['formats'][0]['price'] ) ? (float) $catalog['formats'][0]['price'] : 30;

		$product = new WC_Product_Simple();
		$product->set_name( 'Libro illustrato personalizzato' );
		$product->set_status( 'publish' );
		$product->set_catalog_visibility( 'visible' );
		$product->set_regular_price( (string) $price );
		$product->set_price( (string) $price );
		$product_id = $product->save();
		update_option( 'crealibro_wc_product_id', $product_id );
		return $product_id;
	}

	/* =========================================================
	 * Script e stili
	 * ========================================================= */

	public function register_assets() {
		$url = plugin_dir_url( __FILE__ ) . 'assets/';
		wp_register_script( 'crealibro-engine', $url . 'engine.js', array(), self::VERSION, true );
		wp_register_script( 'crealibro-configurator', $url . 'configurator.js', array( 'crealibro-engine' ), self::VERSION, true );
		wp_register_style( 'crealibro-configurator', $url . 'configurator.css', array(), self::VERSION );
	}

	public function register_admin_assets( $hook ) {
		$url = plugin_dir_url( __FILE__ ) . 'assets/';
		$this->register_assets();

		if ( 'toplevel_page_crealibro' === $hook ) {
			wp_enqueue_media();
			wp_enqueue_style( 'crealibro-admin', $url . 'admin.css', array(), self::VERSION );
			wp_enqueue_script( 'crealibro-admin', $url . 'admin.js', array( 'crealibro-engine' ), self::VERSION, true );
			wp_add_inline_script(
				'crealibro-admin',
				'window.CreaLibroAdminData = ' . wp_json_encode(
					array(
						'catalog' => $this->load_catalog(),
						'phases'  => self::PHASES,
					),
					JSON_UNESCAPED_UNICODE
				) . ';',
				'before'
			);
			return;
		}

		if ( strpos( $hook, 'shop_order' ) !== false || strpos( $hook, 'wc-orders' ) !== false || 'post.php' === $hook ) {
			wp_enqueue_script( 'crealibro-order', $url . 'order.js', array( 'crealibro-engine' ), self::VERSION, true );
		}
	}

	/* =========================================================
	 * Pannello admin
	 * ========================================================= */

	public function register_admin_menu() {
		add_menu_page( 'CreaLibro', 'CreaLibro', 'manage_options', 'crealibro', array( $this, 'render_admin_page' ), 'dashicons-book-alt', 56 );
	}

	public function render_admin_page() {
		// phpcs:disable WordPress.Security.NonceVerification.Recommended
		?>
		<div class="wrap cl-admin">
			<h1>📚 CreaLibro</h1>
			<p class="cl-intro">Inserisci lo shortcode <code>[crealibro]</code> nella pagina in cui vuoi mostrare il configuratore. Le anteprime si aggiornano mentre lavori; le modifiche diventano definitive solo quando premi <strong>Salva il catalogo</strong>.</p>

			<?php if ( isset( $_GET['updated'] ) ) : ?>
				<div class="notice notice-success is-dismissible"><p><strong>Catalogo salvato.</strong> Le modifiche sono già attive nel configuratore.</p></div>
			<?php elseif ( isset( $_GET['cl_error'] ) ) : ?>
				<div class="notice notice-error"><p><strong>Catalogo non salvato:</strong> <?php echo esc_html( sanitize_text_field( wp_unslash( $_GET['cl_error'] ) ) ); ?></p></div>
			<?php endif; ?>

			<div class="cl-admin-layout">
				<div class="cl-admin-main">
					<nav class="cl-tabs" id="cl-tabs"></nav>
					<div id="cl-app"><p>Caricamento dell'editor…</p></div>
				</div>
				<aside class="cl-side" id="cl-side"></aside>
			</div>

			<form method="post" id="cl-save-form" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
				<input type="hidden" name="action" value="crealibro_save_catalog" />
				<input type="hidden" name="catalog_json" id="cl-catalog-json" value="" />
				<?php wp_nonce_field( 'crealibro_save_catalog', 'crealibro_nonce' ); ?>
			</form>
		</div>
		<?php
		// phpcs:enable
	}

	public function handle_save_catalog() {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( 'Permessi insufficienti.' );
		}
		check_admin_referer( 'crealibro_save_catalog', 'crealibro_nonce' );

		$back = add_query_arg( array( 'page' => 'crealibro' ), admin_url( 'admin.php' ) );
		$raw  = isset( $_POST['catalog_json'] ) ? wp_unslash( $_POST['catalog_json'] ) : ''; // phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized
		$data = json_decode( $raw, true );

		if ( ! is_array( $data ) ) {
			wp_safe_redirect( add_query_arg( 'cl_error', rawurlencode( 'dati non leggibili, riprova.' ), $back ) );
			exit;
		}

		$catalog = $this->sanitize_catalog( $data );
		$error   = $this->validate_catalog( $catalog );
		if ( $error ) {
			wp_safe_redirect( add_query_arg( 'cl_error', rawurlencode( $error ), $back ) );
			exit;
		}

		$this->write_catalog( $catalog );
		wp_safe_redirect( add_query_arg( 'updated', '1', $back ) );
		exit;
	}

	/* =========================================================
	 * Pulizia dei dati del catalogo
	 * ========================================================= */

	private function s_text( $v, $max = 200 ) {
		return mb_substr( sanitize_text_field( (string) $v ), 0, $max );
	}

	private function s_area( $v ) {
		return sanitize_textarea_field( (string) $v );
	}

	private function s_url( $v ) {
		return esc_url_raw( trim( (string) $v ) );
	}

	private function s_hex( $v, $fallback ) {
		$c = sanitize_hex_color( (string) $v );
		return $c ? $c : $fallback;
	}

	private function s_num( $v, $min, $max, $fallback ) {
		if ( ! is_numeric( $v ) ) {
			return (float) $fallback;
		}
		return round( max( $min, min( $max, (float) $v ) ), 3 );
	}

	private function s_id( $v, $prefix, &$used ) {
		$id = str_replace( '-', '_', sanitize_key( (string) $v ) );
		if ( '' === $id ) {
			$id = $prefix . '_' . ( count( $used ) + 1 );
		}
		$base = $id;
		$n    = 2;
		while ( in_array( $id, $used, true ) ) {
			$id = $base . '_' . $n++;
		}
		$used[] = $id;
		return $id;
	}

	private function s_tokens( $v ) {
		$out = array();
		if ( ! is_array( $v ) ) {
			return $out;
		}
		foreach ( $v as $key => $val ) {
			$k = preg_replace( '/[^a-z0-9_]/', '', strtolower( (string) $key ) );
			if ( '' !== $k ) {
				$out[ $k ] = $this->s_area( $val );
			}
		}
		return $out;
	}

	private function s_slot( $v, $show = null ) {
		$v   = is_array( $v ) ? $v : array();
		$out = array(
			'x'        => $this->s_num( $v['x'] ?? null, -50, 150, 50 ),
			'y'        => $this->s_num( $v['y'] ?? null, -50, 150, 50 ),
			'scale'    => $this->s_num( $v['scale'] ?? null, 0.02, 3, 0.5 ),
			'rotation' => $this->s_num( $v['rotation'] ?? null, -180, 180, 0 ),
		);
		if ( null !== $show ) {
			$out['show'] = isset( $v['show'] ) ? (bool) $v['show'] : $show;
		}
		return $out;
	}

	private function s_text_slot( $v, $with_text = false ) {
		$v   = is_array( $v ) ? $v : array();
		$out = array(
			'x'     => $this->s_num( $v['x'] ?? null, -50, 150, 50 ),
			'y'     => $this->s_num( $v['y'] ?? null, -50, 150, 20 ),
			'w'     => $this->s_num( $v['w'] ?? null, 5, 200, 40 ),
			'size'  => $this->s_num( $v['size'] ?? null, 0.3, 5, 1 ),
			'align' => in_array( $v['align'] ?? '', array( 'left', 'center', 'right' ), true ) ? $v['align'] : 'left',
			'panel' => ! empty( $v['panel'] ),
		);
		if ( $with_text ) {
			$out['text'] = $this->s_area( $v['text'] ?? '' );
			$out['show'] = isset( $v['show'] ) ? (bool) $v['show'] : true;
		}
		return $out;
	}

	private function s_bg( $v, $color ) {
		$v = is_array( $v ) ? $v : array();
		return array(
			'bg_image' => $this->s_url( $v['bg_image'] ?? '' ),
			'bg_color' => $this->s_hex( $v['bg_color'] ?? '', $color ),
		);
	}

	public function sanitize_catalog( $in ) {
		$out = array( 'version' => 2 );

		// Formati
		$used           = array();
		$out['formats'] = array();
		foreach ( (array) ( $in['formats'] ?? array() ) as $f ) {
			if ( ! is_array( $f ) || '' === trim( (string) ( $f['label'] ?? '' ) ) ) {
				continue;
			}
			$cover            = is_array( $f['cover'] ?? null ) ? $f['cover'] : array();
			$out['formats'][] = array(
				'id'                 => $this->s_id( $f['id'] ?? '', 'formato', $used ),
				'label'              => $this->s_text( $f['label'] ),
				'description'        => $this->s_text( $f['description'] ?? '', 300 ),
				'trim_mm'            => $this->s_num( $f['trim_mm'] ?? null, 50, 600, 200 ),
				'bleed_mm'           => $this->s_num( $f['bleed_mm'] ?? null, 0, 20, 3 ),
				'price'              => $this->s_num( $f['price'] ?? null, 0, 100000, 0 ),
				'gelato_product_uid' => $this->s_text( $f['gelato_product_uid'] ?? '', 300 ),
				'enabled'            => ! empty( $f['enabled'] ),
				'blank_endpapers'    => ! empty( $f['blank_endpapers'] ),
				'cover'              => array(
					'width_mm'  => $this->s_num( $cover['width_mm'] ?? null, 0, 2000, 0 ),
					'height_mm' => $this->s_num( $cover['height_mm'] ?? null, 0, 2000, 0 ),
					'spine_mm'  => $this->s_num( $cover['spine_mm'] ?? null, 0, 200, 0 ),
				),
			);
		}

		// Palette
		$out['palettes'] = array();
		foreach ( array( 'skin', 'hair', 'eyes', 'shirt' ) as $pk ) {
			$out['palettes'][ $pk ] = array();
			foreach ( (array) ( $in['palettes'][ $pk ] ?? array() ) as $c ) {
				if ( ! is_array( $c ) ) {
					continue;
				}
				$out['palettes'][ $pk ][] = array(
					'label' => $this->s_text( $c['label'] ?? '' ),
					'hex'   => $this->s_hex( $c['hex'] ?? '', '#000000' ),
				);
			}
		}

		// Acconciature (SVG incollato dall'amministratore, mostrato solo come immagine)
		$used               = array();
		$out['hair_styles'] = array();
		foreach ( (array) ( $in['hair_styles'] ?? array() ) as $h ) {
			if ( ! is_array( $h ) || '' === trim( (string) ( $h['label'] ?? '' ) ) ) {
				continue;
			}
			$out['hair_styles'][] = array(
				'id'    => $this->s_id( $h['id'] ?? '', 'capelli', $used ),
				'label' => $this->s_text( $h['label'] ),
				'svg'   => (string) ( $h['svg'] ?? '' ),
			);
		}

		// Pagine fisse
		$fp                 = is_array( $in['fixed_pages'] ?? null ) ? $in['fixed_pages'] : array();
		$tp                 = is_array( $fp['title_page'] ?? null ) ? $fp['title_page'] : array();
		$out['fixed_pages'] = array(
			'title_template'    => $this->s_text( $fp['title_template'] ?? '', 300 ),
			'subtitle_template' => $this->s_text( $fp['subtitle_template'] ?? '', 300 ),
			'title_page'        => array_merge(
				$this->s_bg( $tp, '#FFFFFF' ),
				array(
					'avatar'   => $this->s_slot( $tp['avatar'] ?? null ),
					'title'    => $this->s_text_slot( $tp['title'] ?? null ),
					'subtitle' => $this->s_text_slot( $tp['subtitle'] ?? null ),
				)
			),
			'rispetto'          => array(
				'start' => $this->s_bg( $fp['rispetto']['start'] ?? null, '#F1F5F9' ),
				'end'   => $this->s_bg( $fp['rispetto']['end'] ?? null, '#F1F5F9' ),
			),
			'branding'          => $this->s_bg( $fp['branding'] ?? null, '#FFFFFF' ),
			'back_cover'        => $this->s_bg( $fp['back_cover'] ?? null, '#1E293B' ),
			'spine_color'       => $this->s_hex( $fp['spine_color'] ?? '', '#1E293B' ),
		);

		// Ambientazioni
		$used            = array();
		$out['settings'] = array();
		foreach ( (array) ( $in['settings'] ?? array() ) as $s ) {
			if ( ! is_array( $s ) || '' === trim( (string) ( $s['label'] ?? '' ) ) ) {
				continue;
			}
			$cv                = is_array( $s['cover'] ?? null ) ? $s['cover'] : array();
			$out['settings'][] = array(
				'id'             => $this->s_id( $s['id'] ?? '', 'ambientazione', $used ),
				'label'          => $this->s_text( $s['label'] ),
				'description'    => $this->s_text( $s['description'] ?? '', 300 ),
				'cover_image'    => $this->s_url( $s['cover_image'] ?? '' ),
				'rispetto_image' => $this->s_url( $s['rispetto_image'] ?? '' ),
				'bg_sky'         => $this->s_hex( $s['bg_sky'] ?? '', '#DCFCE7' ),
				'bg_ground'      => $this->s_hex( $s['bg_ground'] ?? '', '#15803D' ),
				'bg_decor'       => in_array( $s['bg_decor'] ?? '', array( 'trees', 'stars', 'waves', 'none' ), true ) ? $s['bg_decor'] : 'trees',
				'tokens'         => $this->s_tokens( $s['tokens'] ?? array() ),
				'cover'          => array(
					'avatar'   => $this->s_slot( $cv['avatar'] ?? null ),
					'title'    => $this->s_text_slot( $cv['title'] ?? null ),
					'subtitle' => $this->s_text_slot( $cv['subtitle'] ?? null ),
				),
			);
		}
		$setting_ids = wp_list_pluck( $out['settings'], 'id' );

		// Tappe e blocchi della storia
		$used_stage    = array();
		$used_block    = array();
		$out['stages'] = array();
		foreach ( (array) ( $in['stages'] ?? array() ) as $st ) {
			if ( ! is_array( $st ) ) {
				continue;
			}
			$blocks = array();
			foreach ( (array) ( $st['blocks'] ?? array() ) as $b ) {
				if ( ! is_array( $b ) || '' === trim( (string) ( $b['label'] ?? '' ) ) ) {
					continue;
				}
				$spreads = array();
				for ( $k = 0; $k < 2; $k++ ) {
					$sp        = is_array( $b['spreads'][ $k ] ?? null ) ? $b['spreads'][ $k ] : array();
					$els       = is_array( $sp['elements'] ?? null ) ? $sp['elements'] : array();
					$texts     = array();
					for ( $t = 0; $t < 2; $t++ ) {
						$texts[] = $this->s_text_slot( $sp['texts'][ $t ] ?? null, true );
					}
					$spreads[] = array(
						'bg_image'  => $this->s_url( $sp['bg_image'] ?? '' ),
						'npc_image' => $this->s_url( $sp['npc_image'] ?? '' ),
						'elements'  => array(
							'avatar' => $this->s_slot( $els['avatar'] ?? null, true ),
							'npc'    => $this->s_slot( $els['npc'] ?? null, false ),
							'prop'   => $this->s_slot( $els['prop'] ?? null, false ),
						),
						'texts'     => $texts,
					);
				}
				$blocks[] = array(
					'id'          => $this->s_id( $b['id'] ?? '', 'blocco', $used_block ),
					'label'       => $this->s_text( $b['label'] ),
					'description' => $this->s_text( $b['description'] ?? '', 300 ),
					'settings'    => array_values( array_intersect( array_map( 'strval', (array) ( $b['settings'] ?? array() ) ), $setting_ids ) ),
					'prop_image'  => $this->s_url( $b['prop_image'] ?? '' ),
					'tokens'      => $this->s_tokens( $b['tokens'] ?? array() ),
					'spreads'     => $spreads,
				);
			}
			$out['stages'][] = array(
				'id'     => $this->s_id( $st['id'] ?? '', 'tappa', $used_stage ),
				'label'  => $this->s_text( $st['label'] ?? '' ),
				'phase'  => isset( self::PHASES[ $st['phase'] ?? '' ] ) ? $st['phase'] : 'peripezie',
				'blocks' => $blocks,
			);
		}

		return $out;
	}

	private function validate_catalog( $c ) {
		if ( empty( $c['formats'] ) ) {
			return 'serve almeno un formato.';
		}
		if ( empty( $c['settings'] ) ) {
			return 'serve almeno un\'ambientazione.';
		}
		if ( empty( $c['hair_styles'] ) ) {
			return 'serve almeno un\'acconciatura.';
		}
		if ( empty( $c['stages'] ) ) {
			return 'serve almeno una tappa della storia.';
		}
		foreach ( $c['stages'] as $i => $st ) {
			if ( empty( $st['blocks'] ) ) {
				return sprintf( 'la tappa %d («%s») non ha nessun blocco.', $i + 1, $st['label'] );
			}
			foreach ( $c['settings'] as $s ) {
				$ok = false;
				foreach ( $st['blocks'] as $b ) {
					if ( empty( $b['settings'] ) || in_array( $s['id'], $b['settings'], true ) ) {
						$ok = true;
						break;
					}
				}
				if ( ! $ok ) {
					return sprintf( 'nella tappa %d («%s») nessun blocco è disponibile per l\'ambientazione «%s».', $i + 1, $st['label'], $s['label'] );
				}
			}
		}
		return '';
	}

	/* =========================================================
	 * Shortcode [crealibro]
	 * ========================================================= */

	public function render_shortcode( $atts ) {
		$atts       = shortcode_atts( array( 'product_id' => 0 ), $atts );
		$product_id = (int) $atts['product_id'];
		if ( ! $product_id ) {
			$product_id = $this->get_or_create_wc_product();
		}

		wp_enqueue_style( 'crealibro-configurator' );
		wp_enqueue_script( 'crealibro-configurator' );
		wp_add_inline_script(
			'crealibro-configurator',
			'window.CreaLibroData = ' . wp_json_encode(
				array(
					'ajaxUrl'   => admin_url( 'admin-ajax.php' ),
					'nonce'     => wp_create_nonce( 'crealibro_nonce' ),
					'productId' => $product_id,
					'currency'  => function_exists( 'get_woocommerce_currency' ) ? get_woocommerce_currency() : 'EUR',
					'catalog'   => $this->public_catalog(),
				),
				JSON_UNESCAPED_UNICODE
			) . ';',
			'before'
		);

		return '<div id="crealibro-app" class="clc-app"><p class="clc-loading">Caricamento del configuratore…</p></div>';
	}

	/** Catalogo per il cliente: solo i formati attivi, senza dati interni. */
	private function public_catalog() {
		$c            = $this->load_catalog();
		$c['formats'] = array_values(
			array_filter(
				$c['formats'],
				function ( $f ) {
					return ! empty( $f['enabled'] );
				}
			)
		);
		foreach ( $c['formats'] as &$f ) {
			unset( $f['gelato_product_uid'] );
		}
		unset( $f );
		return $c;
	}

	/* =========================================================
	 * Carrello
	 * ========================================================= */

	private function find_by_id( $list, $id ) {
		foreach ( (array) $list as $item ) {
			if ( isset( $item['id'] ) && $item['id'] === $id ) {
				return $item;
			}
		}
		return null;
	}

	/**
	 * Controlla le scelte del cliente sul catalogo attuale e restituisce
	 * selezione pulita, bambino pulito e "fotografia" del catalogo per la stampa.
	 */
	private function build_order_data( $config ) {
		$c   = $this->load_catalog();
		$sel = is_array( $config['selection'] ?? null ) ? $config['selection'] : array();

		$format = $this->find_by_id( $c['formats'], (string) ( $sel['format'] ?? '' ) );
		if ( ! $format || empty( $format['enabled'] ) ) {
			return new WP_Error( 'format', 'Formato non disponibile.' );
		}
		$setting = $this->find_by_id( $c['settings'], (string) ( $sel['setting'] ?? '' ) );
		if ( ! $setting ) {
			return new WP_Error( 'setting', 'Ambientazione non valida.' );
		}

		$snap_stages = array();
		$block_ids   = array();
		$labels      = array();
		foreach ( $c['stages'] as $st ) {
			$bid   = (string) ( $sel['blocks'][ $st['id'] ] ?? '' );
			$block = $this->find_by_id( $st['blocks'], $bid );
			if ( ! $block || ( ! empty( $block['settings'] ) && ! in_array( $setting['id'], $block['settings'], true ) ) ) {
				return new WP_Error( 'block', sprintf( 'Scelta mancante o non valida nella tappa «%s».', $st['label'] ) );
			}
			$snap_stages[]          = array_merge( $st, array( 'blocks' => array( $block ) ) );
			$block_ids[ $st['id'] ] = $block['id'];
			$labels[]               = $block['label'];
		}

		$ch    = is_array( $config['child'] ?? null ) ? $config['child'] : array();
		$hair  = $this->find_by_id( $c['hair_styles'], (string) ( $ch['hairStyle'] ?? '' ) );
		$hair  = $hair ? $hair : $c['hair_styles'][0];
		$child = array(
			'name'       => mb_substr( sanitize_text_field( (string) ( $ch['name'] ?? '' ) ), 0, 22 ),
			'gender'     => ( 'F' === ( $ch['gender'] ?? '' ) ) ? 'F' : 'M',
			'hairStyle'  => $hair['id'],
			'skinColor'  => $this->s_hex( $ch['skinColor'] ?? '', '#FAD7B8' ),
			'hairColor'  => $this->s_hex( $ch['hairColor'] ?? '', '#4A2511' ),
			'eyeColor'   => $this->s_hex( $ch['eyeColor'] ?? '', '#2980B9' ),
			'shirtColor' => $this->s_hex( $ch['shirtColor'] ?? '', '#E11D48' ),
			'glasses'    => ( 'round' === ( $ch['glasses'] ?? '' ) ) ? 'round' : 'none',
		);
		if ( '' === $child['name'] ) {
			return new WP_Error( 'name', 'Inserisci il nome del bambino o della bambina.' );
		}

		return array(
			'selection' => array(
				'format'  => $format['id'],
				'setting' => $setting['id'],
				'blocks'  => $block_ids,
			),
			'child'     => $child,
			'format'    => $format,
			'setting'   => $setting,
			'summary'   => $setting['label'] . ' → ' . implode( ' → ', $labels ),
			// Fotografia del catalogo: il PDF d'ordine resta identico anche se il catalogo cambia
			'snapshot'  => array(
				'version'     => 2,
				'formats'     => array( $format ),
				'palettes'    => array(),
				'hair_styles' => array( $hair ),
				'fixed_pages' => $c['fixed_pages'],
				'settings'    => array( $setting ),
				'stages'      => $snap_stages,
			),
		);
	}

	public function ajax_add_to_cart() {
		check_ajax_referer( 'crealibro_nonce', 'nonce' );
		if ( ! function_exists( 'WC' ) ) {
			wp_send_json_error( array( 'message' => 'WooCommerce non è attivo sul sito.' ) );
		}

		$product_id = $this->get_or_create_wc_product();
		$avatar_b64 = isset( $_POST['avatar_png'] ) ? (string) wp_unslash( $_POST['avatar_png'] ) : ''; // phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized
		$config     = json_decode( isset( $_POST['config'] ) ? wp_unslash( $_POST['config'] ) : '', true ); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized

		if ( ! $product_id || ! is_array( $config ) || '' === $avatar_b64 ) {
			wp_send_json_error( array( 'message' => 'Dati di configurazione incompleti.' ) );
		}

		$data = $this->build_order_data( $config );
		if ( is_wp_error( $data ) ) {
			wp_send_json_error( array( 'message' => $data->get_error_message() ) );
		}

		$avatar_url = $this->save_base64_png( $avatar_b64, 'avatar' );
		if ( ! $avatar_url ) {
			wp_send_json_error( array( 'message' => 'Impossibile salvare l\'immagine del personaggio.' ) );
		}

		$cart_item_data = array(
			'crealibro'  => array(
				'selection'  => $data['selection'],
				'child'      => $data['child'],
				'snapshot'   => $data['snapshot'],
				'summary'    => $data['summary'],
				'format'     => $data['format']['label'],
				'price'      => (float) $data['format']['price'],
				'avatar_url' => $avatar_url,
			),
			'unique_key' => md5( microtime() . wp_rand() ),
		);

		if ( ! WC()->cart->add_to_cart( $product_id, 1, 0, array(), $cart_item_data ) ) {
			wp_send_json_error( array( 'message' => 'Errore durante l\'inserimento nel carrello.' ) );
		}

		wp_send_json_success(
			array(
				'message'  => 'Libro aggiunto al carrello!',
				'cart_url' => wc_get_cart_url(),
			)
		);
	}

	private function save_base64_png( $base64, $prefix ) {
		if ( strpos( $base64, 'data:image/png;base64,' ) !== 0 ) {
			return false;
		}
		$data = base64_decode( substr( $base64, strpos( $base64, ',' ) + 1 ), true );
		if ( ! $data || strlen( $data ) > 5 * 1024 * 1024 || substr( $data, 0, 8 ) !== "\x89PNG\r\n\x1a\n" ) {
			return false;
		}
		$filename = $prefix . '-' . gmdate( 'Ymd-His' ) . '-' . wp_generate_password( 6, false ) . '.png';
		if ( file_put_contents( $this->upload_dir . 'orders/' . $filename, $data ) ) {
			return $this->upload_url . 'orders/' . $filename;
		}
		return false;
	}

	public function display_cart_item_data( $item_data, $cart_item ) {
		if ( empty( $cart_item['crealibro'] ) ) {
			return $item_data;
		}
		$cl          = $cart_item['crealibro'];
		$item_data[] = array(
			'key'   => 'Protagonista',
			'value' => esc_html( $cl['child']['name'] . ' (' . ( 'F' === $cl['child']['gender'] ? 'bambina' : 'bambino' ) . ')' ),
		);
		$item_data[] = array( 'key' => 'Formato', 'value' => esc_html( $cl['format'] ) );
		$item_data[] = array( 'key' => 'Storia', 'value' => esc_html( $cl['summary'] ) );
		return $item_data;
	}

	public function custom_cart_thumbnail( $image, $cart_item, $cart_item_key ) {
		if ( ! empty( $cart_item['crealibro']['avatar_url'] ) ) {
			return '<img src="' . esc_url( $cart_item['crealibro']['avatar_url'] ) . '" style="width:72px;height:72px;background:#f1f5f9;border-radius:8px;object-fit:contain;" alt="" />';
		}
		return $image;
	}

	public function lock_custom_book_price( $cart ) {
		if ( is_admin() && ! defined( 'DOING_AJAX' ) ) {
			return;
		}
		foreach ( $cart->get_cart() as $item ) {
			if ( isset( $item['crealibro']['price'] ) ) {
				$item['data']->set_price( (float) $item['crealibro']['price'] );
			}
		}
	}

	public function save_order_item_meta( $item, $cart_item_key, $values, $order ) {
		if ( empty( $values['crealibro'] ) ) {
			return;
		}
		$cl = $values['crealibro'];
		$item->add_meta_data( 'Protagonista', $cl['child']['name'], true );
		$item->add_meta_data( 'Formato', $cl['format'], true );
		$item->add_meta_data( 'Storia', $cl['summary'], true );
		$item->add_meta_data( '_crealibro_avatar_png', $cl['avatar_url'], true );
		$item->add_meta_data(
			'_crealibro_order',
			wp_json_encode(
				array(
					'selection' => $cl['selection'],
					'child'     => $cl['child'],
					'snapshot'  => $cl['snapshot'],
				),
				JSON_UNESCAPED_UNICODE
			),
			true
		);
	}

	/* =========================================================
	 * Pagina ordine: PDF di stampa
	 * ========================================================= */

	public function register_order_print_metabox() {
		foreach ( array( 'shop_order', 'woocommerce_page_wc-orders' ) as $screen ) {
			add_meta_box( 'crealibro_print', 'Stampa libro (CreaLibro)', array( $this, 'render_order_print_metabox' ), $screen, 'normal', 'high' );
		}
	}

	public function render_order_print_metabox( $post_or_order ) {
		$order = ( $post_or_order instanceof WC_Order ) ? $post_or_order : wc_get_order( $post_or_order->ID );
		if ( ! $order ) {
			return;
		}
		$found = false;
		foreach ( $order->get_items() as $item_id => $item ) {
			$raw = $item->get_meta( '_crealibro_order' );
			if ( ! $raw ) {
				continue;
			}
			$found  = true;
			$avatar = $item->get_meta( '_crealibro_avatar_png' );
			?>
			<div style="display:flex;align-items:center;gap:16px;padding:12px;border:1px solid #dcdcde;border-radius:6px;margin-bottom:12px;background:#f6f7f7;">
				<?php if ( $avatar ) : ?>
					<img src="<?php echo esc_url( $avatar ); ?>" style="width:90px;height:90px;background:#fff;border-radius:6px;border:1px solid #dcdcde;" alt="" />
				<?php endif; ?>
				<div style="flex:1;">
					<h4 style="margin:0 0 6px;">Riga #<?php echo esc_html( $item_id ); ?> — <?php echo esc_html( $item->get_meta( 'Protagonista' ) ); ?> · <?php echo esc_html( $item->get_meta( 'Formato' ) ); ?></h4>
					<p style="margin:0 0 8px;color:#50575e;"><?php echo esc_html( $item->get_meta( 'Storia' ) ); ?></p>
					<button type="button" class="button button-primary crealibro-print-btn" data-order="<?php echo esc_attr( $raw ); ?>">⬇ Genera PDF di stampa (300 DPI)</button>
					<span class="crealibro-print-status" style="margin-left:8px;color:#50575e;"></span>
				</div>
			</div>
			<?php
		}
		if ( ! $found ) {
			echo '<p>In questo ordine non ci sono libri personalizzati.</p>';
		}
	}

	/* =========================================================
	 * Catalogo di partenza (testi e posizioni di esempio)
	 * ========================================================= */

	private function spread( $text_a, $text_b = '', $layout = 'left', $extra = array() ) {
		$avatar_x = 'left' === $layout ? 27 : 73;
		$text_x   = 'left' === $layout ? 75 : 25;
		$sp       = array(
			'bg_image'  => '',
			'npc_image' => '',
			'elements'  => array(
				'avatar' => array( 'x' => $avatar_x, 'y' => 57, 'scale' => 0.6, 'rotation' => 0, 'show' => true ),
				'npc'    => array( 'x' => 'left' === $layout ? 60 : 40, 'y' => 55, 'scale' => 0.5, 'rotation' => 0, 'show' => false ),
				'prop'   => array( 'x' => 'left' === $layout ? 40 : 60, 'y' => 60, 'scale' => 0.2, 'rotation' => 0, 'show' => false ),
			),
			'texts'     => array(
				array( 'text' => $text_a, 'show' => true, 'x' => $text_x, 'y' => 17, 'w' => 40, 'size' => 1, 'align' => 'left', 'panel' => true ),
				array( 'text' => $text_b, 'show' => '' !== $text_b, 'x' => 100 - $text_x, 'y' => 17, 'w' => 40, 'size' => 1, 'align' => 'left', 'panel' => true ),
			),
		);
		foreach ( $extra as $el => $show ) {
			$sp['elements'][ $el ]['show'] = $show;
		}
		return $sp;
	}

	private function block( $id, $label, $description, $tokens, $spreads, $prop_image = '' ) {
		return array(
			'id'          => $id,
			'label'       => $label,
			'description' => $description,
			'settings'    => array(),
			'prop_image'  => $prop_image,
			'tokens'      => $tokens,
			'spreads'     => $spreads,
		);
	}

	public function get_default_catalog() {
		$cover = array(
			'avatar'   => array( 'x' => 50, 'y' => 63, 'scale' => 0.62, 'rotation' => 0 ),
			'title'    => array( 'x' => 50, 'y' => 15, 'w' => 86, 'size' => 1.7, 'align' => 'center', 'panel' => true ),
			'subtitle' => array( 'x' => 50, 'y' => 31, 'w' => 80, 'size' => 1, 'align' => 'center', 'panel' => false ),
		);

		return array(
			'version'     => 2,
			'formats'     => array(
				array(
					'id'                 => 'rigida_20',
					'label'              => 'Copertina rigida 20×20 cm',
					'description'        => 'Il formato classico, con copertina rigida.',
					'trim_mm'            => 200,
					'bleed_mm'           => 3,
					'price'              => 30,
					'gelato_product_uid' => '',
					'enabled'            => true,
					'blank_endpapers'    => true,
					'cover'              => array( 'width_mm' => 0, 'height_mm' => 0, 'spine_mm' => 0 ),
				),
				array(
					'id'                 => 'morbida_14',
					'label'              => 'Copertina morbida 14×14 cm',
					'description'        => 'Più piccolo e leggero, con copertina morbida.',
					'trim_mm'            => 140,
					'bleed_mm'           => 3,
					'price'              => 19,
					'gelato_product_uid' => '',
					'enabled'            => true,
					'blank_endpapers'    => true,
					'cover'              => array( 'width_mm' => 0, 'height_mm' => 0, 'spine_mm' => 0 ),
				),
			),
			'palettes'    => array(
				'skin'  => array(
					array( 'label' => 'Chiara', 'hex' => '#FAD7B8' ),
					array( 'label' => 'Media', 'hex' => '#EAA87B' ),
					array( 'label' => 'Olivastra', 'hex' => '#C68652' ),
					array( 'label' => 'Ambrata', 'hex' => '#8D5524' ),
				),
				'hair'  => array(
					array( 'label' => 'Castano', 'hex' => '#4A2511' ),
					array( 'label' => 'Biondo', 'hex' => '#E6B84C' ),
					array( 'label' => 'Nero', 'hex' => '#1E1B18' ),
					array( 'label' => 'Rosso', 'hex' => '#B83B2A' ),
				),
				'eyes'  => array(
					array( 'label' => 'Azzurri', 'hex' => '#2980B9' ),
					array( 'label' => 'Nocciola', 'hex' => '#6E4720' ),
					array( 'label' => 'Verdi', 'hex' => '#27AE60' ),
					array( 'label' => 'Scuri', 'hex' => '#2C221E' ),
				),
				'shirt' => array(
					array( 'label' => 'Rosso', 'hex' => '#E11D48' ),
					array( 'label' => 'Blu', 'hex' => '#2563EB' ),
					array( 'label' => 'Verde', 'hex' => '#059669' ),
					array( 'label' => 'Giallo', 'hex' => '#D97706' ),
				),
			),
			'hair_styles' => array(
				array( 'id' => 'short_tuft', 'label' => 'Ciuffo ribelle', 'svg' => '<path class="fill-hair" d="M290,330 C275,210 380,145 505,150 C635,155 725,220 710,330 C680,265 620,235 510,235 C410,235 345,260 290,330 Z M450,155 C480,105 555,105 585,155 Z"/>' ),
				array( 'id' => 'curly_cloud', 'label' => 'Riccioli morbidi', 'svg' => '<g class="fill-hair"><circle cx="340" cy="250" r="68"/><circle cx="425" cy="195" r="78"/><circle cx="535" cy="190" r="82"/><circle cx="635" cy="240" r="72"/><circle cx="295" cy="320" r="52"/><circle cx="695" cy="315" r="52"/></g>' ),
				array( 'id' => 'long_bob', 'label' => 'Caschetto lungo', 'svg' => '<path class="fill-hair" d="M275,490 C255,340 280,160 500,160 C720,160 745,340 725,490 C695,495 680,450 680,350 C650,245 350,245 320,350 C320,450 305,495 275,490 Z"/>' ),
				array( 'id' => 'twin_buns', 'label' => 'Doppio chignon', 'svg' => '<g class="fill-hair"><circle cx="305" cy="185" r="65"/><circle cx="695" cy="185" r="65"/><path d="M290,340 C285,200 390,155 500,155 C610,155 715,200 710,340 C665,250 335,250 290,340 Z"/></g>' ),
			),
			'fixed_pages' => array(
				'title_template'    => 'Il grande viaggio di {nome}',
				'subtitle_template' => 'Un\'avventura {nel_luogo}',
				'title_page'        => array(
					'bg_image' => '',
					'bg_color' => '#FFFFFF',
					'avatar'   => array( 'x' => 50, 'y' => 63, 'scale' => 0.5, 'rotation' => 0 ),
					'title'    => array( 'x' => 50, 'y' => 17, 'w' => 84, 'size' => 2, 'align' => 'center', 'panel' => false ),
					'subtitle' => array( 'x' => 50, 'y' => 29, 'w' => 80, 'size' => 1, 'align' => 'center', 'panel' => false ),
				),
				'rispetto'          => array(
					'start' => array( 'bg_image' => '', 'bg_color' => '#F1F5F9' ),
					'end'   => array( 'bg_image' => '', 'bg_color' => '#F1F5F9' ),
				),
				'branding'          => array( 'bg_image' => '', 'bg_color' => '#FFFFFF' ),
				'back_cover'        => array( 'bg_image' => '', 'bg_color' => '#1E293B' ),
				'spine_color'       => '#1E293B',
			),
			'settings'    => array(
				array(
					'id'             => 'bosco',
					'label'          => 'Il Bosco dei Sussurri',
					'description'    => 'Un bosco antico dove gli alberi parlano al vento.',
					'cover_image'    => '',
					'rispetto_image' => '',
					'bg_sky'         => '#DCFCE7',
					'bg_ground'      => '#15803D',
					'bg_decor'       => 'trees',
					'tokens'         => array( 'luogo' => 'il Bosco dei Sussurri', 'nel_luogo' => 'nel Bosco dei Sussurri' ),
					'cover'          => $cover,
				),
				array(
					'id'             => 'spazio',
					'label'          => 'La Stazione degli Anelli',
					'description'    => 'Una base spaziale sospesa tra le comete.',
					'cover_image'    => '',
					'rispetto_image' => '',
					'bg_sky'         => '#0F172A',
					'bg_ground'      => '#475569',
					'bg_decor'       => 'stars',
					'tokens'         => array( 'luogo' => 'la Stazione degli Anelli', 'nel_luogo' => 'sulla Stazione degli Anelli' ),
					'cover'          => $cover,
				),
				array(
					'id'             => 'mare',
					'label'          => 'La Baia di Corallo',
					'description'    => 'Una baia di acqua cristallina piena di conchiglie.',
					'cover_image'    => '',
					'rispetto_image' => '',
					'bg_sky'         => '#CFFAFE',
					'bg_ground'      => '#0284C7',
					'bg_decor'       => 'waves',
					'tokens'         => array( 'luogo' => 'la Baia di Corallo', 'nel_luogo' => 'nella Baia di Corallo' ),
					'cover'          => $cover,
				),
			),
			'stages'      => array(
				array(
					'id'     => 'tappa_1',
					'label'  => 'La vita di ogni giorno',
					'phase'  => 'equilibrio',
					'blocks' => array(
						$this->block(
							'giornata_di_giochi',
							'Una giornata di giochi',
							'Conosciamo il protagonista nel suo mondo.',
							array(),
							array(
								$this->spread( 'C\'era una volta {nome}, {un_una} bambin{o_a} che viveva {nel_luogo} e ne conosceva ogni angolo segreto.' ),
								$this->spread( 'Ogni mattina {nome} salutava gli amici, raccoglieva piccoli tesori e la sera tornava a casa con le tasche piene di meraviglie.', '', 'right' ),
							)
						),
						$this->block(
							'diario_scoperte',
							'Il diario delle scoperte',
							'Il protagonista disegna tutto quello che scopre.',
							array(),
							array(
								$this->spread( '{nome} aveva un quaderno speciale dove disegnava tutto quello che scopriva {nel_luogo}.' ),
								$this->spread( 'Pagina dopo pagina, il quaderno si riempiva di colori, mappe e nomi buffi inventati da {nome}.', '', 'right' ),
							)
						),
					),
				),
				array(
					'id'     => 'tappa_2',
					'label'  => 'Il guaio',
					'phase'  => 'rottura',
					'blocks' => array(
						$this->block(
							'colori_rubati',
							'I colori rubati',
							'Qualcuno si porta via tutti i colori.',
							array(
								'antagonista' => 'il Gigante Mangia-Colori',
								'lieto_fine'  => 'i colori tornarono al loro posto',
							),
							array(
								$this->spread( 'Un mattino {nome} si svegliò e trovò ogni cosa grigia: durante la notte qualcuno si era portato via tutti i colori.' ),
								$this->spread( 'Seguendo le impronte enormi lasciate nel fango, {nome} capì chi era stato: il Gigante Mangia-Colori!', '', 'right', array( 'npc' => true ) ),
							)
						),
						$this->block(
							'grande_nebbia',
							'La grande nebbia',
							'Una nebbia fitta nasconde il sole.',
							array(
								'antagonista' => 'il Drago Raffreddato',
								'lieto_fine'  => 'la nebbia sparì e il sole tornò a splendere',
							),
							array(
								$this->spread( 'Un giorno una nebbia fitta coprì il cielo e {nel_luogo} nessuno riusciva più a vedere il sole.' ),
								$this->spread( 'Da lontano arrivava uno starnuto fortissimo: era il Drago Raffreddato, e ogni starnuto faceva ancora più nebbia.', '', 'right', array( 'npc' => true ) ),
							)
						),
					),
				),
				array(
					'id'     => 'tappa_3',
					'label'  => 'L\'incontro',
					'phase'  => 'peripezie',
					'blocks' => array(
						$this->block(
							'gufo_meccanico',
							'Il Gufo Meccanico',
							'Un aiutante da riparare.',
							array( 'aiutante' => 'il Gufo Meccanico' ),
							array(
								$this->spread( '{nome} preparò lo zaino e partì. Lungo il sentiero incontrò un Gufo Meccanico con un ingranaggio incastrato nell\'ala.', '', 'left', array( 'npc' => true ) ),
								$this->spread( 'Con un po\' di pazienza {nome} lo aggiustò. «Grazie!» disse il Gufo. «Verrò con te: conosco la strada.»', '', 'right', array( 'npc' => true ) ),
							)
						),
						$this->block(
							'volpe_nuvole',
							'La Volpe delle Nuvole',
							'Un aiutante affamato.',
							array( 'aiutante' => 'la Volpe delle Nuvole' ),
							array(
								$this->spread( 'Appena partit{o_a}, {nome} sentì un brontolio: era la Volpe delle Nuvole, che non mangiava da giorni.', '', 'left', array( 'npc' => true ) ),
								$this->spread( '{nome} divise con lei la merenda. La Volpe sorrise: «Sei gentile. Lascia che ti accompagni.»', '', 'right', array( 'npc' => true ) ),
							)
						),
					),
				),
				array(
					'id'     => 'tappa_4',
					'label'  => 'Il dono',
					'phase'  => 'peripezie',
					'blocks' => array(
						$this->block(
							'lanterna_stelle',
							'La Lanterna delle Stelle',
							'Una luce che scioglie la paura.',
							array(
								'oggetto'        => 'la Lanterna delle Stelle',
								'azione_oggetto' => 'sollevò la Lanterna delle Stelle e un raggio dorato illuminò ogni cosa',
							),
							array(
								$this->spread( 'Quella notte, accanto al fuoco, {aiutante} tirò fuori un regalo: la Lanterna delle Stelle.', '', 'left', array( 'prop' => true ) ),
								$this->spread( '«Quando avrai paura, accendila» disse. {nome} la strinse forte: brillava come un pezzetto di cielo.', '', 'right', array( 'prop' => true ) ),
							)
						),
						$this->block(
							'chiave_melodica',
							'La Chiave Melodica',
							'Una chiave che suona una musica irresistibile.',
							array(
								'oggetto'        => 'la Chiave Melodica',
								'azione_oggetto' => 'fece girare la Chiave Melodica e una musica allegra riempì l\'aria',
							),
							array(
								$this->spread( 'Arrivati a un vecchio ponte, {aiutante} indicò una chiave d\'argento nascosta tra le pietre.', '', 'left', array( 'prop' => true ) ),
								$this->spread( 'Era la Chiave Melodica: bastava girarla nell\'aria per far nascere una musica a cui nessuno sapeva resistere.', '', 'right', array( 'prop' => true ) ),
							)
						),
					),
				),
				array(
					'id'     => 'tappa_5',
					'label'  => 'La sfida',
					'phase'  => 'peripezie',
					'blocks' => array(
						$this->block(
							'sentiero_bloccato',
							'Il sentiero sbarrato',
							'Faccia a faccia con l\'antagonista.',
							array(),
							array(
								$this->spread( 'Finalmente {nome} arrivò davanti a {antagonista}, che sbarrava la strada con aria minacciosa.', '', 'left', array( 'npc' => true ) ),
								$this->spread( '{nome} non si tirò indietro: {azione_oggetto}. E {antagonista} scoppiò in una gran risata!', '', 'right', array( 'npc' => true, 'prop' => true ) ),
							)
						),
						$this->block(
							'prova_coraggio',
							'La prova del coraggio',
							'Un passaggio buio da attraversare.',
							array(),
							array(
								$this->spread( 'Per raggiungere {antagonista} bisognava attraversare un passaggio stretto e buio. {nome} fece un respiro profondo.' ),
								$this->spread( 'Arrivat{o_a} in fondo, {nome} {azione_oggetto}: in un attimo {antagonista} smise di fare paura.', '', 'right', array( 'npc' => true, 'prop' => true ) ),
							)
						),
					),
				),
				array(
					'id'     => 'tappa_6',
					'label'  => 'Il ritorno',
					'phase'  => 'ristabilimento',
					'blocks' => array(
						$this->block(
							'grande_festa',
							'La grande festa',
							'Tutti festeggiano il ritorno.',
							array(),
							array(
								$this->spread( 'Così {lieto_fine}, e {nel_luogo} tutti uscirono di casa a festeggiare.' ),
								$this->spread( 'Quella sera {nome} si addormentò con {oggetto} accanto al cuscino, già pront{o_a} per la prossima avventura.', '', 'right', array( 'prop' => true ) ),
							)
						),
						$this->block(
							'nuovo_amico',
							'Un nuovo amico',
							'Anche l\'antagonista diventa amico.',
							array(),
							array(
								$this->spread( '{antagonista} chiese scusa e promise di non combinare più guai. Intanto {lieto_fine}.', '', 'left', array( 'npc' => true ) ),
								$this->spread( '{nome} tornò a casa da ver{o_a} ero{e_ina}, con {aiutante} al fianco e un nuovo amico in più.', '', 'right' ),
							)
						),
					),
				),
			),
		);
	}
}

CreaLibro::get_instance();
