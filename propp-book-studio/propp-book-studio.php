<?php
/**
 * Plugin Name: Propp Book Studio - Libri Personalizzati 20x20
 * Description: Configuratore modulare basato sulle funzioni di Propp con Avatar PNG Baker, pannello Admin, scenari dinamici e generatore PDF 20x20cm per WooCommerce.
 * Version: 1.1.0
 * Author: Giuseppe Calò
 * Text Domain: propp-book-studio
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Propp_Book_Studio {

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
			'1.1.0'
		);

		wp_register_script(
			'propp-studio-js',
			plugin_dir_url( __FILE__ ) . 'assets/studio.js',
			array(),
			'1.1.0',
			true
		);
	}

	public function register_admin_assets( $hook ) {
		// Se siamo nella pagina di gestione Propp Studio, attiva la Libreria Media di WP
		if ( 'toplevel_page_propp-book-studio' === $hook ) {
			wp_enqueue_media();
		}

		// Se siamo nella pagina ordini WooCommerce, carica studio.js per generare il PDF 300 DPI
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

		// 1. Salva Palette Colori
		if ( isset( $_POST['palettes'] ) && is_array( $_POST['palettes'] ) ) {
			foreach ( array( 'skin', 'hair', 'eyes', 'shirt' ) as $pal_key ) {
				$manifest['palettes'][ $pal_key ] = array();
				if ( ! empty( $_POST['palettes'][ $pal_key ]['label'] ) ) {
					$labels = $_POST['palettes'][ $pal_key ]['label'];
					$hexes  = $_POST['palettes'][ $pal_key ]['hex'];
					foreach ( $labels as $idx => $lbl ) {
						if ( trim( $lbl ) === '' ) {
							continue;
						}
						$manifest['palettes'][ $pal_key ][] = array(
							'label' => sanitize_text_field( wp_unslash( $lbl ) ),
							'hex'   => sanitize_hex_color( wp_unslash( $hexes[ $idx ] ) ) ?: '#000000',
						);
					}
				}
			}
		}

		// 2. Salva Acconciature SVG del Bambino
		if ( isset( $_POST['hair_styles'] ) && is_array( $_POST['hair_styles'] ) ) {
			$manifest['hair_styles'] = array();
			$ids    = $_POST['hair_styles']['id'];
			$labels = $_POST['hair_styles']['label'];
			$svgs   = $_POST['hair_styles']['svg'];

			foreach ( $labels as $idx => $lbl ) {
				if ( trim( $lbl ) === '' ) {
					continue;
				}
				$raw_id = sanitize_title( wp_unslash( ! empty( $ids[ $idx ] ) ? $ids[ $idx ] : $lbl ) );
				$manifest['hair_styles'][] = array(
					'id'    => str_replace( '-', '_', $raw_id ),
					'label' => sanitize_text_field( wp_unslash( $lbl ) ),
					'svg'   => wp_unslash( $svgs[ $idx ] ),
				);
			}
		}

		// 3. Salva Scenari e Carte di Propp
		if ( isset( $_POST['propp'] ) && is_array( $_POST['propp'] ) ) {
			foreach ( $manifest['propp_categories'] as &$cat ) {
				$step_key = $cat['step_key'];
				if ( empty( $_POST['propp'][ $step_key ]['label'] ) ) {
					continue;
				}
				$cat['options'] = array();
				$posted         = $_POST['propp'][ $step_key ];

				foreach ( $posted['label'] as $i => $lbl ) {
					if ( trim( $lbl ) === '' ) {
						continue;
					}
					$opt_id = sanitize_title( wp_unslash( ! empty( $posted['id'][ $i ] ) ? $posted['id'][ $i ] : $lbl ) );
					$opt_id = str_replace( '-', '_', $opt_id );

					$tokens = array();
					if ( ! empty( $posted['tokens'][ $i ] ) && is_array( $posted['tokens'][ $i ] ) ) {
						foreach ( $posted['tokens'][ $i ] as $t_key => $t_val ) {
							$tokens[ sanitize_key( $t_key ) ] = sanitize_textarea_field( wp_unslash( $t_val ) );
						}
					}

					$cat['options'][] = array(
						'id'          => $opt_id,
						'label'       => sanitize_text_field( wp_unslash( $lbl ) ),
						'bg_image'    => esc_url_raw( wp_unslash( $posted['bg_image'][ $i ] ?? '' ) ),
						'prop_image'  => esc_url_raw( wp_unslash( $posted['prop_image'][ $i ] ?? '' ) ),
						'bg_sky'      => sanitize_hex_color( wp_unslash( $posted['bg_sky'][ $i ] ?? '#DCFCE7' ) ) ?: '#DCFCE7',
						'bg_ground'   => sanitize_hex_color( wp_unslash( $posted['bg_ground'][ $i ] ?? '#15803D' ) ) ?: '#15803D',
						'bg_decor'    => 'trees',
						'prop_color'  => '#FACC15',
						'prop_shape'  => 'lantern',
						'avatar_slot' => array(
							'x'        => (float) ( $posted['av_x'][ $i ] ?? 50 ),
							'y'        => (float) ( $posted['av_y'][ $i ] ?? 54 ),
							'scale'    => (float) ( $posted['av_scale'][ $i ] ?? 0.50 ),
							'rotation' => (float) ( $posted['av_rot'][ $i ] ?? 0 ),
						),
						'prop_slot'   => array(
							'x'     => (float) ( $posted['pr_x'][ $i ] ?? 64 ),
							'y'     => (float) ( $posted['pr_y'][ $i ] ?? 55 ),
							'scale' => (float) ( $posted['pr_scale'][ $i ] ?? 0.20 ),
						),
						'tokens'      => $tokens,
					);
				}
			}
		}

		file_put_contents(
			$this->upload_dir . 'manifest.json',
			wp_json_encode( $manifest, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE )
		);

		wp_safe_redirect( add_query_arg( array( 'page' => 'propp-book-studio', 'updated' => '1' ), admin_url( 'admin.php' ) ) );
		exit;
	}

	/**
	 * Renderizza la pagina di gestione in wp-admin
	 */
	public function render_admin_page() {
		$manifest = $this->load_manifest();
		$token_fields_map = array(
			'1_setting'    => array(
				'place_name' => 'Nome Luogo ({place_name})',
				'intro_text' => 'Testo Pagina 1 (usa {nome}, {o_a}, {un_una}, {il_la})',
			),
			'2_donor'      => array(
				'donor_name' => 'Nome Donatore ({donor_name})',
				'donor_text' => 'Testo Pagina 2 (usa {nome}, {place_name})',
			),
			'3_magic_item' => array(
				'item_name'   => 'Nome Oggetto ({item_name})',
				'item_gift'   => 'Testo Pagina 3 (consegna oggetto)',
				'item_action' => 'Azione Climax ({item_action} usata a Pag. 4)',
			),
			'4_antagonist' => array(
				'villain_name' => 'Nome Antagonista ({villain_name})',
				'climax_text'  => 'Testo Pagina 4 (usa {nome}, {item_action})',
				'ending_text'  => 'Testo Pagina 5 Finale (usa {nome}, {place_name}, {item_name})',
			),
		);
		?>
		<div class="wrap">
			<h1>📚 Propp Book Studio — Gestione Scenari, Asset e Personaggio 20x20</h1>
			<p>Usa lo shortcode <code>[propp_book_editor]</code> in qualsiasi pagina per mostrare il configuratore ai clienti.</p>

			<?php if ( isset( $_GET['updated'] ) ) : ?>
				<div class="notice notice-success is-dismissible"><p><strong>Catalogo salvato con successo!</strong> Le modifiche sono già attive nel configuratore.</p></div>
			<?php endif; ?>

			<style>
				.pbs-admin-tabs { display:flex; gap:8px; margin:20px 0 16px; border-bottom:1px solid #cbd5e1; padding-bottom:10px; }
				.pbs-admin-tab { padding:9px 18px; border:1px solid #cbd5e1; background:#fff; border-radius:6px; cursor:pointer; font-weight:600; font-size:14px; }
				.pbs-admin-tab.active { background:#2271b1; color:#fff; border-color:#2271b1; }
				.pbs-admin-section { display:none; background:#fff; border:1px solid #cbd5e1; border-radius:8px; padding:20px; margin-bottom:20px; }
				.pbs-admin-section.active { display:block; }
				.pbs-repeater-card { border:1px solid #cbd5e1; background:#f8fafc; border-radius:8px; padding:16px; margin-bottom:14px; }
				.pbs-grid-4 { display:grid; grid-template-columns:repeat(4, 1fr); gap:12px; margin-top:12px; }
				.pbs-grid-2 { display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-top:10px; }
				.pbs-input-full { width:100%; }
				.pbs-remove-row { color:#b91c1c; cursor:pointer; background:none; border:none; font-weight:600; float:right; }
			</style>

			<div class="pbs-admin-tabs">
				<button type="button" class="pbs-admin-tab active" data-target="sec-scenarios">1. Scenari & Carte di Propp</button>
				<button type="button" class="pbs-admin-tab" data-target="sec-hair">2. Acconciature SVG (Bambino)</button>
				<button type="button" class="pbs-admin-tab" data-target="sec-palettes">3. Palette Colori</button>
			</div>

			<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
				<input type="hidden" name="action" value="propp_save_manifest" />
				<?php wp_nonce_field( 'propp_save_manifest_action', 'propp_manifest_nonce' ); ?>

				<!-- SEZIONE 1: SCENARI E CARTE DI PROPP -->
				<div id="sec-scenarios" class="pbs-admin-section active">
					<p>Carica qui gli sfondi illustrati 20x20 cm (consigliato <code>2433x2433 px</code>), imposta le coordinate <code>X, Y, Scala</code> dove comparirà il PNG scontornato del bambino e personalizza i testi.</p>

					<?php foreach ( $manifest['propp_categories'] as $cat ) :
						$step_key = $cat['step_key'];
						$t_fields = $token_fields_map[ $step_key ] ?? array();
						?>
						<hr style="margin:24px 0;" />
						<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
							<h2 style="margin:0;"><?php echo esc_html( $cat['title'] ); ?></h2>
							<button type="button" class="button pbs-add-scenario-btn" data-step="<?php echo esc_attr( $step_key ); ?>">+ Aggiungi Opzione a questa fase</button>
						</div>

						<div id="repeater-<?php echo esc_attr( $step_key ); ?>">
							<?php foreach ( $cat['options'] as $i => $opt ) : ?>
								<div class="pbs-repeater-card">
									<button type="button" class="pbs-remove-row" onclick="this.parentElement.remove()">✕ Rimuovi</button>
									<div class="pbs-grid-2">
										<div>
											<label><strong>Titolo Opzione (Bottone)</strong></label>
											<input type="text" class="pbs-input-full" name="propp[<?php echo esc_attr( $step_key ); ?>][label][]" value="<?php echo esc_attr( $opt['label'] ); ?>" required />
											<input type="hidden" name="propp[<?php echo esc_attr( $step_key ); ?>][id][]" value="<?php echo esc_attr( $opt['id'] ); ?>" />
										</div>
										<div style="display:flex;gap:12px;">
											<div style="flex:1;">
												<label><strong>Sfondo Illustrato 20x20 (JPG/PNG)</strong></label>
												<div style="display:flex;gap:6px;">
													<input type="text" class="pbs-input-full" name="propp[<?php echo esc_attr( $step_key ); ?>][bg_image][]" value="<?php echo esc_attr( $opt['bg_image'] ?? '' ); ?>" placeholder="URL dalla Libreria Media..." />
													<button type="button" class="button pbs-upload-btn">Sfoglia</button>
												</div>
											</div>
											<?php if ( '3_magic_item' === $step_key ) : ?>
											<div style="flex:1;">
												<label><strong>PNG Oggetto Magico Scontornato</strong></label>
												<div style="display:flex;gap:6px;">
													<input type="text" class="pbs-input-full" name="propp[<?php echo esc_attr( $step_key ); ?>][prop_image][]" value="<?php echo esc_attr( $opt['prop_image'] ?? '' ); ?>" placeholder="PNG trasparente..." />
													<button type="button" class="button pbs-upload-btn">Sfoglia</button>
												</div>
											</div>
											<?php endif; ?>
										</div>
									</div>

									<div class="pbs-grid-4">
										<div>
											<label>Posizione Bambino X (%)</label>
											<input type="number" step="0.5" class="pbs-input-full" name="propp[<?php echo esc_attr( $step_key ); ?>][av_x][]" value="<?php echo esc_attr( $opt['avatar_slot']['x'] ?? 50 ); ?>" />
										</div>
										<div>
											<label>Posizione Bambino Y (%)</label>
											<input type="number" step="0.5" class="pbs-input-full" name="propp[<?php echo esc_attr( $step_key ); ?>][av_y][]" value="<?php echo esc_attr( $opt['avatar_slot']['y'] ?? 54 ); ?>" />
										</div>
										<div>
											<label>Scala Bambino (es. 0.50)</label>
											<input type="number" step="0.01" class="pbs-input-full" name="propp[<?php echo esc_attr( $step_key ); ?>][av_scale][]" value="<?php echo esc_attr( $opt['avatar_slot']['scale'] ?? 0.50 ); ?>" />
										</div>
										<div>
											<label>Rotazione (°)</label>
											<input type="number" step="1" class="pbs-input-full" name="propp[<?php echo esc_attr( $step_key ); ?>][av_rot][]" value="<?php echo esc_attr( $opt['avatar_slot']['rotation'] ?? 0 ); ?>" />
										</div>
									</div>

									<input type="hidden" name="propp[<?php echo esc_attr( $step_key ); ?>][bg_sky][]" value="<?php echo esc_attr( $opt['bg_sky'] ?? '#DCFCE7' ); ?>" />
									<input type="hidden" name="propp[<?php echo esc_attr( $step_key ); ?>][bg_ground][]" value="<?php echo esc_attr( $opt['bg_ground'] ?? '#15803D' ); ?>" />

									<div class="pbs-grid-2" style="margin-top:12px;">
										<?php foreach ( $t_fields as $tk_key => $tk_label ) : ?>
											<div>
												<label><strong><?php echo esc_html( $tk_label ); ?></strong></label>
												<textarea rows="2" class="pbs-input-full" name="propp[<?php echo esc_attr( $step_key ); ?>][tokens][<?php echo esc_attr( $i ); ?>][<?php echo esc_attr( $tk_key ); ?>]"><?php echo esc_textarea( $opt['tokens'][ $tk_key ] ?? '' ); ?></textarea>
											</div>
										<?php endforeach; ?>
									</div>
								</div>
							<?php endforeach; ?>
						</div>
					<?php endforeach; ?>
				</div>

				<!-- SEZIONE 2: ACCONCIATURE DEL BAMBINO -->
				<div id="sec-hair" class="pbs-admin-section">
					<p>Incolla qui i tracciati SVG (su artboard <code>1000x1000</code>) esportati da Illustrator. Usa <code>class="fill-hair"</code> sui tracciati che devono prendere il colore scelto dall'utente.</p>
					<div id="pbs-hair-repeater">
						<?php foreach ( $manifest['hair_styles'] as $hair ) : ?>
							<div class="pbs-repeater-card">
								<button type="button" class="pbs-remove-row" onclick="this.parentElement.remove()">✕ Rimuovi</button>
								<div class="pbs-grid-2">
									<div>
										<label><strong>Nome Acconciatura</strong></label>
										<input type="text" class="pbs-input-full" name="hair_styles[label][]" value="<?php echo esc_attr( $hair['label'] ); ?>" />
										<input type="hidden" name="hair_styles[id][]" value="<?php echo esc_attr( $hair['id'] ); ?>" />
									</div>
									<div>
										<label><strong>Tracciato SVG (1000x1000)</strong></label>
										<textarea rows="3" class="pbs-input-full" style="font-family:monospace;font-size:12px;" name="hair_styles[svg][]"><?php echo esc_textarea( $hair['svg'] ); ?></textarea>
									</div>
								</div>
							</div>
						<?php endforeach; ?>
					</div>
					<button type="button" class="button" id="pbs-add-hair-btn">+ Aggiungi Nuova Acconciatura</button>
				</div>

				<!-- SEZIONE 3: PALETTE COLORI -->
				<div id="sec-palettes" class="pbs-admin-section">
					<div class="pbs-grid-2">
						<?php
						$pal_titles = array(
							'skin'  => 'Carnagioni',
							'hair'  => 'Colori Capelli',
							'eyes'  => 'Colori Occhi',
							'shirt' => 'Colori Maglietta',
						);
						foreach ( $pal_titles as $p_key => $p_title ) :
							?>
							<div class="pbs-repeater-card">
								<h3><?php echo esc_html( $p_title ); ?></h3>
								<div id="pal-wrap-<?php echo esc_attr( $p_key ); ?>">
									<?php foreach ( $manifest['palettes'][ $p_key ] as $col ) : ?>
										<div style="display:flex;gap:8px;margin-bottom:8px;align-items:center;">
											<input type="color" name="palettes[<?php echo esc_attr( $p_key ); ?>][hex][]" value="<?php echo esc_attr( $col['hex'] ); ?>" />
											<input type="text" class="pbs-input-full" name="palettes[<?php echo esc_attr( $p_key ); ?>][label][]" value="<?php echo esc_attr( $col['label'] ); ?>" />
											<button type="button" class="button-link-delete" onclick="this.parentElement.remove()">✕</button>
										</div>
									<?php endforeach; ?>
								</div>
								<button type="button" class="button pbs-add-color-btn" data-pal="<?php echo esc_attr( $p_key ); ?>">+ Aggiungi Colore</button>
							</div>
						<?php endforeach; ?>
					</div>
				</div>

				<p class="submit">
					<button type="submit" class="button button-primary button-hero">💾 Salva Tutto il Catalogo</button>
				</p>
			</form>
		</div>

		<script>
		document.addEventListener('DOMContentLoaded', function() {
			// Navigazione Tab Admin
			document.querySelectorAll('.pbs-admin-tab').forEach(tab => {
				tab.addEventListener('click', function() {
					document.querySelectorAll('.pbs-admin-tab').forEach(t => t.classList.remove('active'));
					document.querySelectorAll('.pbs-admin-section').forEach(s => s.classList.remove('active'));
					this.classList.add('active');
					document.getElementById(this.dataset.target).classList.add('active');
				});
			});

			// Apertura Libreria Media di WordPress per caricare sfondi e PNG
			document.body.addEventListener('click', function(e) {
				if (!e.target.classList.contains('pbs-upload-btn')) return;
				e.preventDefault();
				const inputField = e.target.previousElementSibling;
				const frame = wp.media({
					title: 'Seleziona Illustrazione 20x20 o PNG',
					button: { text: 'Usa questo file' },
					multiple: false
				});
				frame.on('select', function() {
					const attachment = frame.state().get('selection').first().toJSON();
					inputField.value = attachment.url;
				});
				frame.open();
			});

			// Aggiunta nuova acconciatura SVG
			document.getElementById('pbs-add-hair-btn').addEventListener('click', function() {
				const container = document.getElementById('pbs-hair-repeater');
				const div = document.createElement('div');
				div.className = 'pbs-repeater-card';
				div.innerHTML = `
					<button type="button" class="pbs-remove-row" onclick="this.parentElement.remove()">✕ Rimuovi</button>
					<div class="pbs-grid-2">
						<div>
							<label><strong>Nome Acconciatura</strong></label>
							<input type="text" class="pbs-input-full" name="hair_styles[label][]" placeholder="Es. Trecce" />
							<input type="hidden" name="hair_styles[id][]" value="" />
						</div>
						<div>
							<label><strong>Tracciato SVG (1000x1000)</strong></label>
							<textarea rows="3" class="pbs-input-full" style="font-family:monospace;font-size:12px;" name="hair_styles[svg][]" placeholder='<path class="fill-hair" d="..." />'></textarea>
						</div>
					</div>`;
				container.appendChild(div);
			});

			// Aggiunta nuovo colore in palette
			document.querySelectorAll('.pbs-add-color-btn').forEach(btn => {
				btn.addEventListener('click', function() {
					const pal = this.dataset.pal;
					const wrap = document.getElementById('pal-wrap-' + pal);
					const row = document.createElement('div');
					row.style.cssText = 'display:flex;gap:8px;margin-bottom:8px;align-items:center;';
					row.innerHTML = `
						<input type="color" name="palettes[${pal}][hex][]" value="#3B82F6" />
						<input type="text" class="pbs-input-full" name="palettes[${pal}][label][]" placeholder="Nome colore..." />
						<button type="button" class="button-link-delete" onclick="this.parentElement.remove()">✕</button>`;
					wrap.appendChild(row);
				});
			});

			// Clonazione card scenario per aggiungere nuovi ambienti/carte di Propp
			document.querySelectorAll('.pbs-add-scenario-btn').forEach(btn => {
				btn.addEventListener('click', function() {
					const stepKey = this.dataset.step;
					const container = document.getElementById('repeater-' + stepKey);
					const cards = container.querySelectorAll('.pbs-repeater-card');
					if (!cards.length) return;
					const newIndex = cards.length;
					const clone = cards[cards.length - 1].cloneNode(true);
					clone.querySelectorAll('input[type="text"], input[type="hidden"], textarea').forEach(inp => {
						if (inp.name.includes('[tokens]')) {
							inp.name = inp.name.replace(/\[tokens\]\[\d+\]/, '[tokens][' + newIndex + ']');
						}
						if (inp.type !== 'hidden' || inp.name.includes('[id]')) {
							inp.value = '';
						}
					});
					container.appendChild(clone);
				});
			});
		});
		</script>
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