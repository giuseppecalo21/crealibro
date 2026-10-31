<?php
/**
 * Plugin Name: Propp Book Studio - Libri Personalizzati 20x20
 * Description: Configuratore modulare basato sulle funzioni di Propp con Avatar PNG Baker, pannello Admin, scenari dinamici e generatore PDF 20x20cm per WooCommerce.
 * Version: 1.2.0
 * Author: Giuseppe Calò
 * Text Domain: propp-book-studio
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Propp_Book_Studio {

	const VERSION = '1.2.0';

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
		$upload = wp_upload_dir();
		$this->upload_dir = trailingslashit( $upload['basedir'] ) . 'propp-book-studio/';
		$this->upload_url = trailingslashit( $upload['baseurl'] ) . 'propp-book-studio/';

		add_action( 'init', array( $this, 'ensure_environment' ) );
		add_shortcode( 'propp_book_editor', array( $this, 'render_shortcode' ) );
		add_action( 'wp_enqueue_scripts', array( $this, 'register_assets' ) );
		add_action( 'admin_enqueue_scripts', array( $this, 'register_admin_assets' ) );

		// Menu di Amministrazione "Propp Studio" e salvataggio Catalogo
		add_action( 'admin_menu', array( $this, 'register_admin_menu' ) );
		add_action( 'admin_post_propp_save_manifest', array( $this, 'handle_save_manifest' ) );

		// AJAX Endpoints (salvataggio PNG + aggiunta al carrello WooCommerce)
		add_action( 'wp_ajax_propp_add_to_cart', array( $this, 'ajax_add_to_cart' ) );
		add_action( 'wp_ajax_nopriv_propp_add_to_cart', array( $this, 'ajax_add_to_cart' ) );

		// Hook WooCommerce Carrello, Prezzo 30€ e Checkout
		add_filter( 'woocommerce_get_item_data', array( $this, 'display_cart_item_data' ), 10, 2 );
		add_filter( 'woocommerce_cart_item_thumbnail', array( $this, 'custom_cart_thumbnail' ), 10, 3 );
		add_action( 'woocommerce_before_calculate_totals', array( $this, 'lock_custom_book_price' ), 20, 1 );
		add_action( 'woocommerce_checkout_create_order_line_item', array( $this, 'save_order_item_meta' ), 10, 4 );

		// Metabox Ordine Admin per scaricare il PDF 20x20 esecutivo
		add_action( 'add_meta_boxes', array( $this, 'register_order_print_metabox' ) );
	}

	/**
	 * Crea le cartelle in uploads e il manifest.json iniziale
	 */
	public function ensure_environment() {
		if ( ! file_exists( $this->upload_dir ) ) {
			wp_mkdir_p( $this->upload_dir . 'orders/' );
			wp_mkdir_p( $this->upload_dir . 'custom-assets/' );
		}

		$manifest_file = $this->upload_dir . 'manifest.json';
		if ( ! file_exists( $manifest_file ) ) {
			file_put_contents( $manifest_file, wp_json_encode( $this->get_default_manifest(), JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE ) );
		}
	}

	/**
	 * Recupera o crea in automatico il Prodotto WooCommerce base da 30,00 €
	 */
	private function get_or_create_wc_product() {
		$product_id = (int) get_option( 'propp_studio_wc_product_id', 0 );
		if ( $product_id && get_post_status( $product_id ) === 'publish' ) {
			return $product_id;
		}

		if ( ! class_exists( 'WC_Product_Simple' ) ) {
			return 0;
		}

		$product = new WC_Product_Simple();
		$product->set_name( 'Libro Illustrato Personalizzato 20x20 cm' );
		$product->set_status( 'publish' );
		$product->set_catalog_visibility( 'visible' );
		$product->set_price( '30.00' );
		$product->set_regular_price( '30.00' );
		$product->set_sold_individually( false );
		$product_id = $product->save();

		update_option( 'propp_studio_wc_product_id', $product_id );
		return $product_id;
	}

	/**
	 * Registra JS e CSS
	 */
	public function register_assets() {
		wp_register_style(
			'propp-studio-css',
			plugin_dir_url( __FILE__ ) . 'assets/studio.css',
			array(),
			self::VERSION
		);

		wp_register_script(
			'propp-studio-js',
			plugin_dir_url( __FILE__ ) . 'assets/studio.js',
			array(),
			self::VERSION,
			true
		);
	}

	public function register_admin_assets( $hook ) {
		// Pagina di gestione Propp Studio: Libreria Media + editor visuale delle scene
		if ( 'toplevel_page_propp-book-studio' === $hook ) {
			wp_enqueue_media();
			$this->register_assets();
			wp_enqueue_script( 'propp-studio-js' );

			wp_enqueue_style(
				'propp-studio-admin-css',
				plugin_dir_url( __FILE__ ) . 'assets/admin.css',
				array(),
				self::VERSION
			);
			wp_enqueue_script(
				'propp-studio-admin-js',
				plugin_dir_url( __FILE__ ) . 'assets/admin.js',
				array( 'propp-studio-js' ),
				self::VERSION,
				true
			);
			wp_add_inline_script(
				'propp-studio-admin-js',
				'window.ProppAdminData = ' . wp_json_encode(
					array(
						'manifest'      => $this->load_manifest(),
						'steps'         => $this->get_step_config(),
						'elementLabels' => array(
							'avatar' => 'Bambino/a',
							'prop'   => 'Oggetto magico',
						),
					),
					JSON_UNESCAPED_UNICODE
				) . ';',
				'before'
			);
			return;
		}

		// Pagina ordini WooCommerce: carica studio.js per generare il PDF 300 DPI
		if ( strpos( $hook, 'shop_order' ) !== false || strpos( $hook, 'wc-orders' ) !== false || strpos( $hook, 'post.php' ) !== false ) {
			$this->register_assets();
			wp_enqueue_style( 'propp-studio-css' );
			wp_enqueue_script( 'propp-studio-js' );
			wp_localize_script( 'propp-studio-js', 'ProppStudioData', array(
				'isAdmin'  => true,
				'manifest' => $this->load_manifest(),
			) );
		}
	}

	public function load_manifest() {
		$manifest_file = $this->upload_dir . 'manifest.json';
		if ( file_exists( $manifest_file ) ) {
			$decoded = json_decode( file_get_contents( $manifest_file ), true );
			if ( is_array( $decoded ) ) {
				return $decoded;
			}
		}
		return $this->get_default_manifest();
	}

	/**
	 * Struttura di ogni fase di Propp: quali tavole influenza, quali elementi
	 * compaiono in ciascuna tavola, quali immagini e testi si possono caricare.
	 * Deve restare allineata a PAGE_DEFS in assets/studio.js.
	 */
	private function get_step_config() {
		return array(
			'1_setting'    => array(
				'npc_label'      => '',
				'has_prop_image' => false,
				'has_npc_image'  => false,
				'pages'          => array(
					array(
						'page'  => 1,
						'label' => 'Pag. 1 · Ambiente',
						'slots' => array( 'avatar_slot' => 'avatar' ),
					),
					array(
						'page'  => 0,
						'label' => 'Copertina',
						'slots' => array(
							'cover_avatar_slot' => 'avatar',
							'cover_prop_slot'   => 'prop',
						),
					),
					array(
						'page'  => 5,
						'label' => 'Pag. 5 · Ritorno',
						'slots' => array(
							'ending_avatar_slot' => 'avatar',
							'ending_prop_slot'   => 'prop',
						),
					),
				),
				'tokens'         => array(
					'place_name' => 'Nome del luogo ({place_name})',
					'intro_text' => 'Testo pagina 1 (usa {nome}, {o_a}, {un_una}, {il_la})',
				),
			),
			'2_donor'      => array(
				'npc_label'      => 'Donatore',
				'has_prop_image' => false,
				'has_npc_image'  => true,
				'pages'          => array(
					array(
						'page'  => 2,
						'label' => 'Pag. 2 · Donatore',
						'slots' => array(
							'npc_slot'    => 'npc',
							'avatar_slot' => 'avatar',
						),
					),
				),
				'tokens'         => array(
					'donor_name' => 'Nome del donatore ({donor_name})',
					'donor_text' => 'Testo pagina 2 (usa {nome}, {place_name})',
				),
			),
			'3_magic_item' => array(
				'npc_label'      => '',
				'has_prop_image' => true,
				'has_npc_image'  => false,
				'pages'          => array(
					array(
						'page'  => 3,
						'label' => 'Pag. 3 · Mezzo magico',
						'slots' => array(
							'avatar_slot' => 'avatar',
							'prop_slot'   => 'prop',
						),
					),
				),
				'tokens'         => array(
					'item_name'   => 'Nome dell\'oggetto ({item_name})',
					'item_gift'   => 'Testo pagina 3 (consegna dell\'oggetto)',
					'item_action' => 'Azione del climax ({item_action}, usata a pag. 4)',
				),
			),
			'4_antagonist' => array(
				'npc_label'      => 'Antagonista',
				'has_prop_image' => false,
				'has_npc_image'  => true,
				'pages'          => array(
					array(
						'page'  => 4,
						'label' => 'Pag. 4 · Sfida',
						'slots' => array(
							'npc_slot'    => 'npc',
							'avatar_slot' => 'avatar',
							'prop_slot'   => 'prop',
						),
					),
				),
				'tokens'         => array(
					'villain_name' => 'Nome dell\'antagonista ({villain_name})',
					'climax_text'  => 'Testo pagina 4 (usa {nome}, {item_action})',
					'ending_text'  => 'Testo pagina 5, finale (usa {nome}, {place_name}, {item_name})',
				),
			),
		);
	}

	/**
	 * Posizioni predefinite: identiche a DEFAULT_SLOTS in assets/studio.js.
	 */
	private function get_default_slots() {
		return array(
			'1_setting'    => array(
				'avatar_slot'        => array( 'x' => 50, 'y' => 54, 'scale' => 0.50, 'rotation' => 0 ),
				'cover_avatar_slot'  => array( 'x' => 50, 'y' => 58, 'scale' => 0.56, 'rotation' => 0 ),
				'cover_prop_slot'    => array( 'x' => 70, 'y' => 56, 'scale' => 0.22, 'rotation' => 0 ),
				'ending_avatar_slot' => array( 'x' => 50, 'y' => 53, 'scale' => 0.50, 'rotation' => 0 ),
				'ending_prop_slot'   => array( 'x' => 67, 'y' => 54, 'scale' => 0.19, 'rotation' => 0 ),
			),
			'2_donor'      => array(
				'avatar_slot' => array( 'x' => 36, 'y' => 55, 'scale' => 0.47, 'rotation' => 0 ),
				'npc_slot'    => array( 'x' => 70, 'y' => 50, 'scale' => 0.40, 'rotation' => 0 ),
			),
			'3_magic_item' => array(
				'avatar_slot' => array( 'x' => 45, 'y' => 54, 'scale' => 0.49, 'rotation' => 0 ),
				'prop_slot'   => array( 'x' => 64, 'y' => 55, 'scale' => 0.20, 'rotation' => 0 ),
			),
			'4_antagonist' => array(
				'avatar_slot' => array( 'x' => 35, 'y' => 56, 'scale' => 0.46, 'rotation' => -4 ),
				'prop_slot'   => array( 'x' => 53, 'y' => 52, 'scale' => 0.22, 'rotation' => 0 ),
				'npc_slot'    => array( 'x' => 73, 'y' => 48, 'scale' => 0.50, 'rotation' => 0 ),
			),
		);
	}

	/**
	 * Restituisce la posizione salvata di un elemento, completata con i valori predefiniti.
	 */
	private function get_slot_values( $opt, $step_key, $slot_key ) {
		$defaults = $this->get_default_slots();
		$d        = $defaults[ $step_key ][ $slot_key ] ?? array( 'x' => 50, 'y' => 50, 'scale' => 0.3, 'rotation' => 0 );
		$s        = ( isset( $opt[ $slot_key ] ) && is_array( $opt[ $slot_key ] ) ) ? $opt[ $slot_key ] : array();
		$out      = array();
		foreach ( $d as $axis => $default_value ) {
			$out[ $axis ] = isset( $s[ $axis ] ) && is_numeric( $s[ $axis ] ) ? (float) $s[ $axis ] : (float) $default_value;
		}
		return $out;
	}

	/**
	 * ==========================================
	 * PANNELLO ADMIN: Voce di menu "Propp Studio"
	 * ==========================================
	 */
	public function register_admin_menu() {
		add_menu_page(
			'Propp Book Studio',
			'Propp Studio',
			'manage_options',
			'propp-book-studio',
			array( $this, 'render_admin_page' ),
			'dashicons-book-alt',
			56
		);
	}

	/**
	 * Salva i dati inviati dal pannello Admin dentro manifest.json
	 */
	public function handle_save_manifest() {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( 'Permessi insufficienti.' );
		}
		check_admin_referer( 'propp_save_manifest_action', 'propp_manifest_nonce' );

		$manifest = $this->load_manifest();

		// 1. Palette colori
		if ( isset( $_POST['palettes'] ) && is_array( $_POST['palettes'] ) ) {
			$posted_palettes = wp_unslash( $_POST['palettes'] ); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized
			foreach ( array( 'skin', 'hair', 'eyes', 'shirt' ) as $pal_key ) {
				if ( empty( $posted_palettes[ $pal_key ]['label'] ) || ! is_array( $posted_palettes[ $pal_key ]['label'] ) ) {
					continue;
				}
				$manifest['palettes'][ $pal_key ] = array();
				$labels = $posted_palettes[ $pal_key ]['label'];
				$hexes  = $posted_palettes[ $pal_key ]['hex'] ?? array();
				foreach ( $labels as $idx => $lbl ) {
					if ( trim( (string) $lbl ) === '' ) {
						continue;
					}
					$manifest['palettes'][ $pal_key ][] = array(
						'label' => sanitize_text_field( $lbl ),
						'hex'   => sanitize_hex_color( $hexes[ $idx ] ?? '' ) ?: '#000000',
					);
				}
			}
		}

		// 2. Acconciature SVG del bambino
		if ( isset( $_POST['hair_styles'] ) && is_array( $_POST['hair_styles'] ) ) {
			$posted_hair = wp_unslash( $_POST['hair_styles'] ); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized
			$labels      = is_array( $posted_hair['label'] ?? null ) ? $posted_hair['label'] : array();
			$ids         = $posted_hair['id'] ?? array();
			$svgs        = $posted_hair['svg'] ?? array();
			$hair_styles = array();

			foreach ( $labels as $idx => $lbl ) {
				if ( trim( (string) $lbl ) === '' ) {
					continue;
				}
				$raw_id        = sanitize_title( ! empty( $ids[ $idx ] ) ? $ids[ $idx ] : $lbl );
				$hair_styles[] = array(
					'id'    => str_replace( '-', '_', $raw_id ),
					'label' => sanitize_text_field( $lbl ),
					'svg'   => (string) ( $svgs[ $idx ] ?? '' ),
				);
			}
			if ( $hair_styles ) {
				$manifest['hair_styles'] = $hair_styles;
			}
		}

		// 3. Scenari e carte di Propp (una riga per scheda, con chiave univoca)
		if ( isset( $_POST['propp'] ) && is_array( $_POST['propp'] ) ) {
			$posted_propp = wp_unslash( $_POST['propp'] ); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized
			$step_config  = $this->get_step_config();

			foreach ( $manifest['propp_categories'] as &$cat ) {
				$step_key = $cat['step_key'];
				$cfg      = $step_config[ $step_key ] ?? null;
				if ( ! $cfg || empty( $posted_propp[ $step_key ] ) || ! is_array( $posted_propp[ $step_key ] ) ) {
					continue;
				}

				$slot_keys = array();
				foreach ( $cfg['pages'] as $page ) {
					$slot_keys = array_merge( $slot_keys, array_keys( $page['slots'] ) );
				}

				$options  = array();
				$used_ids = array();

				foreach ( $posted_propp[ $step_key ] as $row ) {
					if ( ! is_array( $row ) ) {
						continue;
					}
					$label = sanitize_text_field( $row['label'] ?? '' );
					if ( '' === $label ) {
						continue;
					}

					$opt_id = str_replace( '-', '_', sanitize_title( ! empty( $row['id'] ) ? $row['id'] : $label ) );
					if ( '' === $opt_id ) {
						$opt_id = 'opzione';
					}
					$base_id = $opt_id;
					$n       = 2;
					while ( in_array( $opt_id, $used_ids, true ) ) {
						$opt_id = $base_id . '_' . $n++;
					}
					$used_ids[] = $opt_id;

					$option = array(
						'id'        => $opt_id,
						'label'     => $label,
						'bg_image'  => esc_url_raw( trim( (string) ( $row['bg_image'] ?? '' ) ) ),
						'bg_sky'    => sanitize_hex_color( $row['bg_sky'] ?? '' ) ?: '#DCFCE7',
						'bg_ground' => sanitize_hex_color( $row['bg_ground'] ?? '' ) ?: '#15803D',
						'bg_decor'  => in_array( $row['bg_decor'] ?? '', array( 'trees', 'stars', 'waves', 'none' ), true ) ? $row['bg_decor'] : 'trees',
					);

					if ( $cfg['has_prop_image'] ) {
						$option['prop_image'] = esc_url_raw( trim( (string) ( $row['prop_image'] ?? '' ) ) );
						$option['prop_color'] = sanitize_hex_color( $row['prop_color'] ?? '' ) ?: '#FACC15';
						$option['prop_shape'] = in_array( $row['prop_shape'] ?? '', array( 'lantern', 'key' ), true ) ? $row['prop_shape'] : 'lantern';
					}
					if ( $cfg['has_npc_image'] ) {
						$option['npc_image'] = esc_url_raw( trim( (string) ( $row['npc_image'] ?? '' ) ) );
					}

					// Posizioni degli elementi nelle tavole
					$posted_slots = ( isset( $row['slots'] ) && is_array( $row['slots'] ) ) ? $row['slots'] : array();
					foreach ( $slot_keys as $slot_key ) {
						$vals                = $posted_slots[ $slot_key ] ?? array();
						$def                 = $this->get_slot_values( array(), $step_key, $slot_key );
						$option[ $slot_key ] = array(
							'x'        => $this->clamp_number( $vals['x'] ?? null, -50, 150, $def['x'] ),
							'y'        => $this->clamp_number( $vals['y'] ?? null, -50, 150, $def['y'] ),
							'scale'    => $this->clamp_number( $vals['scale'] ?? null, 0.02, 3, $def['scale'] ),
							'rotation' => $this->clamp_number( $vals['rotation'] ?? null, -180, 180, $def['rotation'] ),
						);
					}

					// Testi
					$option['tokens'] = array();
					foreach ( array_keys( $cfg['tokens'] ) as $t_key ) {
						$option['tokens'][ $t_key ] = sanitize_textarea_field( $row['tokens'][ $t_key ] ?? '' );
					}

					$options[] = $option;
				}

				// Una fase non può restare vuota: il configuratore non saprebbe cosa mostrare
				if ( $options ) {
					$cat['options'] = $options;
				}
			}
			unset( $cat );
		}

		file_put_contents(
			$this->upload_dir . 'manifest.json',
			wp_json_encode( $manifest, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE )
		);

		wp_safe_redirect( add_query_arg( array( 'page' => 'propp-book-studio', 'updated' => '1' ), admin_url( 'admin.php' ) ) );
		exit;
	}

	private function clamp_number( $value, $min, $max, $fallback ) {
		if ( ! is_numeric( $value ) ) {
			return (float) $fallback;
		}
		return round( max( $min, min( $max, (float) $value ) ), 3 );
	}

	/**
	 * Campo immagine con miniatura e pulsante "Sfoglia" della Libreria Media
	 */
	private function render_media_field( $base, $field, $label, $help, $opt ) {
		$value = $opt[ $field ] ?? '';
		?>
		<div class="pbs-field pbs-media-field">
			<label><?php echo esc_html( $label ); ?></label>
			<div class="pbs-media-row">
				<span class="pbs-media-thumb<?php echo $value ? '' : ' is-empty'; ?>">
					<img src="<?php echo esc_url( $value ); ?>" alt="" />
				</span>
				<input type="text" class="widefat" data-f="<?php echo esc_attr( $field ); ?>" name="<?php echo esc_attr( $base . '[' . $field . ']' ); ?>" value="<?php echo esc_attr( $value ); ?>" placeholder="Scegli dalla Libreria Media o incolla un URL" />
				<button type="button" class="button pbs-upload-btn">Sfoglia</button>
				<button type="button" class="button-link pbs-clear-btn" title="Togli immagine" aria-label="Togli immagine">✕</button>
			</div>
			<?php if ( $help ) : ?>
				<p class="description"><?php echo esc_html( $help ); ?></p>
			<?php endif; ?>
		</div>
		<?php
	}

	/**
	 * Scheda di un'opzione di Propp: campi a sinistra, anteprima interattiva a destra
	 */
	private function render_scenario_card( $step_key, $row_key, $opt, $cfg ) {
		$base       = 'propp[' . $step_key . '][' . $row_key . ']';
		$label      = $opt['label'] ?? '';
		$first_page = (int) $cfg['pages'][0]['page'];
		$el_labels  = array(
			'avatar' => 'Bambino/a',
			'prop'   => 'Oggetto magico',
			'npc'    => $cfg['npc_label'],
		);
		?>
		<div class="pbs-card" data-step="<?php echo esc_attr( $step_key ); ?>" data-preview-id="<?php echo esc_attr( $opt['id'] ?? '' ); ?>" data-page="<?php echo esc_attr( $first_page ); ?>">
			<div class="pbs-card-head">
				<h3 class="pbs-card-title"><?php echo esc_html( $label ? $label : 'Nuova opzione' ); ?></h3>
				<button type="button" class="button-link pbs-card-remove">Rimuovi opzione</button>
			</div>

			<div class="pbs-card-body">
				<div class="pbs-card-fields">
					<div class="pbs-field">
						<label>Titolo dell'opzione <span class="pbs-muted">(il bottone che vede il cliente)</span></label>
						<input type="text" class="widefat pbs-label-input" data-f="label" name="<?php echo esc_attr( $base ); ?>[label]" value="<?php echo esc_attr( $label ); ?>" />
						<input type="hidden" data-f="id" name="<?php echo esc_attr( $base ); ?>[id]" value="<?php echo esc_attr( $opt['id'] ?? '' ); ?>" />
					</div>

					<?php
					$this->render_media_field( $base, 'bg_image', 'Illustrazione di sfondo 20x20', 'JPG o PNG quadrato, consigliato 2433×2433 px. Se non è quadrata viene ritagliata al centro.', $opt );

					if ( $cfg['has_prop_image'] ) {
						$this->render_media_field( $base, 'prop_image', 'PNG dell\'oggetto magico (scontornato)', 'Compare in questa tavola, in copertina, nella sfida e nel finale.', $opt );
					}
					if ( $cfg['has_npc_image'] ) {
						$this->render_media_field( $base, 'npc_image', 'PNG del ' . strtolower( $cfg['npc_label'] ) . ' (scontornato, facoltativo)', 'Lascia vuoto se il personaggio è già disegnato nell\'illustrazione di sfondo.', $opt );
					}
					?>

					<details class="pbs-fallback">
						<summary>Sfondo di riserva <span class="pbs-muted">(usato solo se manca l'illustrazione)</span></summary>
						<div class="pbs-fallback-grid">
							<label>Cielo <input type="color" data-f="bg_sky" name="<?php echo esc_attr( $base ); ?>[bg_sky]" value="<?php echo esc_attr( $opt['bg_sky'] ?? '#DCFCE7' ); ?>" /></label>
							<label>Terreno <input type="color" data-f="bg_ground" name="<?php echo esc_attr( $base ); ?>[bg_ground]" value="<?php echo esc_attr( $opt['bg_ground'] ?? '#15803D' ); ?>" /></label>
							<label>Decorazione
								<select data-f="bg_decor" name="<?php echo esc_attr( $base ); ?>[bg_decor]">
									<?php
									$decor = $opt['bg_decor'] ?? 'trees';
									foreach ( array( 'trees' => 'Alberi', 'stars' => 'Stelle', 'waves' => 'Onde', 'none' => 'Nessuna' ) as $d_val => $d_lbl ) {
										printf( '<option value="%s"%s>%s</option>', esc_attr( $d_val ), selected( $decor, $d_val, false ), esc_html( $d_lbl ) );
									}
									?>
								</select>
							</label>
							<?php if ( $cfg['has_prop_image'] ) : ?>
								<label>Oggetto di riserva
									<select data-f="prop_shape" name="<?php echo esc_attr( $base ); ?>[prop_shape]">
										<?php
										$shape = $opt['prop_shape'] ?? 'lantern';
										foreach ( array( 'lantern' => 'Sfera / lanterna', 'key' => 'Barretta / chiave' ) as $s_val => $s_lbl ) {
											printf( '<option value="%s"%s>%s</option>', esc_attr( $s_val ), selected( $shape, $s_val, false ), esc_html( $s_lbl ) );
										}
										?>
									</select>
								</label>
								<label>Colore oggetto <input type="color" data-f="prop_color" name="<?php echo esc_attr( $base ); ?>[prop_color]" value="<?php echo esc_attr( $opt['prop_color'] ?? '#FACC15' ); ?>" /></label>
							<?php endif; ?>
						</div>
					</details>

					<div class="pbs-tokens">
						<?php foreach ( $cfg['tokens'] as $tk_key => $tk_label ) : ?>
							<div class="pbs-field">
								<label><?php echo esc_html( $tk_label ); ?></label>
								<textarea rows="<?php echo ( false !== strpos( $tk_key, 'text' ) || 'item_gift' === $tk_key ) ? 3 : 1; ?>" class="widefat" data-f="tokens.<?php echo esc_attr( $tk_key ); ?>" name="<?php echo esc_attr( $base ); ?>[tokens][<?php echo esc_attr( $tk_key ); ?>]"><?php echo esc_textarea( $opt['tokens'][ $tk_key ] ?? '' ); ?></textarea>
							</div>
						<?php endforeach; ?>
					</div>
				</div>

				<div class="pbs-card-preview">
					<?php if ( count( $cfg['pages'] ) > 1 ) : ?>
						<div class="pbs-page-tabs" role="tablist">
							<?php foreach ( $cfg['pages'] as $p ) : ?>
								<button type="button" class="pbs-page-tab<?php echo (int) $p['page'] === $first_page ? ' active' : ''; ?>" data-page="<?php echo esc_attr( $p['page'] ); ?>"><?php echo esc_html( $p['label'] ); ?></button>
							<?php endforeach; ?>
						</div>
					<?php else : ?>
						<div class="pbs-page-tabs"><span class="pbs-page-tab active is-static"><?php echo esc_html( $cfg['pages'][0]['label'] ); ?></span></div>
					<?php endif; ?>

					<div class="pbs-canvas-wrap">
						<canvas width="800" height="800" tabindex="0" aria-label="Anteprima della tavola: trascina gli elementi per posizionarli"></canvas>
					</div>
					<div class="pbs-preview-warn" hidden></div>

					<?php foreach ( $cfg['pages'] as $p ) : ?>
						<table class="pbs-slot-table" data-page="<?php echo esc_attr( $p['page'] ); ?>"<?php echo (int) $p['page'] === $first_page ? '' : ' hidden'; ?>>
							<thead>
								<tr><th>Elemento</th><th>X %</th><th>Y %</th><th>Scala</th><th>Rotaz. °</th></tr>
							</thead>
							<tbody>
								<?php foreach ( $p['slots'] as $slot_key => $el_type ) :
									$vals = $this->get_slot_values( $opt, $step_key, $slot_key );
									?>
									<tr data-slot="<?php echo esc_attr( $slot_key ); ?>" data-type="<?php echo esc_attr( $el_type ); ?>">
										<th scope="row"><span class="pbs-dot pbs-dot-<?php echo esc_attr( $el_type ); ?>"></span><?php echo esc_html( $el_labels[ $el_type ] ); ?></th>
										<?php
										$axes = array(
											'x'        => array( '0.5', '-50', '150' ),
											'y'        => array( '0.5', '-50', '150' ),
											'scale'    => array( '0.01', '0.02', '3' ),
											'rotation' => array( '1', '-180', '180' ),
										);
										foreach ( $axes as $axis => $a ) :
											?>
											<td><input type="number" step="<?php echo esc_attr( $a[0] ); ?>" min="<?php echo esc_attr( $a[1] ); ?>" max="<?php echo esc_attr( $a[2] ); ?>" data-f="<?php echo esc_attr( $slot_key . '.' . $axis ); ?>" data-num="1" name="<?php echo esc_attr( $base . '[slots][' . $slot_key . '][' . $axis . ']' ); ?>" value="<?php echo esc_attr( $vals[ $axis ] ); ?>" /></td>
										<?php endforeach; ?>
									</tr>
								<?php endforeach; ?>
							</tbody>
						</table>
					<?php endforeach; ?>
				</div>
			</div>
		</div>
		<?php
	}

	private function render_hair_card( $hair ) {
		?>
		<div class="pbs-hair-card" data-preview-id="<?php echo esc_attr( $hair['id'] ?? '' ); ?>">
			<button type="button" class="pbs-hair-thumb" title="Usa questa acconciatura per il personaggio di prova">
				<img alt="" />
				<span class="pbs-hair-error" hidden>SVG non valido</span>
			</button>
			<div class="pbs-hair-fields">
				<div class="pbs-field">
					<label>Nome acconciatura</label>
					<input type="text" class="widefat" name="hair_styles[label][]" value="<?php echo esc_attr( $hair['label'] ?? '' ); ?>" placeholder="Es. Trecce" />
					<input type="hidden" name="hair_styles[id][]" value="<?php echo esc_attr( $hair['id'] ?? '' ); ?>" />
				</div>
				<div class="pbs-field">
					<label>Tracciato SVG (tavola 1000×1000)</label>
					<textarea rows="4" class="widefat pbs-code" name="hair_styles[svg][]" placeholder='<path class="fill-hair" d="..." />'><?php echo esc_textarea( $hair['svg'] ?? '' ); ?></textarea>
				</div>
			</div>
			<button type="button" class="button-link pbs-hair-remove">Rimuovi</button>
		</div>
		<?php
	}

	/**
	 * Renderizza la pagina di gestione in wp-admin
	 */
	public function render_admin_page() {
		$manifest    = $this->load_manifest();
		$step_config = $this->get_step_config();
		?>
		<div class="wrap pbs-admin">
			<h1>📚 Propp Book Studio</h1>
			<p class="pbs-intro">Usa lo shortcode <code>[propp_book_editor]</code> in qualsiasi pagina per mostrare il configuratore ai clienti. Ogni modifica qui sotto si vede subito nelle anteprime; diventa definitiva solo quando premi <strong>Salva il catalogo</strong>.</p>

			<?php if ( isset( $_GET['updated'] ) ) : // phpcs:ignore WordPress.Security.NonceVerification.Recommended ?>
				<div class="notice notice-success is-dismissible"><p><strong>Catalogo salvato.</strong> Le modifiche sono già attive nel configuratore.</p></div>
			<?php endif; ?>

			<div class="pbs-admin-layout">
				<div class="pbs-admin-main">
					<nav class="pbs-admin-tabs">
						<button type="button" class="pbs-admin-tab active" data-target="sec-scenarios">1. Scene e carte di Propp</button>
						<button type="button" class="pbs-admin-tab" data-target="sec-book">2. Anteprima del libro</button>
						<button type="button" class="pbs-admin-tab" data-target="sec-hair">3. Acconciature</button>
						<button type="button" class="pbs-admin-tab" data-target="sec-palettes">4. Palette colori</button>
					</nav>

					<form method="post" id="pbs-admin-form" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
						<input type="hidden" name="action" value="propp_save_manifest" />
						<?php wp_nonce_field( 'propp_save_manifest_action', 'propp_manifest_nonce' ); ?>

						<!-- SEZIONE 1: SCENE E CARTE DI PROPP -->
						<section id="sec-scenarios" class="pbs-admin-section active">
							<div class="pbs-howto">
								<strong>Come si usa l'anteprima:</strong>
								trascina il bambino, l'oggetto o il personaggio per spostarli;
								tira il quadratino <span class="pbs-kbd">↘</span> per ingrandire o rimpicciolire e il pallino <span class="pbs-kbd">⟳</span> per ruotare.
								Con l'elemento selezionato puoi usare le frecce della tastiera (con Maiusc il passo è più lungo).
								La linea rossa tratteggiata è il taglio, quella blu il margine di sicurezza: tieni volti e testi dentro la blu.
							</div>

							<nav class="pbs-step-nav">
								<?php foreach ( $manifest['propp_categories'] as $cat ) : ?>
									<a href="#pbs-step-<?php echo esc_attr( $cat['step_key'] ); ?>"><?php echo esc_html( $cat['title'] ); ?></a>
								<?php endforeach; ?>
							</nav>

							<?php foreach ( $manifest['propp_categories'] as $cat ) :
								$step_key = $cat['step_key'];
								$cfg      = $step_config[ $step_key ] ?? null;
								if ( ! $cfg ) {
									continue;
								}
								?>
								<div class="pbs-step" id="pbs-step-<?php echo esc_attr( $step_key ); ?>">
									<div class="pbs-step-head">
										<h2><?php echo esc_html( $cat['title'] ); ?></h2>
										<button type="button" class="button pbs-add-scenario-btn" data-step="<?php echo esc_attr( $step_key ); ?>">+ Aggiungi opzione</button>
									</div>

									<div class="pbs-repeater" id="repeater-<?php echo esc_attr( $step_key ); ?>">
										<?php
										foreach ( $cat['options'] as $i => $opt ) {
											$this->render_scenario_card( $step_key, (string) $i, $opt, $cfg );
										}
										?>
									</div>

									<template id="pbs-tpl-<?php echo esc_attr( $step_key ); ?>">
										<?php
										$blank = array(
											'id'     => '',
											'label'  => '',
											'tokens' => array(),
										);
										if ( ! empty( $cat['options'][0] ) ) {
											foreach ( array( 'bg_sky', 'bg_ground', 'bg_decor', 'prop_color', 'prop_shape' ) as $copy_key ) {
												if ( isset( $cat['options'][0][ $copy_key ] ) ) {
													$blank[ $copy_key ] = $cat['options'][0][ $copy_key ];
												}
											}
										}
										$this->render_scenario_card( $step_key, '__KEY__', $blank, $cfg );
										?>
									</template>
								</div>
							<?php endforeach; ?>
						</section>

						<!-- SEZIONE 2: ANTEPRIMA DEL LIBRO COMPLETO -->
						<section id="sec-book" class="pbs-admin-section">
							<p>Scegli una combinazione di carte e controlla tutte le tavole una dopo l'altra, come le vedrà il cliente con il personaggio di prova. Clicca su una tavola per andare a modificarne le posizioni.</p>
							<div class="pbs-book-controls">
								<?php foreach ( $manifest['propp_categories'] as $cat ) : ?>
									<label>
										<span><?php echo esc_html( $cat['title'] ); ?></span>
										<select class="pbs-book-select" data-step="<?php echo esc_attr( $cat['step_key'] ); ?>"></select>
									</label>
								<?php endforeach; ?>
								<button type="button" class="button" id="pbs-book-pdf">⬇ Scarica PDF di prova</button>
							</div>
							<div class="pbs-book-grid" id="pbs-book-grid"></div>
						</section>

						<!-- SEZIONE 3: ACCONCIATURE -->
						<section id="sec-hair" class="pbs-admin-section">
							<p>Incolla qui i tracciati SVG (tavola <code>1000×1000</code>) esportati da Illustrator. Usa <code>class="fill-hair"</code> sui tracciati che devono prendere il colore scelto dal cliente. La miniatura si aggiorna mentre scrivi; cliccaci sopra per provarla sul personaggio di prova.</p>
							<div id="pbs-hair-repeater" class="pbs-hair-grid">
								<?php
								foreach ( $manifest['hair_styles'] as $hair ) {
									$this->render_hair_card( $hair );
								}
								?>
							</div>
							<template id="pbs-tpl-hair"><?php $this->render_hair_card( array() ); ?></template>
							<button type="button" class="button" id="pbs-add-hair-btn">+ Aggiungi acconciatura</button>
						</section>

						<!-- SEZIONE 4: PALETTE COLORI -->
						<section id="sec-palettes" class="pbs-admin-section">
							<p>I colori tra cui può scegliere il cliente. Il personaggio di prova qui a fianco si aggiorna con le palette che stai modificando.</p>
							<div class="pbs-palette-grid">
								<?php
								$pal_titles = array(
									'skin'  => 'Carnagioni',
									'hair'  => 'Colori capelli',
									'eyes'  => 'Colori occhi',
									'shirt' => 'Colori maglietta',
								);
								foreach ( $pal_titles as $p_key => $p_title ) :
									?>
									<div class="pbs-palette-card">
										<h3><?php echo esc_html( $p_title ); ?></h3>
										<div id="pal-wrap-<?php echo esc_attr( $p_key ); ?>" class="pbs-pal-wrap" data-pal="<?php echo esc_attr( $p_key ); ?>">
											<?php foreach ( ( $manifest['palettes'][ $p_key ] ?? array() ) as $col ) : ?>
												<div class="pbs-pal-row">
													<input type="color" name="palettes[<?php echo esc_attr( $p_key ); ?>][hex][]" value="<?php echo esc_attr( $col['hex'] ); ?>" />
													<input type="text" class="widefat" name="palettes[<?php echo esc_attr( $p_key ); ?>][label][]" value="<?php echo esc_attr( $col['label'] ); ?>" />
													<button type="button" class="button-link-delete pbs-pal-remove" aria-label="Rimuovi colore">✕</button>
												</div>
											<?php endforeach; ?>
										</div>
										<button type="button" class="button pbs-add-color-btn" data-pal="<?php echo esc_attr( $p_key ); ?>">+ Aggiungi colore</button>
									</div>
								<?php endforeach; ?>
							</div>
						</section>
					</form>
				</div>

				<!-- PERSONAGGIO DI PROVA (solo anteprima, non viene salvato) -->
				<aside class="pbs-admin-side">
					<div class="pbs-side-card">
						<h2>Personaggio di prova</h2>
						<p class="pbs-muted">Serve solo per le anteprime: prova combinazioni diverse per controllare che il bambino stia bene in ogni scena.</p>
						<div class="pbs-side-avatar">
							<img id="pbs-test-avatar" alt="Anteprima del personaggio" />
						</div>
						<div class="pbs-side-row">
							<label for="pbs-test-name">Nome</label>
							<input type="text" id="pbs-test-name" value="Giorgio" maxlength="22" />
						</div>
						<div class="pbs-side-row">
							<span class="pbs-side-label">Sesso</span>
							<div class="pbs-seg" id="pbs-test-gender">
								<button type="button" class="active" data-value="M">Bambino</button>
								<button type="button" data-value="F">Bambina</button>
							</div>
						</div>
						<div class="pbs-side-row">
							<label for="pbs-test-hair">Acconciatura</label>
							<select id="pbs-test-hair"></select>
						</div>
						<div class="pbs-side-row">
							<span class="pbs-side-label">Carnagione</span>
							<div class="pbs-side-swatches" data-key="skinColor" data-pal="skin"></div>
						</div>
						<div class="pbs-side-row">
							<span class="pbs-side-label">Capelli</span>
							<div class="pbs-side-swatches" data-key="hairColor" data-pal="hair"></div>
						</div>
						<div class="pbs-side-row">
							<span class="pbs-side-label">Occhi</span>
							<div class="pbs-side-swatches" data-key="eyeColor" data-pal="eyes"></div>
						</div>
						<div class="pbs-side-row">
							<span class="pbs-side-label">Maglietta</span>
							<div class="pbs-side-swatches" data-key="shirtColor" data-pal="shirt"></div>
						</div>
						<div class="pbs-side-row">
							<label class="pbs-check"><input type="checkbox" id="pbs-test-glasses" /> Occhiali tondi</label>
						</div>
						<hr />
						<div class="pbs-side-row">
							<label class="pbs-check"><input type="checkbox" id="pbs-show-guides" checked /> Mostra taglio e margini di sicurezza</label>
						</div>
						<button type="submit" form="pbs-admin-form" class="button button-primary button-large pbs-save-btn">💾 Salva il catalogo</button>
						<p class="pbs-dirty-note" id="pbs-dirty-note" hidden>Hai modifiche non salvate.</p>
					</div>
				</aside>
			</div>
		</div>
		<?php
	}
	/**
	 * Shortcode [propp_book_editor]
	 */
	public function render_shortcode( $atts ) {
		$atts = shortcode_atts( array(
			'product_id' => 0,
			'price'      => '30.00',
		), $atts );

		$product_id = (int) $atts['product_id'];
		if ( ! $product_id ) {
			$product_id = $this->get_or_create_wc_product();
		}

		wp_enqueue_style( 'propp-studio-css' );
		wp_enqueue_script( 'propp-studio-js' );

		wp_localize_script( 'propp-studio-js', 'ProppStudioData', array(
			'ajaxUrl'    => admin_url( 'admin-ajax.php' ),
			'nonce'      => wp_create_nonce( 'propp_studio_nonce' ),
			'productId'  => $product_id,
			'bookPrice'  => (float) $atts['price'],
			'uploadsUrl' => $this->upload_url,
			'manifest'   => $this->load_manifest(),
		) );

		ob_start();
		?>
		<div id="propp-studio-app" class="pbs-wrapper">
			<div class="pbs-preview-column">
				<div class="pbs-preview-header">
					<span class="pbs-format-badge">Formato 20x20 cm • Stampa HD</span>
					<label class="pbs-bleed-toggle">
						<input type="checkbox" id="pbs-toggle-bleed" />
						<span>Mostra margini di taglio (3mm)</span>
					</label>
				</div>

				<div class="pbs-canvas-stage">
					<canvas id="pbs-scene-canvas" width="1200" height="1200"></canvas>
					<div id="pbs-bleed-guide" class="pbs-bleed-overlay" style="display:none;"></div>
				</div>

				<div class="pbs-page-nav">
					<button type="button" class="pbs-btn-secondary" id="pbs-prev-page">&larr; Pagina Prec.</button>
					<span id="pbs-page-indicator">Copertina (1 / 6)</span>
					<button type="button" class="pbs-btn-secondary" id="pbs-next-page">Pagina Succ. &rarr;</button>
				</div>

				<div class="pbs-baked-status">
					<img id="pbs-baked-preview-img" src="" alt="Avatar PNG" />
					<div class="pbs-baked-info">
						<strong>PNG Personaggio Assemblato</strong>
						<span>Questo PNG trasparente viene iniettato dinamicamente in tutte le tavole della storia.</span>
					</div>
				</div>
			</div>

			<div class="pbs-controls-column">
				<div class="pbs-tabs">
					<button type="button" class="pbs-tab active" data-step="1">1. Crea il Bambino</button>
					<button type="button" class="pbs-tab" data-step="2">2. Componi la Fiaba (Propp)</button>
				</div>

				<div id="pbs-step-1" class="pbs-step-panel active">
					<div class="pbs-field-group">
						<label>Nome del bambino/a protagonista</label>
						<input type="text" id="pbs-child-name" value="Giorgio" maxlength="22" placeholder="Es. Giorgio, Sofia..." />
					</div>

					<div class="pbs-field-row">
						<div class="pbs-field-group">
							<label>Sesso (declina i testi)</label>
							<div class="pbs-pill-selector" id="pbs-gender-selector">
								<button type="button" class="pbs-pill active" data-gender="M">Bambino</button>
								<button type="button" class="pbs-pill" data-gender="F">Bambina</button>
							</div>
						</div>
						<div class="pbs-field-group">
							<label>Accessori (Occhiali)</label>
							<div class="pbs-pill-selector" id="pbs-glasses-selector">
								<button type="button" class="pbs-pill active" data-glasses="none">Nessuno</button>
								<button type="button" class="pbs-pill" data-glasses="round">Tondi</button>
							</div>
						</div>
					</div>

					<div class="pbs-field-group">
						<label>Acconciatura</label>
						<div class="pbs-hair-grid" id="pbs-hair-style-selector"></div>
					</div>

					<div class="pbs-field-group">
						<label>Carnagione</label>
						<div class="pbs-swatches" id="pbs-skin-color-selector"></div>
					</div>

					<div class="pbs-field-group">
						<label>Colore dei Capelli</label>
						<div class="pbs-swatches" id="pbs-hair-color-selector"></div>
					</div>

					<div class="pbs-field-group">
						<label>Colore degli Occhi</label>
						<div class="pbs-swatches" id="pbs-eye-color-selector"></div>
					</div>

					<div class="pbs-field-group">
						<label>Colore Maglietta</label>
						<div class="pbs-swatches" id="pbs-shirt-color-selector"></div>
					</div>

					<div class="pbs-step-footer">
						<button type="button" class="pbs-btn-primary pbs-full-width" id="pbs-goto-step-2">
							Salva Personaggio e Scegli la Storia &rarr;
						</button>
					</div>
				</div>

				<div id="pbs-step-2" class="pbs-step-panel">
					<div class="pbs-propp-header">
						<p>Ogni scelta aggiorna l'ambientazione, gli oggetti in mano al personaggio e i testi delle pagine seguenti.</p>
						<button type="button" class="pbs-btn-secondary" id="pbs-randomize-story">🎲 Mescola le carte</button>
					</div>

					<div id="pbs-propp-modules-container"></div>

					<div class="pbs-purchase-box">
						<div class="pbs-price-row">
							<div>
								<span class="pbs-price-label">Libro 20x20 cm Personalizzato</span>
								<small>Stampa ad alta risoluzione • Copertina inclusa</small>
							</div>
							<span class="pbs-price-tag">30,00 €</span>
						</div>

						<button type="button" class="pbs-btn-buy" id="pbs-add-to-cart-btn">
							Aggiungi al Carrello (30,00 €)
						</button>
						<button type="button" class="pbs-btn-secondary pbs-full-width" id="pbs-download-preview-pdf" style="margin-top:8px;">
							⬇ Scarica Prova PDF 206x206mm (Test Stampa)
						</button>
						<div id="pbs-cart-feedback" class="pbs-feedback"></div>
					</div>
				</div>
			</div>
		</div>
		<?php
		return ob_get_clean();
	}

	/**
	 * Endpoint AJAX: riceve il PNG Base64 del personaggio, lo salva su disco e aggiunge il libro a WooCommerce
	 */
	public function ajax_add_to_cart() {
		check_ajax_referer( 'propp_studio_nonce', 'nonce' );

		if ( ! function_exists( 'WC' ) ) {
			wp_send_json_error( array( 'message' => 'WooCommerce non è attivo sul sito.' ) );
		}

		$product_id  = isset( $_POST['product_id'] ) ? (int) $_POST['product_id'] : $this->get_or_create_wc_product();
		$avatar_b64  = isset( $_POST['avatar_png'] ) ? $_POST['avatar_png'] : '';
		$config_json = isset( $_POST['config'] ) ? wp_unslash( $_POST['config'] ) : '';

		$config = json_decode( $config_json, true );
		if ( ! $product_id || empty( $avatar_b64 ) || ! is_array( $config ) ) {
			wp_send_json_error( array( 'message' => 'Dati di configurazione incompleti.' ) );
		}

		$avatar_url = $this->save_base64_png( $avatar_b64, 'avatar' );
		if ( ! $avatar_url ) {
			wp_send_json_error( array( 'message' => 'Impossibile salvare il PNG del personaggio.' ) );
		}

		$cart_item_data = array(
			'propp_book_config'     => $config,
			'propp_Wait_avatar_url' => $avatar_url,
			'propp_custom_price'    => 30.00,
			'unique_key'            => md5( microtime() . rand() ),
		);

		$cart_item_key = WC()->cart->add_to_cart( $product_id, 1, 0, array(), $cart_item_data );

		if ( ! $cart_item_key ) {
			wp_send_json_error( array( 'message' => 'Errore durante l\'inserimento nel carrello.' ) );
		}

		wp_send_json_success( array(
			'message'  => 'Libro personalizzato aggiunto al carrello!',
			'cart_url' => wc_get_cart_url(),
		) );
	}

	private function save_base64_png( $base64_string, $prefix = 'img' ) {
		if ( strpos( $base64_string, 'data:image/png;base64,' ) !== 0 ) {
			return false;
		}
		$data = base64_decode( substr( $base64_string, strpos( $base64_string, ',' ) + 1 ) );
		if ( ! $data ) {
			return false;
		}
		$filename = $prefix . '-' . gmdate( 'Ymd-His' ) . '-' . wp_generate_password( 6, false ) . '.png';
		$filepath = $this->upload_dir . 'orders/' . $filename;

		if ( file_put_contents( $filepath, $data ) ) {
			return $this->upload_url . 'orders/' . $filename;
		}
		return false;
	}

	public function display_cart_item_data( $item_data, $cart_item ) {
		if ( isset( $cart_item['propp_book_config'] ) ) {
			$cfg = $cart_item['propp_book_config'];
			$item_data[] = array(
				'key'   => 'Protagonista',
				'value' => esc_html( $cfg['child']['name'] . ' (' . ( $cfg['child']['gender'] === 'F' ? 'Bambina' : 'Bambino' ) . ')' ),
			);
			if ( ! empty( $cfg['story_summary'] ) ) {
				$item_data[] = array(
					'key'   => 'Trama di Propp',
					'value' => esc_html( $cfg['story_summary'] ),
				);
			}
			$item_data[] = array(
				'key'   => 'Formato',
				'value' => '20x20 cm Quadrato',
			);
		}
		return $item_data;
	}

	public function custom_cart_thumbnail( $product_image, $cart_item, $cart_item_key ) {
		if ( ! empty( $cart_item['propp_Wait_avatar_url'] ) ) {
			return '<img src="' . esc_url( $cart_item['propp_Wait_avatar_url'] ) . '" style="width:72px;height:72px;background:#f1f5f9;border-radius:8px;object-fit:contain;" alt="Avatar" />';
		}
		return $product_image;
	}

	public function lock_custom_book_price( $cart ) {
		if ( is_admin() && ! defined( 'DOING_AJAX' ) ) {
			return;
		}
		foreach ( $cart->get_cart() as $cart_item ) {
			if ( isset( $cart_item['propp_custom_price'] ) ) {
				$cart_item['data']->set_price( (float) $cart_item['propp_custom_price'] );
			}
		}
	}

	public function save_order_item_meta( $item, $cart_item_key, $values, $order ) {
		if ( isset( $values['propp_book_config'] ) ) {
			$cfg = $values['propp_book_config'];
			$item->add_meta_data( 'Protagonista', $cfg['child']['name'], true );
			$item->add_meta_data( 'Trama Scelta', isset( $cfg['story_summary'] ) ? $cfg['story_summary'] : '', true );
			$item->add_meta_data( '_propp_avatar_png', $values['propp_Wait_avatar_url'], true );
			$item->add_meta_data( '_propp_raw_json', wp_json_encode( $cfg, JSON_UNESCAPED_UNICODE ), true );
		}
	}

	public function register_order_print_metabox() {
		$screens = array( 'shop_order', 'woocommerce_page_wc-orders' );
		foreach ( $screens as $screen ) {
			add_meta_box(
				'propp_order_print_box',
				'Stampa Libro 20x20 cm (Propp Book Studio)',
				array( $this, 'render_order_print_metabox' ),
				$screen,
				'normal',
				'high'
			);
		}
	}

	public function render_order_print_metabox( $post_or_order ) {
		$order = ( $post_or_order instanceof WC_Order ) ? $post_or_order : wc_get_order( $post_or_order->ID );
		if ( ! $order ) {
			return;
		}

		$found = false;
		foreach ( $order->get_items() as $item_id => $item ) {
			$raw_json   = $item->get_meta( '_propp_raw_json' );
			$avatar_url = $item->get_meta( '_propp_avatar_png' );
			if ( ! $raw_json ) {
				continue;
			}
			$found = true;
			?>
			<div style="display:flex;align-items:center;gap:16px;padding:12px;border:1px solid #cbd5e1;border-radius:8px;margin-bottom:12px;background:#f8fafc;">
				<?php if ( $avatar_url ) : ?>
					<img src="<?php echo esc_url( $avatar_url ); ?>" style="width:90px;height:90px;background:#fff;border-radius:8px;border:1px solid #e2e8f0;" />
				<?php endif; ?>
				<div style="flex:1;">
					<h4 style="margin:0 0 6px 0;">Riga Ordine #<?php echo esc_html( $item_id ); ?> — <?php echo esc_html( $item->get_meta( 'Protagonista' ) ); ?></h4>
					<p style="margin:0 0 8px 0;color:#475569;"><strong>Moduli:</strong> <?php echo esc_html( $item->get_meta( 'Trama Scelta' ) ); ?></p>
					<button type="button"
						class="button button-primary propp-admin-print-btn"
						data-config="<?php echo esc_attr( $raw_json ); ?>"
						data-avatar="<?php echo esc_url( $avatar_url ); ?>">
						⬇ Genera PDF Esecutivo 206x206mm (300 DPI con 3mm abbondanza)
					</button>
					<?php if ( $avatar_url ) : ?>
						<a href="<?php echo esc_url( $avatar_url ); ?>" download class="button" style="margin-left:6px;">Scarica PNG Bambino</a>
					<?php endif; ?>
				</div>
			</div>
			<?php
		}

		if ( ! $found ) {
			echo '<p>Nessun libro personalizzato Propp presente in questo ordine.</p>';
		}
	}

	private function get_default_manifest() {
		return array(
			'book_format' => array(
				'trim_mm'  => 200,
				'bleed_mm' => 3,
				'total_mm' => 206,
				'dpi'      => 300,
			),
			'palettes' => array(
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
					array( 'label' => 'Rosso Esploratore', 'hex' => '#E11D48' ),
					array( 'label' => 'Blu Galassia', 'hex' => '#2563EB' ),
					array( 'label' => 'Verde Bosco', 'hex' => '#059669' ),
					array( 'label' => 'Giallo Sole', 'hex' => '#D97706' ),
				),
			),
			'hair_styles' => array(
				array(
					'id'    => 'short_tuft',
					'label' => 'Ciuffo Ribelle',
					'svg'   => '<path class="fill-hair" d="M290,330 C275,210 380,145 505,150 C635,155 725,220 710,330 C680,265 620,235 510,235 C410,235 345,260 290,330 Z M450,155 C480,105 555,105 585,155 Z"/>',
				),
				array(
					'id'    => 'curly_cloud',
					'label' => 'Riccioli Morbidi',
					'svg'   => '<g class="fill-hair"><circle cx="340" cy="250" r="68"/><circle cx="425" cy="195" r="78"/><circle cx="535" cy="190" r="82"/><circle cx="635" cy="240" r="72"/><circle cx="295" cy="320" r="52"/><circle cx="695" cy="315" r="52"/></g>',
				),
				array(
					'id'    => 'long_bob',
					'label' => 'Caschetto Lungo',
					'svg'   => '<path class="fill-hair" d="M275,490 C255,340 280,160 500,160 C720,160 745,340 725,490 C695,495 680,450 680,350 C650,245 350,245 320,350 C320,450 305,495 275,490 Z"/>',
				),
				array(
					'id'    => 'twin_buns',
					'label' => 'Doppio Chignon',
					'svg'   => '<g class="fill-hair"><circle cx="305" cy="185" r="65"/><circle cx="695" cy="185" r="65"/><path d="M290,340 C285,200 390,155 500,155 C610,155 715,200 710,340 C665,250 335,250 290,340 Z"/></g>',
				),
			),
			'propp_categories' => array(
				array(
					'step_key' => '1_setting',
					'title'    => '1. Situazione Iniziale (L\'Ambiente)',
					'options'  => array(
						array(
							'id'          => 'enchanted_woods',
							'label'       => 'Il Bosco dei Sussurri',
							'bg_sky'      => '#DCFCE7',
							'bg_ground'   => '#15803D',
							'bg_decor'    => 'trees',
							'avatar_slot' => array( 'x' => 50, 'y' => 54, 'scale' => 0.50, 'rotation' => 0 ),
							'tokens'      => array(
								'place_name' => 'Bosco dei Sussurri',
								'intro_text' => 'C\'era una volta {nome}, {un_una} bambin{o_a} curios{o_a} che amava esplorare i sentieri segreti del Bosco dei Sussurri, dove gli alberi parlano al vento.',
							),
						),
						array(
							'id'          => 'orbital_base',
							'label'       => 'La Stazione degli Anelli',
							'bg_sky'      => '#0F172A',
							'bg_ground'   => '#475569',
							'bg_decor'    => 'stars',
							'avatar_slot' => array( 'x' => 48, 'y' => 52, 'scale' => 0.48, 'rotation' => -6 ),
							'tokens'      => array(
								'place_name' => 'Stazione Spaziale degli Anelli',
								'intro_text' => 'Lassù tra le comete viveva {nome}, {il_la} più giovane esplorator{e_trice} della Stazione degli Anelli, sempre col naso incollato all\'oblò.',
							),
						),
						array(
							'id'          => 'coral_bay',
							'label'       => 'La Baia di Corallo',
							'bg_sky'      => '#CFFAFE',
							'bg_ground'   => '#0284C7',
							'bg_decor'    => 'waves',
							'avatar_slot' => array( 'x' => 52, 'y' => 54, 'scale' => 0.50, 'rotation' => 3 ),
							'tokens'      => array(
								'place_name' => 'Baia di Corallo',
								'intro_text' => 'Ai confini della Baia di Corallo, {nome} conosceva il nome di ogni conchiglia ed era sempre pront{o_a} a tuffarsi in una nuova avventura.',
							),
						),
					),
				),
				array(
					'step_key' => '2_donor',
					'title'    => '2. L\'Incontro col Donatore',
					'options'  => array(
						array(
							'id'          => 'clockwork_owl',
							'label'       => 'Il Gufo Meccanico',
							'bg_sky'      => '#FEF3C7',
							'bg_ground'   => '#B45309',
							'bg_decor'    => 'trees',
							'avatar_slot' => array( 'x' => 36, 'y' => 55, 'scale' => 0.47, 'rotation' => 0 ),
							'tokens'      => array(
								'donor_name' => 'il Gufo Meccanico',
								'donor_text' => 'Allontanandosi da {place_name}, {nome} incontrò un buffo Gufo Meccanico con un ingranaggio incastrato nell\'ala e si fermò subito ad aiutarlo.',
							),
						),
						array(
							'id'          => 'cloud_fox',
							'label'       => 'La Volpe delle Nuvole',
							'bg_sky'      => '#FCE7F3',
							'bg_ground'   => '#9D174D',
							'bg_decor'    => 'stars',
							'avatar_slot' => array( 'x' => 38, 'y' => 55, 'scale' => 0.47, 'rotation' => 4 ),
							'tokens'      => array(
								'donor_name' => 'la Volpe delle Nuvole',
								'donor_text' => 'Lungo il confine di {place_name}, {nome} condivise la sua merenda con la timida Volpe delle Nuvole, conquistando la sua fiducia.',
							),
						),
					),
				),
				array(
					'step_key' => '3_magic_item',
					'title'    => '3. Il Mezzo Magico',
					'options'  => array(
						array(
							'id'          => 'star_lantern',
							'label'       => 'La Lanterna delle Stelle',
							'prop_color'  => '#FACC15',
							'prop_shape'  => 'lantern',
							'bg_sky'      => '#E0E7FF',
							'bg_ground'   => '#3730A3',
							'avatar_slot' => array( 'x' => 45, 'y' => 54, 'scale' => 0.49, 'rotation' => 0 ),
							'prop_slot'   => array( 'x' => 64, 'y' => 55, 'scale' => 0.20 ),
							'tokens'      => array(
								'item_name'   => 'la Lanterna delle Stelle',
								'item_gift'   => 'Per sdebitarsi, {donor_name} consegnò a {nome} la Lanterna delle Stelle, capace di sciogliere qualsiasi paura con un raggio dorato.',
								'item_action' => 'sollevò in alto la Lanterna delle Stelle sprigionando un caldo raggio dorato',
							),
						),
						array(
							'id'          => 'melody_key',
							'label'       => 'La Chiave Melodica',
							'prop_color'  => '#38BDF8',
							'prop_shape'  => 'key',
							'bg_sky'      => '#F0FDFA',
							'bg_ground'   => '#0F766E',
							'avatar_slot' => array( 'x' => 45, 'y' => 54, 'scale' => 0.49, 'rotation' => 0 ),
							'prop_slot'   => array( 'x' => 64, 'y' => 55, 'scale' => 0.20 ),
							'tokens'      => array(
								'item_name'   => 'la Chiave Melodica',
								'item_gift'   => 'Come ricompensa, {donor_name} affidò a {nome} la Chiave Melodica, che suonava una musica irresistibile appena veniva girata nell\'aria.',
								'item_action' => 'fece ruotare la Chiave Melodica suonando una sinfonia allegra',
							),
						),
					),
				),
				array(
					'step_key' => '4_antagonist',
					'title'    => '4. L\'Antagonista e il Ritorno',
					'options'  => array(
						array(
							'id'          => 'grumpy_giant',
							'label'       => 'Il Gigante Mangia-Colori',
							'bg_sky'      => '#FEE2E2',
							'bg_ground'   => '#991B1B',
							'avatar_slot' => array( 'x' => 35, 'y' => 56, 'scale' => 0.46, 'rotation' => -4 ),
							'prop_slot'   => array( 'x' => 53, 'y' => 52, 'scale' => 0.22 ),
							'tokens'      => array(
								'villain_name' => 'il Gigante Mangia-Colori',
								'climax_text'  => 'Quando il brontolone Gigante Mangia-Colori bloccò il sentiero, {nome} non indietreggiò: {item_action} e lo fece scoppiare a ridere!',
								'ending_text'  => 'Restituiti tutti i colori a {place_name}, {nome} tornò a casa da ver{o_a} ero{e_ina}, stringendo ancora {item_name} sotto il cuscino.',
							),
						),
						array(
							'id'          => 'shadow_dragon',
							'label'       => 'Il Drago Raffreddato',
							'bg_sky'      => '#F3E8FF',
							'bg_ground'   => '#6B21A8',
							'avatar_slot' => array( 'x' => 35, 'y' => 56, 'scale' => 0.46, 'rotation' => -4 ),
							'prop_slot'   => array( 'x' => 53, 'y' => 52, 'scale' => 0.22 ),
							'tokens'      => array(
								'villain_name' => 'il Drago Raffreddato',
								'climax_text'  => 'Davanti alla grotta del Drago Raffreddato che faceva tremare le montagne coi suoi starnuti, {nome} {item_action} calmandolo all\'istante!',
								'ending_text'  => 'Salutato il nuovo amico drago e salvat{o_a} {place_name}, {nome} rientrò a casa pront{o_a} per sognare la prossima avventura.',
							),
						),
					),
				),
			),
		);
	}
}

Propp_Book_Studio::get_instance();