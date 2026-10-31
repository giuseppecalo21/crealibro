/**
 * Propp Book Studio — motore di rendering condiviso.
 *
 * Lo stesso codice disegna le tavole nel configuratore del cliente, nell'anteprima
 * del pannello admin e nel PDF esecutivo generato dalla pagina ordine.
 * Le funzioni pubbliche sono esposte in window.ProppStudioEngine.
 */
(function () {
	'use strict';

	var TOTAL_MM = 206;
	var BLEED_MM = 3;

	/**
	 * Posizioni predefinite (in % della tavola, scala = lato del riquadro / lato tavola).
	 * Valgono quando un'opzione del catalogo non ha ancora una posizione salvata.
	 */
	var DEFAULT_SLOTS = {
		'1_setting': {
			avatar_slot: { x: 50, y: 54, scale: 0.50, rotation: 0 },
			cover_avatar_slot: { x: 50, y: 58, scale: 0.56, rotation: 0 },
			cover_prop_slot: { x: 70, y: 56, scale: 0.22, rotation: 0 },
			ending_avatar_slot: { x: 50, y: 53, scale: 0.50, rotation: 0 },
			ending_prop_slot: { x: 67, y: 54, scale: 0.19, rotation: 0 }
		},
		'2_donor': {
			avatar_slot: { x: 36, y: 55, scale: 0.47, rotation: 0 },
			npc_slot: { x: 70, y: 50, scale: 0.40, rotation: 0 }
		},
		'3_magic_item': {
			avatar_slot: { x: 45, y: 54, scale: 0.49, rotation: 0 },
			prop_slot: { x: 64, y: 55, scale: 0.20, rotation: 0 }
		},
		'4_antagonist': {
			avatar_slot: { x: 35, y: 56, scale: 0.46, rotation: -4 },
			prop_slot: { x: 53, y: 52, scale: 0.22, rotation: 0 },
			npc_slot: { x: 73, y: 48, scale: 0.50, rotation: 0 }
		}
	};

	var STEP_KEYS = ['1_setting', '2_donor', '3_magic_item', '4_antagonist'];

	/**
	 * Struttura delle 6 tavole: da quale fase prende lo sfondo, quali elementi
	 * contiene (in ordine di disegno) e da quale opzione legge la loro posizione.
	 */
	var PAGE_DEFS = [
		{
			title: 'Copertina',
			isCover: true,
			bgStep: '1_setting',
			fallback: { sky: '#DCFCE7', ground: '#15803D', decor: 'trees' },
			elements: [
				{ type: 'avatar', step: '1_setting', slot: 'cover_avatar_slot' },
				{ type: 'prop', step: '1_setting', slot: 'cover_prop_slot' }
			]
		},
		{
			title: '1. Situazione Iniziale',
			label: 'Capitolo 1 • L\'Ambiente',
			bgStep: '1_setting',
			fallback: { sky: '#DCFCE7', ground: '#15803D', decor: 'trees' },
			elements: [
				{ type: 'avatar', step: '1_setting', slot: 'avatar_slot' }
			],
			text: { step: '1_setting', token: 'intro_text' }
		},
		{
			title: '2. Il Donatore',
			label: 'Capitolo 2 • Il Donatore',
			bgStep: '2_donor',
			fallback: { sky: '#FEF3C7', ground: '#B45309', decor: 'trees' },
			elements: [
				{ type: 'npc', step: '2_donor', slot: 'npc_slot' },
				{ type: 'avatar', step: '2_donor', slot: 'avatar_slot' }
			],
			text: { step: '2_donor', token: 'donor_text' }
		},
		{
			title: '3. Il Mezzo Magico',
			label: 'Capitolo 3 • Il Mezzo Magico',
			bgStep: '3_magic_item',
			forceDecor: 'stars',
			fallback: { sky: '#E0E7FF', ground: '#3730A3', decor: 'stars' },
			elements: [
				{ type: 'avatar', step: '3_magic_item', slot: 'avatar_slot' },
				{ type: 'prop', step: '3_magic_item', slot: 'prop_slot' }
			],
			text: { step: '3_magic_item', token: 'item_gift' }
		},
		{
			title: '4. La Sfida',
			label: 'Capitolo 4 • La Sfida',
			bgStep: '4_antagonist',
			decorStep: '1_setting',
			fallback: { sky: '#FEE2E2', ground: '#991B1B', decor: 'trees' },
			elements: [
				{ type: 'npc', step: '4_antagonist', slot: 'npc_slot' },
				{ type: 'avatar', step: '4_antagonist', slot: 'avatar_slot' },
				{ type: 'prop', step: '4_antagonist', slot: 'prop_slot' }
			],
			text: { step: '4_antagonist', token: 'climax_text' }
		},
		{
			title: '5. Il Ritorno',
			label: 'Capitolo 5 • Il Ritorno',
			bgStep: '1_setting',
			fallback: { sky: '#DCFCE7', ground: '#15803D', decor: 'trees' },
			elements: [
				{ type: 'avatar', step: '1_setting', slot: 'ending_avatar_slot' },
				{ type: 'prop', step: '1_setting', slot: 'ending_prop_slot' }
			],
			text: { step: '4_antagonist', token: 'ending_text' }
		}
	];

	// Righe di testo che entrano nel box narrativo senza uscire dal riquadro bianco
	var MAX_TEXT_LINES = 3;

	/* =========================================================
	 * 0. IMMAGINI ESTERNE (sfondi, oggetti e personaggi da WP Media)
	 * ========================================================= */
	var mediaCache = {};

	function cleanUrl(url) {
		return (typeof url === 'string') ? url.trim() : '';
	}

	/**
	 * Restituisce l'immagine se è già in memoria, altrimenti avvia il download e
	 * chiama onLoad quando è pronta (così chi disegna può ridisegnare).
	 */
	function requestImage(url, onLoad) {
		var u = cleanUrl(url);
		if (!u) return null;

		var entry = mediaCache[u];
		if (!entry) {
			entry = mediaCache[u] = { img: new Image(), status: 'loading', listeners: [] };
			entry.img.crossOrigin = 'anonymous';
			// In entrambi i casi chi aspettava l'immagine ridisegna (e, se serve, mostra l'errore)
			var notify = function (status) {
				entry.status = status;
				var list = entry.listeners;
				entry.listeners = [];
				list.forEach(function (fn) {
					try { fn(); } catch (e) { /* ignora */ }
				});
			};
			entry.img.onload = function () { notify('ok'); };
			entry.img.onerror = function () { notify('error'); };
			entry.img.src = u;
		}

		if (entry.status === 'ok') return entry.img;
		if (entry.status === 'loading' && typeof onLoad === 'function' && entry.listeners.indexOf(onLoad) === -1) {
			entry.listeners.push(onLoad);
		}
		return null;
	}

	function getImageStatus(url) {
		var u = cleanUrl(url);
		if (!u) return 'none';
		return mediaCache[u] ? mediaCache[u].status : 'idle';
	}

	function loadImage(url) {
		return new Promise(function (resolve) {
			var u = cleanUrl(url);
			if (!u) { resolve(null); return; }
			var img = requestImage(u, function () { resolve(mediaCache[u].img); });
			if (img) { resolve(img); return; }
			if (mediaCache[u].status === 'error') { resolve(null); return; }
			// Se il download fallisce, onLoad non arriva mai: controlla lo stato
			var timer = setInterval(function () {
				if (mediaCache[u].status !== 'loading') {
					clearInterval(timer);
					resolve(mediaCache[u].status === 'ok' ? mediaCache[u].img : null);
				}
			}, 100);
		});
	}

	function preloadStoryImages(m, story) {
		var opts = getSelectedOptions(m, story);
		var urls = [];
		STEP_KEYS.forEach(function (k) {
			if (opts[k]) urls.push(opts[k].bg_image, opts[k].npc_image);
		});
		if (opts['3_magic_item']) urls.push(opts['3_magic_item'].prop_image);
		return Promise.all(urls.map(loadImage));
	}

	/* =========================================================
	 * 1. AVATAR PNG BAKER
	 * ========================================================= */
	function buildAvatarSVGString(m, child) {
		var styles = (m && m.hair_styles) || [];
		var hairObj = styles.find(function (h) { return h.id === child.hairStyle; }) || styles[0];
		var hairMarkup = hairObj && hairObj.svg
			? String(hairObj.svg).replace(/class="fill-hair"/g, 'fill="' + child.hairColor + '"')
			: '';

		var glassesMarkup = child.glasses === 'round'
			? '<g stroke="#1E293B" stroke-width="14" fill="rgba(255,255,255,0.25)">' +
				'<circle cx="420" cy="395" r="52"/>' +
				'<circle cx="580" cy="395" r="52"/>' +
				'<line x1="472" y1="395" x2="528" y2="395"/>' +
			'</g>'
			: '';

		var skin = child.skinColor;
		return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" width="1000" height="1000">' +
			'<ellipse cx="500" cy="915" rx="190" ry="34" fill="rgba(0,0,0,0.18)"/>' +
			'<rect x="415" y="720" width="58" height="165" rx="26" fill="#1E293B"/>' +
			'<rect x="527" y="720" width="58" height="165" rx="26" fill="#1E293B"/>' +
			'<ellipse cx="435" cy="890" rx="48" ry="26" fill="#F8FAFC"/>' +
			'<ellipse cx="565" cy="890" rx="48" ry="26" fill="#F8FAFC"/>' +
			'<path d="M350,535 Q255,610 285,695" stroke="' + skin + '" stroke-width="64" stroke-linecap="round" fill="none"/>' +
			'<path d="M650,535 Q745,595 735,480" stroke="' + skin + '" stroke-width="64" stroke-linecap="round" fill="none"/>' +
			'<path d="M335,515 C335,470 665,470 665,515 L695,745 C695,765 305,765 305,745 Z" fill="' + child.shirtColor + '"/>' +
			'<polygon points="500,565 516,600 555,605 526,632 534,670 500,650 466,670 474,632 445,605 484,600" fill="rgba(255,255,255,0.65)"/>' +
			'<rect x="455" y="445" width="90" height="80" rx="30" fill="' + skin + '"/>' +
			'<circle cx="295" cy="395" r="38" fill="' + skin + '"/>' +
			'<circle cx="705" cy="395" r="38" fill="' + skin + '"/>' +
			'<ellipse cx="500" cy="375" rx="198" ry="182" fill="' + skin + '"/>' +
			'<ellipse cx="370" cy="435" rx="32" ry="18" fill="rgba(244,63,94,0.28)"/>' +
			'<ellipse cx="630" cy="435" rx="32" ry="18" fill="rgba(244,63,94,0.28)"/>' +
			'<circle cx="420" cy="390" r="26" fill="#FFFFFF"/>' +
			'<circle cx="580" cy="390" r="26" fill="#FFFFFF"/>' +
			'<circle cx="420" cy="390" r="16" fill="' + child.eyeColor + '"/>' +
			'<circle cx="580" cy="390" r="16" fill="' + child.eyeColor + '"/>' +
			'<circle cx="426" cy="384" r="6" fill="#FFFFFF"/>' +
			'<circle cx="586" cy="384" r="6" fill="#FFFFFF"/>' +
			'<path d="M488,415 Q500,428 512,415" stroke="rgba(0,0,0,0.35)" stroke-width="7" stroke-linecap="round" fill="none"/>' +
			'<path d="M445,462 Q500,508 555,462" stroke="#881337" stroke-width="11" stroke-linecap="round" fill="none"/>' +
			glassesMarkup +
			hairMarkup +
		'</svg>';
	}

	function svgToDataUrl(svgString) {
		return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgString);
	}

	/**
	 * Converte l'SVG del personaggio in un PNG trasparente 1000x1000.
	 * Se l'SVG non è valido (es. tracciato acconciatura incollato male) risolve con error: true.
	 */
	function bakeAvatarPNG(m, child) {
		return new Promise(function (resolve) {
			var img = new Image();
			img.onload = function () {
				var off = document.createElement('canvas');
				off.width = 1000;
				off.height = 1000;
				var ctx = off.getContext('2d');
				ctx.drawImage(img, 0, 0, 1000, 1000);
				var pngDataUrl = off.toDataURL('image/png');
				var baked = new Image();
				baked.onload = function () {
					resolve({ imgElement: baked, dataUrl: pngDataUrl, error: false });
				};
				baked.src = pngDataUrl;
			};
			img.onerror = function () {
				resolve({ imgElement: null, dataUrl: '', error: true });
			};
			img.src = svgToDataUrl(buildAvatarSVGString(m, child));
		});
	}

	/* =========================================================
	 * 2. MOTORE TESTUALE DI PROPP
	 * ========================================================= */
	function getSelectedOption(m, stepKey, selectedId) {
		if (!m || !Array.isArray(m.propp_categories)) return null;
		var cat = m.propp_categories.find(function (c) { return c.step_key === stepKey; });
		if (!cat || !Array.isArray(cat.options) || !cat.options.length) return null;
		return cat.options.find(function (o) { return o.id === selectedId; }) || cat.options[0];
	}

	function getSelectedOptions(m, story) {
		var out = {};
		STEP_KEYS.forEach(function (k) {
			out[k] = getSelectedOption(m, k, story ? story[k] : null);
		});
		return out;
	}

	function resolveProppTokens(m, template, child, story) {
		if (!template) return '';
		var isF = child.gender === 'F';
		var opts = getSelectedOptions(m, story);
		var dictionary = Object.assign(
			{},
			opts['1_setting'] ? opts['1_setting'].tokens : {},
			opts['2_donor'] ? opts['2_donor'].tokens : {},
			opts['3_magic_item'] ? opts['3_magic_item'].tokens : {},
			opts['4_antagonist'] ? opts['4_antagonist'].tokens : {},
			{
				nome: (child.name && child.name.trim()) ? child.name.trim() : 'Giorgio',
				o_a: isF ? 'a' : 'o',
				il_la: isF ? 'la' : 'il',
				un_una: isF ? 'una' : 'un',
				e_trice: isF ? 'trice' : 'e',
				e_ina: isF ? 'ina' : 'e'
			}
		);

		var output = String(template);
		for (var pass = 0; pass < 2; pass++) {
			output = output.replace(/\{([a-zA-Z0-9_]+)\}/g, function (match, key) {
				return typeof dictionary[key] !== 'undefined' ? dictionary[key] : match;
			});
		}
		return output;
	}

	/* =========================================================
	 * 3. SCENE COMPOSITOR 20x20
	 * ========================================================= */
	function toNumber(value, fallback) {
		var n = parseFloat(value);
		return isFinite(n) ? n : fallback;
	}

	function getSlot(option, stepKey, slotKey) {
		var d = (DEFAULT_SLOTS[stepKey] && DEFAULT_SLOTS[stepKey][slotKey]) || { x: 50, y: 50, scale: 0.3, rotation: 0 };
		var s = (option && option[slotKey]) || {};
		return {
			x: toNumber(s.x, d.x),
			y: toNumber(s.y, d.y),
			scale: toNumber(s.scale, d.scale),
			rotation: toNumber(s.rotation, d.rotation)
		};
	}

	/**
	 * Calcola cosa va disegnato in una tavola (senza disegnarlo).
	 */
	function computePageLayout(m, pageIndex, child, story) {
		var opts = getSelectedOptions(m, story);
		if (!opts['1_setting'] || !opts['2_donor'] || !opts['3_magic_item'] || !opts['4_antagonist']) return null;

		var index = PAGE_DEFS[pageIndex] ? pageIndex : 0;
		var def = PAGE_DEFS[index];
		var bgOpt = opts[def.bgStep];
		var decorOpt = opts[def.decorStep || def.bgStep];
		var magic = opts['3_magic_item'];

		var layout = {
			index: index,
			def: def,
			isCover: !!def.isCover,
			label: def.label || '',
			bgImage: cleanUrl(bgOpt.bg_image),
			sky: bgOpt.bg_sky || def.fallback.sky,
			ground: bgOpt.bg_ground || def.fallback.ground,
			decor: def.forceDecor || decorOpt.bg_decor || def.fallback.decor,
			title: '',
			subtitle: '',
			text: '',
			textLines: 0,
			maxTextLines: MAX_TEXT_LINES,
			elements: def.elements.map(function (e) {
				var owner = opts[e.step];
				return {
					type: e.type,
					step: e.step,
					slotKey: e.slot,
					slot: getSlot(owner, e.step, e.slot),
					option: e.type === 'prop' ? magic : owner,
					imageUrl: e.type === 'prop' ? cleanUrl(magic.prop_image) : (e.type === 'npc' ? cleanUrl(owner.npc_image) : '')
				};
			})
		};

		if (def.isCover) {
			layout.title = resolveProppTokens(m, '{nome} e {item_name}', child, story);
			layout.subtitle = resolveProppTokens(m, 'Un\'avventura in {place_name}', child, story);
		} else if (def.text) {
			var o = opts[def.text.step];
			layout.text = resolveProppTokens(m, o && o.tokens ? o.tokens[def.text.token] : '', child, story);
		}
		return layout;
	}

	function drawImageCover(ctx, img, W, H) {
		var iw = img.naturalWidth || img.width;
		var ih = img.naturalHeight || img.height;
		if (!iw || !ih) return;
		var s = Math.max(W / iw, H / ih);
		var dw = iw * s;
		var dh = ih * s;
		ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
	}

	function containSize(img, box) {
		var iw = img.naturalWidth || img.width;
		var ih = img.naturalHeight || img.height;
		if (!iw || !ih) return { w: box, h: box };
		var r = Math.min(box / iw, box / ih);
		return { w: iw * r, h: ih * r };
	}

	/**
	 * Disegna una tavola sul canvas e restituisce il layout con le coordinate
	 * in pixel di ogni elemento (usate dall'editor admin per il trascinamento).
	 *
	 * options.onAssetLoad: funzione chiamata quando un'immagine termina il download.
	 */
	function renderBookPageToCanvas(canvas, m, pageIndex, child, story, bakedAvatarImg, options) {
		if (!canvas) return null;
		options = options || {};
		var ctx = canvas.getContext('2d');
		var W = canvas.width;
		var H = canvas.height;
		ctx.clearRect(0, 0, W, H);

		var layout = computePageLayout(m, pageIndex, child, story);
		if (!layout) return null;

		var rerender = options.onAssetLoad || function () {
			renderBookPageToCanvas(canvas, m, pageIndex, child, story, bakedAvatarImg, options);
		};

		// 1. Sfondo: illustrazione caricata (ritagliata a quadrato) o paesaggio vettoriale di riserva
		var bg = requestImage(layout.bgImage, rerender);
		layout.bgLoaded = !!bg;
		if (bg) {
			drawImageCover(ctx, bg, W, H);
		} else {
			ctx.fillStyle = layout.sky;
			ctx.fillRect(0, 0, W, H);
			drawEnvironmentDecor(ctx, W, H, layout.decor, layout.ground);
			ctx.fillStyle = layout.ground;
			ctx.beginPath();
			ctx.moveTo(0, H * 0.64);
			ctx.quadraticCurveTo(W * 0.5, H * 0.56, W, H * 0.65);
			ctx.lineTo(W, H);
			ctx.lineTo(0, H);
			ctx.closePath();
			ctx.fill();
		}

		// 2. Personaggi e oggetti, nell'ordine di disegno della tavola
		layout.elements.forEach(function (el) {
			el.cx = (el.slot.x / 100) * W;
			el.cy = (el.slot.y / 100) * H;
			el.size = el.slot.scale * W;
			el.rotation = el.slot.rotation;
			el.w = el.size;
			el.h = el.size;
			el.drawn = false;
			el.usesFallback = false;

			var img = el.type === 'avatar' ? bakedAvatarImg : requestImage(el.imageUrl, rerender);

			ctx.save();
			ctx.translate(el.cx, el.cy);
			if (el.rotation) ctx.rotate((el.rotation * Math.PI) / 180);

			if (img) {
				var fit = containSize(img, el.size);
				el.w = fit.w;
				el.h = fit.h;
				ctx.drawImage(img, -fit.w / 2, -fit.h / 2, fit.w, fit.h);
				el.drawn = true;
			} else if (el.type === 'prop') {
				drawMagicProp(ctx, 0, 0, el.size, el.option);
				el.drawn = true;
				el.usesFallback = true;
			} else if (el.type === 'npc' && !bg) {
				// Segnaposto: compare solo se manca sia il PNG del personaggio sia l'illustrazione
				drawSceneCharacter(ctx, 0, 0, el.size * 0.55, el.option ? el.option.id : '');
				el.w = el.h = el.size * 0.5;
				el.drawn = true;
				el.usesFallback = true;
			}
			ctx.restore();
		});

		// 3. Tipografia: titolo di copertina o box narrativo
		if (layout.isCover) {
			ctx.fillStyle = 'rgba(255,255,255,0.92)';
			roundRect(ctx, W * 0.08, H * 0.07, W * 0.84, H * 0.20, W * 0.025);
			ctx.fill();

			ctx.fillStyle = '#0F172A';
			ctx.textAlign = 'center';
			ctx.font = 'bold ' + Math.round(W * 0.045) + 'px "Georgia", serif';
			ctx.fillText(layout.title, W * 0.5, H * 0.155, W * 0.78);

			ctx.fillStyle = '#475569';
			ctx.font = 'italic ' + Math.round(W * 0.028) + 'px "Georgia", serif';
			ctx.fillText(layout.subtitle, W * 0.5, H * 0.22, W * 0.78);
		} else {
			ctx.fillStyle = 'rgba(255,255,255,0.94)';
			roundRect(ctx, W * 0.07, H * 0.73, W * 0.86, H * 0.20, W * 0.02);
			ctx.fill();

			ctx.fillStyle = '#1E293B';
			ctx.textAlign = 'left';
			ctx.font = Math.round(W * 0.029) + 'px "Georgia", serif';
			layout.textLines = wrapText(ctx, layout.text, W * 0.11, H * 0.79, W * 0.78, Math.round(W * 0.042));

			ctx.fillStyle = '#64748B';
			ctx.textAlign = 'right';
			ctx.font = 'bold ' + Math.round(W * 0.02) + 'px sans-serif';
			ctx.fillText('Pag. ' + layout.index, W * 0.90, H * 0.905);
		}

		return layout;
	}

	function drawEnvironmentDecor(ctx, W, H, type, accentColor) {
		ctx.save();
		if (type === 'stars') {
			ctx.fillStyle = 'rgba(255,255,255,0.75)';
			[[0.15, 0.18], [0.82, 0.14], [0.65, 0.28], [0.25, 0.35], [0.88, 0.38], [0.45, 0.12]].forEach(function (p, i) {
				ctx.beginPath();
				ctx.arc(W * p[0], H * p[1], (i % 2 + 1) * (W * 0.006), 0, Math.PI * 2);
				ctx.fill();
			});
		} else if (type === 'trees') {
			ctx.fillStyle = accentColor;
			ctx.globalAlpha = 0.35;
			[[0.16, 0.52, 0.12], [0.84, 0.50, 0.14], [0.28, 0.56, 0.09]].forEach(function (p) {
				ctx.beginPath();
				ctx.arc(W * p[0], H * p[1], W * p[2], 0, Math.PI * 2);
				ctx.fill();
			});
		} else if (type === 'waves') {
			ctx.strokeStyle = 'rgba(255,255,255,0.55)';
			ctx.lineWidth = W * 0.01;
			ctx.beginPath();
			ctx.arc(W * 0.8, H * 0.22, W * 0.08, 0, Math.PI * 2);
			ctx.stroke();
		}
		ctx.restore();
	}

	function drawMagicProp(ctx, x, y, size, propOption) {
		ctx.save();
		ctx.translate(x, y);
		ctx.fillStyle = 'rgba(255,255,255,0.45)';
		ctx.beginPath();
		ctx.arc(0, 0, size * 0.52, 0, Math.PI * 2);
		ctx.fill();

		ctx.fillStyle = (propOption && propOption.prop_color) || '#FACC15';
		ctx.strokeStyle = '#1E293B';
		ctx.lineWidth = size * 0.05;
		if (!propOption || propOption.prop_shape !== 'key') {
			ctx.beginPath();
			ctx.arc(0, 0, size * 0.32, 0, Math.PI * 2);
			ctx.fill();
			ctx.stroke();
		} else {
			ctx.fillRect(-size * 0.12, -size * 0.32, size * 0.24, size * 0.64);
			ctx.strokeRect(-size * 0.12, -size * 0.32, size * 0.24, size * 0.64);
		}
		ctx.restore();
	}

	function drawSceneCharacter(ctx, x, y, size, npcId) {
		ctx.save();
		ctx.translate(x, y);
		ctx.fillStyle = (npcId && (npcId.indexOf('dragon') !== -1 || npcId.indexOf('giant') !== -1)) ? '#7C3AED' : '#D97706';
		ctx.beginPath();
		ctx.arc(0, 0, size * 0.45, 0, Math.PI * 2);
		ctx.fill();
		ctx.fillStyle = '#FFFFFF';
		ctx.beginPath();
		ctx.arc(-size * 0.14, -size * 0.08, size * 0.09, 0, Math.PI * 2);
		ctx.arc(size * 0.14, -size * 0.08, size * 0.09, 0, Math.PI * 2);
		ctx.fill();
		ctx.fillStyle = '#0F172A';
		ctx.beginPath();
		ctx.arc(-size * 0.14, -size * 0.08, size * 0.04, 0, Math.PI * 2);
		ctx.arc(size * 0.14, -size * 0.08, size * 0.04, 0, Math.PI * 2);
		ctx.fill();
		ctx.restore();
	}

	function roundRect(ctx, x, y, w, h, r) {
		ctx.beginPath();
		ctx.moveTo(x + r, y);
		ctx.arcTo(x + w, y, x + w, y + h, r);
		ctx.arcTo(x + w, y + h, x, y + h, r);
		ctx.arcTo(x, y + h, x, y, r);
		ctx.arcTo(x, y, x + w, y, r);
		ctx.closePath();
	}

	/** Va a capo sulle parole e restituisce il numero di righe scritte. */
	function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
		var words = String(text || '').split(' ');
		var line = '';
		var testY = y;
		var lines = 0;
		for (var n = 0; n < words.length; n++) {
			var testLine = line + words[n] + ' ';
			if (ctx.measureText(testLine).width > maxWidth && n > 0) {
				ctx.fillText(line.trim(), x, testY);
				lines++;
				line = words[n] + ' ';
				testY += lineHeight;
			} else {
				line = testLine;
			}
		}
		if (line.trim() !== '') {
			ctx.fillText(line.trim(), x, testY);
			lines++;
		}
		return lines;
	}

	/* =========================================================
	 * 4. COMPILATORE PDF 1.4 (206x206 mm con 3 mm di abbondanza)
	 * ========================================================= */
	function buildMultiPagePdfFromJpegs(jpegPages, widthMm, heightMm) {
		var ptW = (widthMm * 72 / 25.4).toFixed(2); // 206 mm = 583.94 pt
		var ptH = (heightMm * 72 / 25.4).toFixed(2);
		var bleedPt = (BLEED_MM * 72 / 25.4).toFixed(2);
		var trimW = (ptW - bleedPt).toFixed(2);
		var trimH = (ptH - bleedPt).toFixed(2);
		var chunks = [];
		var offsets = [];
		var byteLength = 0;
		var encoder = new TextEncoder();

		function pushStr(str) {
			var bytes = encoder.encode(str);
			chunks.push(bytes);
			byteLength += bytes.length;
		}
		function pushBin(uint8) {
			chunks.push(uint8);
			byteLength += uint8.length;
		}
		function startObj(id) {
			offsets[id] = byteLength;
			pushStr(id + ' 0 obj\n');
		}

		pushStr('%PDF-1.4\n%\xFF\xFF\xFF\xFF\n');

		var numPages = jpegPages.length;
		var kidsIds = [];
		for (var i = 0; i < numPages; i++) {
			kidsIds.push(3 + i * 3);
		}

		startObj(1);
		pushStr('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

		startObj(2);
		pushStr('<< /Type /Pages /Kids [' + kidsIds.map(function (id) { return id + ' 0 R'; }).join(' ') + '] /Count ' + numPages + ' >>\nendobj\n');

		jpegPages.forEach(function (page, idx) {
			var pageObjId = 3 + idx * 3;
			var contentObjId = pageObjId + 1;
			var imgObjId = pageObjId + 2;

			startObj(pageObjId);
			pushStr('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + ptW + ' ' + ptH + '] /TrimBox [' + bleedPt + ' ' + bleedPt + ' ' + trimW + ' ' + trimH + '] /Resources << /XObject << /Im' + idx + ' ' + imgObjId + ' 0 R >> >> /Contents ' + contentObjId + ' 0 R >>\nendobj\n');

			var streamCmd = 'q ' + ptW + ' 0 0 ' + ptH + ' 0 0 cm /Im' + idx + ' Do Q';
			startObj(contentObjId);
			pushStr('<< /Length ' + streamCmd.length + ' >>\nstream\n' + streamCmd + '\nendstream\nendobj\n');

			startObj(imgObjId);
			pushStr('<< /Type /XObject /Subtype /Image /Width ' + page.width + ' /Height ' + page.height + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + page.bytes.length + ' >>\nstream\n');
			pushBin(page.bytes);
			pushStr('\nendstream\nendobj\n');
		});

		var xrefPos = byteLength;
		var totalObjs = 3 + numPages * 3;
		pushStr('xref\n0 ' + totalObjs + '\n0000000000 65535 f \n');
		for (var j = 1; j < totalObjs; j++) {
			pushStr(String(offsets[j]).padStart(10, '0') + ' 00000 n \n');
		}
		pushStr('trailer\n<< /Size ' + totalObjs + ' /Root 1 0 R >>\nstartxref\n' + xrefPos + '\n%%EOF');

		return new Blob(chunks, { type: 'application/pdf' });
	}

	function dataUrlToUint8Array(dataUrl) {
		var raw = atob(dataUrl.split(',')[1]);
		var arr = new Uint8Array(raw.length);
		for (var i = 0; i < raw.length; i++) {
			arr[i] = raw.charCodeAt(i);
		}
		return arr;
	}

	function exportPrintReadyPDF(m, child, story, resolutionPx) {
		resolutionPx = resolutionPx || 2433; // 2433 px = 206 mm a 300 DPI
		return preloadStoryImages(m, story)
			.then(function () { return bakeAvatarPNG(m, child); })
			.then(function (baked) {
				var printCanvas = document.createElement('canvas');
				printCanvas.width = resolutionPx;
				printCanvas.height = resolutionPx;

				var jpegPages = [];
				for (var p = 0; p < PAGE_DEFS.length; p++) {
					renderBookPageToCanvas(printCanvas, m, p, child, story, baked.imgElement, { onAssetLoad: function () {} });
					jpegPages.push({
						width: resolutionPx,
						height: resolutionPx,
						bytes: dataUrlToUint8Array(printCanvas.toDataURL('image/jpeg', 0.94))
					});
				}

				var pdfBlob = buildMultiPagePdfFromJpegs(jpegPages, TOTAL_MM, TOTAL_MM);
				var link = document.createElement('a');
				link.href = URL.createObjectURL(pdfBlob);
				var cleanName = (child.name || 'Libro').toLowerCase().replace(/[^a-z0-9]/g, '');
				link.download = 'libro-20x20-' + cleanName + '-206x206mm.pdf';
				document.body.appendChild(link);
				link.click();
				document.body.removeChild(link);
			});
	}

	/* =========================================================
	 * API pubblica (usata anche dal pannello admin)
	 * ========================================================= */
	window.ProppStudioEngine = {
		TOTAL_MM: TOTAL_MM,
		BLEED_MM: BLEED_MM,
		STEP_KEYS: STEP_KEYS,
		DEFAULT_SLOTS: DEFAULT_SLOTS,
		PAGE_DEFS: PAGE_DEFS,
		getSlot: getSlot,
		getSelectedOption: getSelectedOption,
		buildAvatarSVGString: buildAvatarSVGString,
		svgToDataUrl: svgToDataUrl,
		bakeAvatarPNG: bakeAvatarPNG,
		resolveProppTokens: resolveProppTokens,
		computePageLayout: computePageLayout,
		renderBookPageToCanvas: renderBookPageToCanvas,
		requestImage: requestImage,
		loadImage: loadImage,
		getImageStatus: getImageStatus,
		exportPrintReadyPDF: exportPrintReadyPDF
	};

	/* =========================================================
	 * 5. CONFIGURATORE FRONTEND (shortcode [propp_book_editor])
	 * ========================================================= */
	function initFrontendApp() {
		var app = document.getElementById('propp-studio-app');
		if (!app || typeof ProppStudioData === 'undefined') return;

		var manifest = ProppStudioData.manifest;
		var firstHex = function (key, fallback) {
			var list = manifest.palettes && manifest.palettes[key];
			return (list && list[0] && list[0].hex) || fallback;
		};
		var firstOptionId = function (stepKey) {
			var opt = getSelectedOption(manifest, stepKey, null);
			return opt ? opt.id : '';
		};

		var state = {
			currentPage: 0,
			bakedAvatarImg: null,
			bakedAvatarDataUrl: '',
			child: {
				name: 'Giorgio',
				gender: 'M',
				skinColor: firstHex('skin', '#FAD7B8'),
				hairStyle: (manifest.hair_styles && manifest.hair_styles[0] && manifest.hair_styles[0].id) || 'short_tuft',
				hairColor: firstHex('hair', '#4A2511'),
				eyeColor: firstHex('eyes', '#2980B9'),
				shirtColor: firstHex('shirt', '#E11D48'),
				glasses: 'none'
			},
			story: {}
		};
		STEP_KEYS.forEach(function (k) { state.story[k] = firstOptionId(k); });

		var mainCanvas = document.getElementById('pbs-scene-canvas');
		var bakedPreviewImg = document.getElementById('pbs-baked-preview-img');
		var pageIndicator = document.getElementById('pbs-page-indicator');

		function redrawCurrentPage() {
			renderBookPageToCanvas(mainCanvas, manifest, state.currentPage, state.child, state.story, state.bakedAvatarImg);
			if (pageIndicator) {
				pageIndicator.textContent = PAGE_DEFS[state.currentPage].title + ' (' + (state.currentPage + 1) + ' / ' + PAGE_DEFS.length + ')';
			}
		}

		function refreshAvatarAndScene() {
			return bakeAvatarPNG(manifest, state.child).then(function (baked) {
				state.bakedAvatarImg = baked.imgElement;
				state.bakedAvatarDataUrl = baked.dataUrl;
				if (bakedPreviewImg) bakedPreviewImg.src = baked.dataUrl;
				redrawCurrentPage();
			});
		}

		// Selettori acconciature
		var hairGrid = document.getElementById('pbs-hair-style-selector');
		if (hairGrid) {
			(manifest.hair_styles || []).forEach(function (style) {
				var btn = document.createElement('button');
				btn.type = 'button';
				btn.className = 'pbs-choice-card' + (style.id === state.child.hairStyle ? ' active' : '');
				btn.textContent = style.label;
				btn.addEventListener('click', function () {
					state.child.hairStyle = style.id;
					hairGrid.querySelectorAll('.pbs-choice-card').forEach(function (b) { b.classList.remove('active'); });
					btn.classList.add('active');
					refreshAvatarAndScene();
				});
				hairGrid.appendChild(btn);
			});
		}

		function renderSwatches(containerId, paletteList, stateKey) {
			var wrap = document.getElementById(containerId);
			if (!wrap || !Array.isArray(paletteList)) return;
			paletteList.forEach(function (item) {
				var sw = document.createElement('button');
				sw.type = 'button';
				sw.className = 'pbs-swatch' + (state.child[stateKey] === item.hex ? ' active' : '');
				sw.style.backgroundColor = item.hex;
				sw.title = item.label;
				sw.addEventListener('click', function () {
					state.child[stateKey] = item.hex;
					wrap.querySelectorAll('.pbs-swatch').forEach(function (b) { b.classList.remove('active'); });
					sw.classList.add('active');
					refreshAvatarAndScene();
				});
				wrap.appendChild(sw);
			});
		}

		var pal = manifest.palettes || {};
		renderSwatches('pbs-skin-color-selector', pal.skin, 'skinColor');
		renderSwatches('pbs-hair-color-selector', pal.hair, 'hairColor');
		renderSwatches('pbs-eye-color-selector', pal.eyes, 'eyeColor');
		renderSwatches('pbs-shirt-color-selector', pal.shirt, 'shirtColor');

		// Carte di Propp (Step 2)
		var proppContainer = document.getElementById('pbs-propp-modules-container');
		function renderProppSelectors() {
			if (!proppContainer) return;
			proppContainer.innerHTML = '';
			manifest.propp_categories.forEach(function (cat, idx) {
				var block = document.createElement('div');
				block.className = 'pbs-propp-block';
				var title = document.createElement('h4');
				title.textContent = cat.title;
				block.appendChild(title);

				var grid = document.createElement('div');
				grid.className = 'pbs-propp-options';
				(cat.options || []).forEach(function (opt) {
					var card = document.createElement('button');
					card.type = 'button';
					card.className = 'pbs-choice-card' + (state.story[cat.step_key] === opt.id ? ' active' : '');
					card.textContent = opt.label;
					card.addEventListener('click', function () {
						state.story[cat.step_key] = opt.id;
						state.currentPage = idx + 1;
						renderProppSelectors();
						redrawCurrentPage();
					});
					grid.appendChild(card);
				});
				block.appendChild(grid);
				proppContainer.appendChild(block);
			});
		}
		renderProppSelectors();

		// Nome, sesso, occhiali
		var nameInput = document.getElementById('pbs-child-name');
		if (nameInput) {
			nameInput.addEventListener('input', function (e) {
				state.child.name = e.target.value;
				redrawCurrentPage();
			});
		}

		document.querySelectorAll('#pbs-gender-selector .pbs-pill').forEach(function (btn) {
			btn.addEventListener('click', function () {
				document.querySelectorAll('#pbs-gender-selector .pbs-pill').forEach(function (b) { b.classList.remove('active'); });
				btn.classList.add('active');
				state.child.gender = btn.dataset.gender;
				redrawCurrentPage();
			});
		});

		document.querySelectorAll('#pbs-glasses-selector .pbs-pill').forEach(function (btn) {
			btn.addEventListener('click', function () {
				document.querySelectorAll('#pbs-glasses-selector .pbs-pill').forEach(function (b) { b.classList.remove('active'); });
				btn.classList.add('active');
				state.child.glasses = btn.dataset.glasses;
				refreshAvatarAndScene();
			});
		});

		// Navigazione pagine e tab
		var total = PAGE_DEFS.length;
		document.getElementById('pbs-prev-page').addEventListener('click', function () {
			state.currentPage = (state.currentPage - 1 + total) % total;
			redrawCurrentPage();
		});
		document.getElementById('pbs-next-page').addEventListener('click', function () {
			state.currentPage = (state.currentPage + 1) % total;
			redrawCurrentPage();
		});

		document.getElementById('pbs-toggle-bleed').addEventListener('change', function (e) {
			document.getElementById('pbs-bleed-guide').style.display = e.target.checked ? 'block' : 'none';
		});

		function switchStep(stepNum) {
			document.querySelectorAll('.pbs-tab').forEach(function (t) { t.classList.toggle('active', t.dataset.step === String(stepNum)); });
			document.getElementById('pbs-step-1').classList.toggle('active', stepNum === 1);
			document.getElementById('pbs-step-2').classList.toggle('active', stepNum === 2);
		}

		document.querySelectorAll('.pbs-tab').forEach(function (t) {
			t.addEventListener('click', function () { switchStep(Number(t.dataset.step)); });
		});
		document.getElementById('pbs-goto-step-2').addEventListener('click', function () { switchStep(2); });

		// Mescola le carte
		document.getElementById('pbs-randomize-story').addEventListener('click', function () {
			manifest.propp_categories.forEach(function (cat) {
				if (cat.options && cat.options.length) {
					state.story[cat.step_key] = cat.options[Math.floor(Math.random() * cat.options.length)].id;
				}
			});
			renderProppSelectors();
			redrawCurrentPage();
		});

		// PDF di prova
		document.getElementById('pbs-download-preview-pdf').addEventListener('click', function () {
			var btn = this;
			var originalText = btn.textContent;
			btn.textContent = 'Generazione PDF 206x206mm in corso...';
			btn.disabled = true;
			exportPrintReadyPDF(manifest, state.child, state.story, 1800).then(function () {
				btn.textContent = originalText;
				btn.disabled = false;
			});
		});

		// Aggiunta al carrello WooCommerce
		document.getElementById('pbs-add-to-cart-btn').addEventListener('click', function () {
			var btn = this;
			var feedback = document.getElementById('pbs-cart-feedback');
			btn.disabled = true;
			btn.textContent = 'Salvataggio PNG e creazione ordine...';

			var summaryParts = manifest.propp_categories.map(function (cat) {
				var opt = getSelectedOption(manifest, cat.step_key, state.story[cat.step_key]);
				return opt ? opt.label : '';
			});

			var formData = new FormData();
			formData.append('action', 'propp_add_to_cart');
			formData.append('nonce', ProppStudioData.nonce);
			formData.append('product_id', ProppStudioData.productId);
			formData.append('avatar_png', state.bakedAvatarDataUrl);
			formData.append('config', JSON.stringify({
				child: state.child,
				story: state.story,
				story_summary: summaryParts.join(' → ')
			}));

			var resetBtn = function () {
				btn.disabled = false;
				btn.textContent = 'Aggiungi al Carrello (30,00 €)';
			};

			fetch(ProppStudioData.ajaxUrl, { method: 'POST', body: formData })
				.then(function (r) { return r.json(); })
				.then(function (res) {
					resetBtn();
					if (res.success) {
						feedback.innerHTML = '✅ ' + res.data.message + ' <a href="' + res.data.cart_url + '">Vai alla cassa &rarr;</a>';
						feedback.className = 'pbs-feedback success';
					} else {
						feedback.textContent = '⚠️ ' + (res.data && res.data.message ? res.data.message : 'Errore.');
						feedback.className = 'pbs-feedback error';
					}
				})
				.catch(function () {
					resetBtn();
					feedback.textContent = '⚠️ Errore di connessione col server.';
					feedback.className = 'pbs-feedback error';
				});
		});

		refreshAvatarAndScene();
	}

	/* =========================================================
	 * 6. PULSANTE "GENERA PDF ESECUTIVO" NELLA PAGINA ORDINE
	 * ========================================================= */
	function initAdminOrderButtons() {
		if (typeof ProppStudioData === 'undefined') return;
		document.querySelectorAll('.propp-admin-print-btn').forEach(function (btn) {
			btn.addEventListener('click', function () {
				var cfg = JSON.parse(btn.dataset.config);
				var prevLabel = btn.textContent;
				btn.textContent = 'Rendering 2433x2433px (300 DPI) in corso...';
				btn.disabled = true;
				exportPrintReadyPDF(ProppStudioData.manifest, cfg.child, cfg.story, 2433).then(function () {
					btn.textContent = prevLabel;
					btn.disabled = false;
				});
			});
		});
	}

	document.addEventListener('DOMContentLoaded', function () {
		initFrontendApp();
		initAdminOrderButtons();
	});
})();
