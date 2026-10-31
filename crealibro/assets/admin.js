/**
 * CreaLibro — pannello admin.
 *
 * Il catalogo vive in memoria (state): ogni campo modifica direttamente i dati,
 * le anteprime li leggono con lo stesso motore del configuratore e "Salva il catalogo"
 * li invia al server come JSON.
 */
(function () {
	'use strict';

	var E = window.CreaLibroEngine;
	var D = window.CreaLibroAdminData;
	if (!E || !D) return;

	var state = JSON.parse(JSON.stringify(D.catalog));
	var PHASES = D.phases || {};

	var TYPE_COLORS = { avatar: '#2563eb', npc: '#db2777', prop: '#d97706', text: '#0d9488' };
	var TYPE_FILLS = { avatar: 'rgba(37,99,235,0.10)', npc: 'rgba(219,39,119,0.12)', prop: 'rgba(217,119,6,0.12)', text: 'rgba(13,148,136,0.10)' };
	var AVATAR_BOX = { x0: 0.23, y0: 0.10, x1: 0.77, y1: 0.95 };
	var SAFE_MM = 4;   // margine di sicurezza indicato da Gelato
	var FOLD_MM = 8;   // fascia indicativa attorno alla piega
	var UNIT_PX = 560; // altezza della pagina rifilata nei canvas dell'editor

	var ui = {
		tab: 'storia',
		previewFormat: '',
		previewSetting: '',
		showGuides: true,
		bookSel: { blocks: {} },
		open: {} // schede aperte (blocchi, ambientazioni…)
	};
	var testChild = { name: 'Giorgio', gender: 'M', hairStyle: '', skinColor: '', hairColor: '', eyeColor: '', shirtColor: '', glasses: 'none' };
	var palIdx = { skinColor: 0, hairColor: 0, eyeColor: 0, shirtColor: 0 };
	var baked = null, bakedSig = '', bakeToken = 0;
	var editors = [];
	var dirty = false;
	var refreshQueued = false;

	/* =========================================================
	 * Utilità
	 * ========================================================= */
	function $(sel, root) { return (root || document).querySelector(sel); }
	function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
	function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
	function uid(prefix) { return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
	function clone(o) { return JSON.parse(JSON.stringify(o)); }

	/** Crea un elemento: h('div.classe', {attributi}, [figli]) */
	function h(tag, attrs, children) {
		var parts = tag.split('.');
		var el = document.createElement(parts[0] || 'div');
		if (parts.length > 1) el.className = parts.slice(1).join(' ');
		attrs = attrs || {};
		Object.keys(attrs).forEach(function (k) {
			var v = attrs[k];
			if (v === null || v === undefined || v === false) return;
			if (k === 'text') el.textContent = v;
			else if (k === 'html') el.innerHTML = v;
			else if (k.indexOf('on') === 0) el.addEventListener(k.slice(2), v);
			else if (k === 'style') el.style.cssText = v;
			else el.setAttribute(k, v === true ? '' : v);
		});
		(children || []).forEach(function (c) {
			if (c === null || c === undefined || c === false) return;
			el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
		});
		return el;
	}

	function markDirty() {
		dirty = true;
		var n = $('#cl-dirty');
		if (n) n.hidden = false;
	}

	function changed() {
		markDirty();
		scheduleRefresh();
	}

	/* =========================================================
	 * Dati: normalizzazione e valori predefiniti
	 * ========================================================= */
	function newSpread(side) {
		var left = side !== 'right';
		return {
			bg_image: '',
			npc_image: '',
			elements: {
				avatar: { x: left ? 27 : 73, y: 57, scale: 0.6, rotation: 0, show: true },
				npc: { x: left ? 62 : 38, y: 55, scale: 0.5, rotation: 0, show: false },
				prop: { x: left ? 40 : 60, y: 60, scale: 0.2, rotation: 0, show: false }
			},
			texts: [
				{ text: 'Scrivi qui il testo di questa doppia pagina.', show: true, x: left ? 75 : 25, y: 17, w: 40, size: 1, align: 'left', panel: true },
				{ text: '', show: false, x: left ? 25 : 75, y: 17, w: 40, size: 1, align: 'left', panel: true }
			]
		};
	}

	function newBlock() {
		return { id: uid('blocco'), label: 'Nuovo blocco', description: '', settings: [], prop_image: '', tokens: {}, spreads: [newSpread('left'), newSpread('right')] };
	}

	function normalize() {
		state.formats = state.formats || [];
		state.settings = state.settings || [];
		state.stages = state.stages || [];
		state.hair_styles = state.hair_styles || [];
		state.palettes = state.palettes || {};
		['skin', 'hair', 'eyes', 'shirt'].forEach(function (k) { state.palettes[k] = state.palettes[k] || []; });
		var fp = state.fixed_pages = state.fixed_pages || {};
		fp.title_page = fp.title_page || {};
		fp.rispetto = fp.rispetto || {};
		fp.rispetto.start = fp.rispetto.start || { bg_image: '', bg_color: '#F1F5F9' };
		fp.rispetto.end = fp.rispetto.end || { bg_image: '', bg_color: '#F1F5F9' };
		fp.branding = fp.branding || { bg_image: '', bg_color: '#FFFFFF' };
		fp.back_cover = fp.back_cover || { bg_image: '', bg_color: '#1E293B' };
		['avatar', 'title', 'subtitle'].forEach(function (k) {
			fp.title_page[k] = E.slotWithDefaults(fp.title_page[k], 'title_' + k);
		});
		state.settings.forEach(function (s) {
			s.tokens = s.tokens || {};
			s.cover = s.cover || {};
			['avatar', 'title', 'subtitle'].forEach(function (k) { s.cover[k] = E.slotWithDefaults(s.cover[k], 'cover_' + k); });
		});
		state.formats.forEach(function (f) { f.cover = f.cover || { width_mm: 0, height_mm: 0, spine_mm: 0 }; });
		state.stages.forEach(function (st) {
			st.blocks = st.blocks || [];
			st.blocks.forEach(function (b) {
				b.tokens = b.tokens || {};
				b.settings = b.settings || [];
				b.spreads = b.spreads || [];
				for (var k = 0; k < 2; k++) {
					var d = newSpread(k === 0 ? 'left' : 'right');
					var sp = b.spreads[k] = b.spreads[k] || d;
					sp.elements = sp.elements || {};
					['avatar', 'npc', 'prop'].forEach(function (key) { sp.elements[key] = Object.assign({}, d.elements[key], sp.elements[key] || {}); });
					sp.texts = sp.texts || [];
					for (var t = 0; t < 2; t++) sp.texts[t] = Object.assign({}, d.texts[t], { text: '' }, sp.texts[t] || {});
				}
			});
		});
	}

	function previewFormat() {
		return E.getFormat(state, ui.previewFormat) || { id: 'x', trim_mm: 200, bleed_mm: 3, cover: {} };
	}

	function previewSettingId() {
		var s = state.settings.find(function (x) { return x.id === ui.previewSetting; }) || state.settings[0];
		return s ? s.id : '';
	}

	/** Per le anteprime dei blocchi: se il blocco non vale per l'ambientazione di prova, usa la prima consentita. */
	function settingForBlock(block) {
		var sid = previewSettingId();
		if (block && block.settings && block.settings.length && block.settings.indexOf(sid) === -1) return block.settings[0];
		return sid;
	}

	/* =========================================================
	 * Personaggio di prova
	 * ========================================================= */
	function syncTestChild() {
		var ids = state.hair_styles.map(function (x) { return x.id; });
		if (ids.indexOf(testChild.hairStyle) === -1) testChild.hairStyle = ids[0] || '';
		[['skinColor', 'skin'], ['hairColor', 'hair'], ['eyeColor', 'eyes'], ['shirtColor', 'shirt']].forEach(function (p) {
			var list = state.palettes[p[1]];
			if (!list.length) return;
			palIdx[p[0]] = clamp(palIdx[p[0]], 0, list.length - 1);
			testChild[p[0]] = list[palIdx[p[0]]].hex;
		});
	}

	function ensureAvatar() {
		syncTestChild();
		var hair = state.hair_styles.find(function (x) { return x.id === testChild.hairStyle; });
		var sig = JSON.stringify([testChild.skinColor, testChild.hairColor, testChild.eyeColor, testChild.shirtColor, testChild.glasses, hair ? hair.svg : '']);
		if (baked && sig === bakedSig) return Promise.resolve(baked);
		bakedSig = sig;
		var token = ++bakeToken;
		return E.bakeAvatarPNG(state, testChild).then(function (res) {
			if (token !== bakeToken) return baked;
			baked = res;
			var img = $('#cl-test-avatar');
			if (img) img.src = res.error ? '' : res.dataUrl;
			var box = $('.cl-side-avatar');
			if (box) box.classList.toggle('has-error', !!res.error);
			return res;
		});
	}

	function avatarImg() { return baked ? baked.imgElement : null; }

	/* =========================================================
	 * Aggiornamento delle anteprime
	 * ========================================================= */
	function scheduleRefresh() {
		if (refreshQueued) return;
		refreshQueued = true;
		requestAnimationFrame(function () {
			refreshQueued = false;
			refreshAll();
		});
	}

	function refreshAll() {
		syncSide();
		ensureAvatar().then(function () {
			editors = editors.filter(function (ed) { return ed.root.isConnected; });
			editors.forEach(function (ed) { ed.render(); });
			document.querySelectorAll('[data-refresh]').forEach(function (el) {
				if (typeof el._refresh === 'function') el._refresh();
			});
		});
	}

	/* =========================================================
	 * Campi del modulo legati ai dati
	 * ========================================================= */
	function field(label, control, help) {
		return h('div.cl-field', {}, [
			label ? h('label', { text: label }) : null,
			control,
			help ? h('p.description', { text: help }) : null
		]);
	}

	function fText(label, obj, key, opts) {
		opts = opts || {};
		var input = opts.rows
			? h('textarea.widefat', { rows: opts.rows, placeholder: opts.placeholder || '' })
			: h('input.widefat', { type: 'text', placeholder: opts.placeholder || '' });
		input.value = obj[key] || '';
		input.addEventListener('input', function () {
			obj[key] = input.value;
			if (opts.onInput) opts.onInput(input.value);
			changed();
		});
		return field(label, input, opts.help);
	}

	function fNumber(label, obj, key, opts) {
		opts = opts || {};
		var input = h('input', { type: 'number', step: opts.step || 'any', min: opts.min, max: opts.max });
		input.value = obj[key];
		input.addEventListener('input', function () {
			var v = parseFloat(input.value);
			if (isFinite(v)) { obj[key] = v; changed(); }
		});
		return field(label, input, opts.help);
	}

	function fColor(label, obj, key) {
		var input = h('input', { type: 'color' });
		input.value = obj[key] || '#ffffff';
		input.addEventListener('input', function () { obj[key] = input.value; changed(); });
		return h('label.cl-inline', {}, [label + ' ', input]);
	}

	function fSelect(label, obj, key, options, onChange) {
		var sel = h('select');
		Object.keys(options).forEach(function (k) { sel.appendChild(h('option', { value: k, text: options[k] })); });
		sel.value = obj[key];
		sel.addEventListener('change', function () {
			obj[key] = sel.value;
			if (onChange) onChange(sel.value);
			changed();
		});
		return label ? h('label.cl-inline', {}, [label + ' ', sel]) : sel;
	}

	function fCheck(label, obj, key, onChange) {
		var input = h('input', { type: 'checkbox' });
		input.checked = !!obj[key];
		input.addEventListener('change', function () {
			obj[key] = input.checked;
			if (onChange) onChange(input.checked);
			changed();
		});
		return h('label.cl-check', {}, [input, ' ' + label]);
	}

	function fMedia(label, obj, key, help) {
		var thumb = h('span.cl-thumb', {}, [h('img', { alt: '' })]);
		var input = h('input.widefat', { type: 'text', placeholder: 'Scegli dalla Libreria Media o incolla un URL' });
		function update() {
			var url = (obj[key] || '').trim();
			input.value = obj[key] || '';
			$('img', thumb).src = url;
			thumb.classList.toggle('is-empty', !url);
		}
		input.addEventListener('input', function () { obj[key] = input.value; update(); changed(); });
		var browse = h('button.button', {
			type: 'button',
			text: 'Sfoglia',
			onclick: function () {
				if (!window.wp || !wp.media) return;
				var frame = wp.media({ title: label || 'Scegli un\'immagine', button: { text: 'Usa questa immagine' }, library: { type: 'image' }, multiple: false });
				frame.on('select', function () {
					obj[key] = frame.state().get('selection').first().toJSON().url;
					update();
					changed();
				});
				frame.open();
			}
		});
		var clear = h('button.button-link.cl-clear', { type: 'button', title: 'Togli immagine', text: '✕', onclick: function () { obj[key] = ''; update(); changed(); } });
		update();
		return field(label, h('div.cl-media', {}, [thumb, input, browse, clear]), help);
	}

	function fTokens(obj, help) {
		var wrap = h('div.cl-tokens');
		function render() {
			wrap.innerHTML = '';
			Object.keys(obj).forEach(function (k) {
				var keyIn = h('input', { type: 'text', value: k, class: 'cl-token-key' });
				var valIn = h('input.widefat', { type: 'text' });
				valIn.value = obj[k];
				keyIn.addEventListener('change', function () {
					var nk = keyIn.value.toLowerCase().replace(/[^a-z0-9_]/g, '');
					if (!nk || (nk !== k && obj[nk] !== undefined)) { keyIn.value = k; return; }
					var rebuilt = {};
					Object.keys(obj).forEach(function (kk) { rebuilt[kk === k ? nk : kk] = obj[kk]; });
					Object.keys(obj).forEach(function (kk) { delete obj[kk]; });
					Object.assign(obj, rebuilt);
					render();
					changed();
				});
				valIn.addEventListener('input', function () { obj[k] = valIn.value; changed(); });
				wrap.appendChild(h('div.cl-token-row', {}, [
					h('span.cl-brace', { text: '{' }), keyIn, h('span.cl-brace', { text: '}' }), valIn,
					h('button.button-link.cl-clear', { type: 'button', text: '✕', title: 'Rimuovi', onclick: function () { delete obj[k]; render(); changed(); } })
				]));
			});
			wrap.appendChild(h('button.button.button-small', {
				type: 'button',
				text: '+ Aggiungi segnaposto',
				onclick: function () {
					var n = 1;
					while (obj['nuovo_' + n] !== undefined) n++;
					obj['nuovo_' + n] = '';
					render();
					changed();
				}
			}));
		}
		render();
		return field('Segnaposti', wrap, help);
	}

	/* =========================================================
	 * Editor visuale di un foglio (pagina, doppia pagina, fronte di copertina)
	 * ========================================================= */
	var LABELS = { avatar: 'Bambino/a', npc: 'Personaggio', prop: 'Oggetto', text0: 'Testo 1', text1: 'Testo 2', title: 'Titolo', subtitle: 'Sottotitolo' };

	function elType(el) { return el.type; }
	function elLabel(el) { return LABELS[el.key] || el.key; }

	/**
	 * cfg.sheet()   foglio da disegnare
	 * cfg.sel()     selezione (ambientazione, blocchi, formato)
	 * cfg.target(k) oggetto dei dati che contiene la posizione dell'elemento k
	 * cfg.units     1 = pagina singola, 2 = doppia pagina
	 * cfg.binding   'left' | 'right' | 'center': dove sta la piega
	 * cfg.editable  false per le anteprime di sola lettura
	 */
	function createEditor(cfg) {
		var canvas = h('canvas', { tabindex: cfg.editable === false ? null : 0 });
		var warn = h('div.cl-warn', { hidden: true });
		var table = h('div.cl-slot-grid');
		var root = h('div.cl-editor' + (cfg.units === 2 ? '.is-spread' : ''), {}, [h('div.cl-canvas-wrap', {}, [canvas]), warn, cfg.editable === false ? null : table]);
		var ed = { root: root, canvas: canvas, layout: null, selected: null, geo: null, tableSig: '', inputs: [] };

		function geometry() {
			var fmt = previewFormat();
			var ratio = (fmt.bleed_mm || 0) / (fmt.trim_mm || 200);
			var bleedPx = Math.round(ratio * UNIT_PX);
			var W = cfg.units * UNIT_PX + 2 * bleedPx;
			var H = UNIT_PX + 2 * bleedPx;
			if (canvas.width !== W) canvas.width = W;
			if (canvas.height !== H) canvas.height = H;
			ed.geo = { fmt: fmt, bleedPx: bleedPx, trim: { x: bleedPx, y: bleedPx, w: cfg.units * UNIT_PX, h: UNIT_PX }, pxMm: UNIT_PX / (fmt.trim_mm || 200) };
		}

		ed.render = function () {
			geometry();
			ed.layout = E.renderSheet(canvas, state, cfg.sheet(), cfg.sel(), testChild, avatarImg(), {
				trim: ed.geo.trim, bleedPx: ed.geo.bleedPx, onAssetLoad: ed.render, placeholders: true
			});
			if (ui.showGuides) drawGuides();
			if (cfg.editable !== false) drawElements();
			updateWarnings();
			if (cfg.editable !== false) buildTable();
		};

		function drawGuides() {
			var ctx = canvas.getContext('2d');
			var g = ed.geo, t = g.trim, W = canvas.width, H = canvas.height;
			ctx.save();
			// Abbondanza (fuori dal rifilo)
			ctx.fillStyle = 'rgba(239,68,68,0.22)';
			ctx.beginPath();
			ctx.rect(0, 0, W, H);
			ctx.rect(t.x, t.y, t.w, t.h);
			ctx.fill('evenodd');
			ctx.lineWidth = 1.5;
			ctx.setLineDash([8, 5]);
			ctx.strokeStyle = 'rgba(220,38,38,0.95)';
			ctx.strokeRect(t.x, t.y, t.w, t.h);
			// Margine di sicurezza
			var s = SAFE_MM * g.pxMm;
			ctx.strokeStyle = 'rgba(37,99,235,0.8)';
			if (cfg.units === 2) {
				ctx.strokeRect(t.x + s, t.y + s, t.w / 2 - 2 * s, t.h - 2 * s);
				ctx.strokeRect(t.x + t.w / 2 + s, t.y + s, t.w / 2 - 2 * s, t.h - 2 * s);
			} else {
				ctx.strokeRect(t.x + s, t.y + s, t.w - 2 * s, t.h - 2 * s);
			}
			// Piega
			var f = FOLD_MM * g.pxMm;
			var foldX = cfg.binding === 'center' ? t.x + t.w / 2 : (cfg.binding === 'left' ? t.x : (cfg.binding === 'right' ? t.x + t.w : null));
			if (foldX !== null) {
				ctx.setLineDash([]);
				ctx.fillStyle = 'rgba(100,116,139,0.18)';
				ctx.fillRect(foldX - f, t.y, 2 * f, t.h);
				ctx.strokeStyle = 'rgba(71,85,105,0.9)';
				ctx.beginPath();
				ctx.moveTo(foldX, 0);
				ctx.lineTo(foldX, H);
				ctx.stroke();
			}
			ctx.restore();
		}

		function box(el) {
			if (el.type === 'avatar' && el.drawn) {
				var sz = el.size;
				return { x0: (AVATAR_BOX.x0 - 0.5) * sz, y0: (AVATAR_BOX.y0 - 0.5) * sz, x1: (AVATAR_BOX.x1 - 0.5) * sz, y1: (AVATAR_BOX.y1 - 0.5) * sz };
			}
			return { x0: -el.w / 2, y0: -el.h / 2, x1: el.w / 2, y1: el.h / 2 };
		}
		function toLocal(el, p) {
			var a = -(el.rotation || 0) * Math.PI / 180, dx = p.x - el.cx, dy = p.y - el.cy;
			return { x: dx * Math.cos(a) - dy * Math.sin(a), y: dx * Math.sin(a) + dy * Math.cos(a) };
		}
		function toWorld(el, x, y) {
			var a = (el.rotation || 0) * Math.PI / 180;
			return { x: el.cx + x * Math.cos(a) - y * Math.sin(a), y: el.cy + x * Math.sin(a) + y * Math.cos(a) };
		}
		function aabb(el) {
			var b = box(el);
			var pts = [toWorld(el, b.x0, b.y0), toWorld(el, b.x1, b.y0), toWorld(el, b.x1, b.y1), toWorld(el, b.x0, b.y1)];
			return {
				x0: Math.min.apply(null, pts.map(function (p) { return p.x; })), x1: Math.max.apply(null, pts.map(function (p) { return p.x; })),
				y0: Math.min.apply(null, pts.map(function (p) { return p.y; })), y1: Math.max.apply(null, pts.map(function (p) { return p.y; }))
			};
		}
		function handles(el) {
			var b = box(el), gap = UNIT_PX * 0.06;
			var below = el.cy + b.y0 - gap < UNIT_PX * 0.04;
			return {
				resize: { x: b.x1, y: b.y1 },
				rotate: el.type === 'text' ? null : { x: (b.x0 + b.x1) / 2, y: below ? b.y1 + gap : b.y0 - gap },
				below: below,
				anchorY: below ? b.y1 : b.y0
			};
		}

		function drawElements() {
			var ctx = canvas.getContext('2d');
			ctx.save();
			ed.layout.elements.forEach(function (el) {
				var sel = el.key === ed.selected;
				var color = TYPE_COLORS[el.type];
				var b = box(el);
				ctx.save();
				ctx.translate(el.cx, el.cy);
				ctx.rotate((el.rotation || 0) * Math.PI / 180);
				ctx.strokeStyle = color;
				ctx.lineWidth = sel ? 2.5 : 1.3;
				ctx.setLineDash(sel ? [] : [6, 4]);
				if (!el.drawn || sel) {
					ctx.fillStyle = TYPE_FILLS[el.type];
					ctx.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
				}
				ctx.strokeRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
				if (sel) {
					var hp = handles(el), hs = 13;
					ctx.setLineDash([]);
					ctx.fillStyle = '#fff';
					ctx.fillRect(hp.resize.x - hs / 2, hp.resize.y - hs / 2, hs, hs);
					ctx.strokeRect(hp.resize.x - hs / 2, hp.resize.y - hs / 2, hs, hs);
					if (hp.rotate) {
						ctx.beginPath();
						ctx.moveTo(hp.rotate.x, hp.anchorY);
						ctx.lineTo(hp.rotate.x, hp.rotate.y);
						ctx.stroke();
						ctx.beginPath();
						ctx.arc(hp.rotate.x, hp.rotate.y, 8, 0, Math.PI * 2);
						ctx.fill();
						ctx.stroke();
					}
				}
				ctx.restore();

				var label = elLabel(el) + (el.drawn ? '' : ' · non visibile');
				ctx.font = 'bold 12px system-ui, -apple-system, sans-serif';
				ctx.textBaseline = 'middle';
				ctx.textAlign = 'left';
				var tw = ctx.measureText(label).width + 12;
				var bb = aabb(el);
				var x = clamp(bb.x0, 2, canvas.width - tw - 2);
				var y = clamp(bb.y0 - 22, 2, canvas.height - 20);
				ctx.globalAlpha = sel ? 1 : 0.85;
				ctx.fillStyle = color;
				ctx.fillRect(x, y, tw, 19);
				ctx.fillStyle = '#fff';
				ctx.fillText(label, x + 6, y + 10);
				ctx.globalAlpha = 1;
			});
			ctx.restore();
		}

		function updateWarnings() {
			var msgs = [];
			var L = ed.layout;
			if (!L) { warn.hidden = true; return; }
			var t = ed.geo.trim;
			var src = L.source || {};
			if (L.bg.image && E.getImageStatus(L.bg.image) === 'error') msgs.push('L\'immagine di sfondo non si carica: controlla l\'URL.');
			var foldX = cfg.binding === 'center' ? t.x + t.w / 2 : null;
			var f = FOLD_MM * ed.geo.pxMm;
			L.elements.forEach(function (el) {
				if (el.imageUrl && E.getImageStatus(el.imageUrl) === 'error') msgs.push('Il PNG di «' + elLabel(el) + '» non si carica: controlla l\'URL.');
				if (el.type === 'text') {
					E.unresolvedTokens(el.text).forEach(function (tk) { msgs.push('«' + elLabel(el) + '»: il segnaposto ' + tk + ' non ha un valore con le scelte di prova.'); });
				}
				if (!el.drawn) {
					if (el.type === 'npc') msgs.push('Il personaggio non compare finché non carichi il suo PNG in questa doppia pagina.');
					if (el.type === 'prop') msgs.push('L\'oggetto non compare: nessun blocco precedente (o questo) ha un PNG dell\'oggetto.');
					return;
				}
				var bb = aabb(el);
				if (cfg.editable !== false && (bb.x0 < t.x - 1 || bb.y0 < t.y - 1 || bb.x1 > t.x + t.w + 1 || bb.y1 > t.y + t.h + 1)) {
					msgs.push('«' + elLabel(el) + '» supera la linea di taglio: la parte esterna andrà persa in stampa.');
				}
				if (foldX !== null && (el.type === 'text' || el.type === 'avatar') && bb.x0 < foldX + f && bb.x1 > foldX - f) {
					msgs.push('«' + elLabel(el) + '» finisce nella piega centrale: rischia di non leggersi o di essere tagliato dalla rilegatura.');
				}
			});
			if (src && L.sheet && L.sheet.kind === 'story' && !L.block) msgs.push('Nessun blocco disponibile per questa tappa.');
			warn.innerHTML = '';
			msgs.forEach(function (m) { warn.appendChild(h('p', { text: m })); });
			warn.hidden = !msgs.length;
		}

		function fmtVal(axis, v) {
			if (axis === 'rotation') v = ((v + 180) % 360 + 360) % 360 - 180;
			var lim = { x: [-50, 150], y: [-50, 150], scale: [0.02, 3], rotation: [-180, 180], w: [5, 200], size: [0.3, 5] }[axis];
			v = clamp(v, lim[0], lim[1]);
			return (axis === 'scale' || axis === 'size') ? Math.round(v * 1000) / 1000 : Math.round(v * 10) / 10;
		}

		function setValues(key, values) {
			var obj = cfg.target(key);
			if (!obj) return;
			Object.keys(values).forEach(function (a) { obj[a] = fmtVal(a, values[a]); });
			markDirty();
			ed.render();
		}

		function buildTable() {
			var els = ed.layout ? ed.layout.elements : [];
			var sig = els.map(function (e) { return e.key; }).join('|');
			if (sig !== ed.tableSig) {
				ed.tableSig = sig;
				ed.inputs = [];
				table.innerHTML = '';
				els.forEach(function (el) {
					var obj = cfg.target(el.key);
					if (!obj) return;
					var axes = el.type === 'text'
						? [['x', 'X %', 0.5], ['y', 'Y %', 0.5], ['w', 'Largh. %', 1], ['size', 'Dim.', 0.05]]
						: [['x', 'X %', 0.5], ['y', 'Y %', 0.5], ['scale', 'Scala', 0.01], ['rotation', 'Rot. °', 1]];
					var row = h('div.cl-slot-row', { 'data-key': el.key }, [
						h('span.cl-slot-name', { onclick: function () { ed.selected = el.key; ed.render(); } }, [h('span.cl-dot', { style: 'background:' + TYPE_COLORS[el.type] }), elLabel(el)])
					]);
					axes.forEach(function (a) {
						var input = h('input', { type: 'number', step: a[2] });
						input.addEventListener('input', function () {
							var v = parseFloat(input.value);
							if (!isFinite(v)) return;
							obj[a[0]] = v;
							markDirty();
							ed.render();
						});
						input.addEventListener('focus', function () { if (ed.selected !== el.key) { ed.selected = el.key; ed.render(); } });
						ed.inputs.push({ input: input, obj: obj, axis: a[0] });
						row.appendChild(h('label', {}, [h('span', { text: a[1] }), input]));
					});
					table.appendChild(row);
				});
			}
			ed.inputs.forEach(function (it) {
				if (document.activeElement !== it.input) it.input.value = it.obj[it.axis];
			});
			Array.prototype.forEach.call(table.children, function (row) {
				row.classList.toggle('is-selected', row.dataset.key === ed.selected);
			});
		}

		if (cfg.editable !== false) {
			var drag = null;
			var pt = function (e) {
				var r = canvas.getBoundingClientRect();
				return { x: (e.clientX - r.left) * canvas.width / r.width, y: (e.clientY - r.top) * canvas.height / r.height };
			};
			var find = function (key) { return ed.layout ? ed.layout.elements.find(function (e) { return e.key === key; }) : null; };
			var hit = function (p) {
				var els = ed.layout ? ed.layout.elements : [];
				for (var i = els.length - 1; i >= 0; i--) {
					var l = toLocal(els[i], p), b = box(els[i]);
					if (l.x >= b.x0 && l.x <= b.x1 && l.y >= b.y0 && l.y <= b.y1) return els[i];
				}
				return null;
			};
			var hitHandle = function (el, p) {
				var l = toLocal(el, p), hp = handles(el);
				if (dist(l, hp.resize) < 16) return 'resize';
				if (hp.rotate && dist(l, hp.rotate) < 16) return 'rotate';
				return null;
			};

			canvas.addEventListener('pointerdown', function (e) {
				var p = pt(e);
				var el = null, mode = null;
				var cur = find(ed.selected);
				if (cur) { mode = hitHandle(cur, p); if (mode) el = cur; }
				if (!mode) { el = hit(p); if (el) mode = 'move'; }
				ed.selected = el ? el.key : null;
				if (!el) { ed.render(); return; }
				e.preventDefault();
				canvas.focus({ preventScroll: true });
				canvas.setPointerCapture(e.pointerId);
				drag = { mode: mode, key: el.key, type: el.type, p0: p, s: clone(el.slot), c: { x: el.cx, y: el.cy }, d0: Math.max(10, dist(p, { x: el.cx, y: el.cy })), rotOff: handles(el).below ? -90 : 90 };
				canvas.classList.add('is-dragging');
				ed.render();
			});
			canvas.addEventListener('pointermove', function (e) {
				var p = pt(e);
				if (!drag) {
					var cur = find(ed.selected), hh = cur && hitHandle(cur, p);
					canvas.style.cursor = hh === 'resize' ? 'nwse-resize' : (hh === 'rotate' ? 'grab' : (hit(p) ? 'move' : 'default'));
					return;
				}
				var t = ed.geo.trim, s = drag.s, v = {};
				if (drag.mode === 'move') {
					v.x = s.x + (p.x - drag.p0.x) / t.w * 100;
					v.y = s.y + (p.y - drag.p0.y) / t.h * 100;
				} else if (drag.mode === 'resize') {
					if (drag.type === 'text') v.w = Math.abs(p.x - drag.c.x) * 2 / t.w * 100;
					else v.scale = s.scale * dist(p, drag.c) / drag.d0;
				} else if (drag.mode === 'rotate') {
					var a = Math.atan2(p.y - drag.c.y, p.x - drag.c.x) * 180 / Math.PI + drag.rotOff;
					a = ((a + 180) % 360 + 360) % 360 - 180;
					if (e.shiftKey) a = Math.round(a / 15) * 15; else if (Math.abs(a) < 3) a = 0;
					v.rotation = a;
				}
				setValues(drag.key, v);
			});
			var end = function (e) {
				if (!drag) return;
				drag = null;
				canvas.classList.remove('is-dragging');
				if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
			};
			canvas.addEventListener('pointerup', end);
			canvas.addEventListener('pointercancel', end);
			canvas.addEventListener('keydown', function (e) {
				var el = find(ed.selected);
				if (!el) return;
				var st = e.shiftKey ? 2 : 0.5, s = el.slot, v = null;
				switch (e.key) {
					case 'ArrowLeft': v = { x: s.x - st }; break;
					case 'ArrowRight': v = { x: s.x + st }; break;
					case 'ArrowUp': v = { y: s.y - st }; break;
					case 'ArrowDown': v = { y: s.y + st }; break;
					case '+': case '=': v = el.type === 'text' ? { w: s.w + 1 } : { scale: s.scale * 1.03 }; break;
					case '-': case '_': v = el.type === 'text' ? { w: s.w - 1 } : { scale: s.scale / 1.03 }; break;
					case '[': if (el.type !== 'text') v = { rotation: s.rotation - (e.shiftKey ? 5 : 1) }; break;
					case ']': if (el.type !== 'text') v = { rotation: s.rotation + (e.shiftKey ? 5 : 1) }; break;
					case 'Escape': ed.selected = null; ed.render(); e.preventDefault(); return;
				}
				if (v) { e.preventDefault(); setValues(el.key, v); }
			});
		}

		editors.push(ed);
		return ed;
	}

	/** Anteprima di sola lettura di un foglio in formato "libro aperto" (2:1). */
	function bookThumb(sheet, sel, width) {
		var c = h('canvas');
		var W = width || 520, H = Math.round(W / 2);
		c.width = W;
		c.height = H;
		c.setAttribute('data-refresh', '1');
		c._refresh = function () { drawOpenBook(c, sheet, sel); };
		return c;
	}

	function drawOpenBook(c, sheet, sel) {
		var ctx = c.getContext('2d');
		var W = c.width, H = c.height, half = W / 2;
		ctx.clearRect(0, 0, W, H);
		var redraw = function () { drawOpenBook(c, sheet, sel); };
		if (sheet.kind === 'cover') {
			ctx.fillStyle = '#e2e8f0';
			ctx.fillRect(0, 0, W, H);
			var g = E.coverGeometry(E.getFormat(state, sel.format) || previewFormat());
			var cw = Math.min(W, H * g.W / g.H), ch = cw * g.H / g.W;
			var off = h('canvas');
			off.width = Math.round(cw);
			off.height = Math.round(ch);
			E.renderCover(off, state, sel, testChild, avatarImg(), { onAssetLoad: redraw });
			ctx.drawImage(off, (W - cw) / 2, (H - ch) / 2);
			return;
		}
		if (E.sheetUnits(sheet) === 2) {
			E.renderSheet(c, state, sheet, sel, testChild, avatarImg(), { onAssetLoad: redraw });
		} else {
			ctx.fillStyle = '#e2e8f0';
			ctx.fillRect(0, 0, W, H);
			var x = sheet.side === 'left' ? 0 : half;
			E.renderSheet(c, state, sheet, sel, testChild, avatarImg(), { trim: { x: x, y: 0, w: half, h: H }, clear: false, onAssetLoad: redraw });
		}
		ctx.strokeStyle = 'rgba(15,23,42,0.35)';
		ctx.beginPath();
		ctx.moveTo(half, 0);
		ctx.lineTo(half, H);
		ctx.stroke();
	}

	/* =========================================================
	 * Schede del pannello
	 * ========================================================= */
	var TABS = [
		['storia', 'Storia'],
		['ambientazioni', 'Ambientazioni'],
		['fisse', 'Pagine fisse e copertina'],
		['libro', 'Anteprima del libro'],
		['formati', 'Formati di stampa'],
		['personaggio', 'Personaggio']
	];

	function renderTabs() {
		var nav = $('#cl-tabs');
		nav.innerHTML = '';
		TABS.forEach(function (t) {
			nav.appendChild(h('button.cl-tab' + (ui.tab === t[0] ? '.active' : ''), { type: 'button', text: t[1], onclick: function () { showTab(t[0]); } }));
		});
	}

	function showTab(id) {
		var y = window.scrollY;
		ui.tab = id;
		renderTabs();
		var app = $('#cl-app');
		app.innerHTML = '';
		editors = [];
		({ storia: tabStory, ambientazioni: tabSettings, fisse: tabFixed, libro: tabBook, formati: tabFormats, personaggio: tabCharacter })[id](app);
		refreshAll();
		return y;
	}

	/** Ridisegna la scheda corrente mantenendo la posizione di scorrimento. */
	function rerenderTab() {
		var y = window.scrollY;
		showTab(ui.tab);
		window.scrollTo(0, y);
	}

	function card(title, body, opts) {
		opts = opts || {};
		var head = h('div.cl-card-head', {}, [h('h3.cl-card-title', { text: title }), h('div.cl-card-actions', {}, opts.actions || [])]);
		return h('div.cl-card' + (opts.cls ? '.' + opts.cls : ''), {}, [head, h('div.cl-card-body', {}, body)]);
	}

	function moveItem(list, i, d) {
		var j = i + d;
		if (j < 0 || j >= list.length) return;
		var tmp = list[i];
		list[i] = list[j];
		list[j] = tmp;
		markDirty();
		rerenderTab();
	}

	function removeItem(list, i, what, min) {
		if (list.length <= (min || 0)) {
			window.alert('Non puoi eliminare l\'ultimo elemento: ' + what + ' deve averne almeno ' + min + '.');
			return;
		}
		if (!window.confirm('Eliminare questo elemento? Diventa definitivo quando salvi il catalogo.')) return;
		list.splice(i, 1);
		markDirty();
		rerenderTab();
	}

	/* ---------- Storia ---------- */
	function tokenHint(stageIndex) {
		var keys = {};
		Object.keys(E.genderTokens({ gender: 'M', name: 'x' })).forEach(function (k) { keys[k] = 'bambino'; });
		state.settings.forEach(function (s) { Object.keys(s.tokens || {}).forEach(function (k) { keys[k] = 'ambientazione'; }); });
		state.stages.forEach(function (st, i) {
			if (i > stageIndex) return;
			st.blocks.forEach(function (b) { Object.keys(b.tokens || {}).forEach(function (k) { keys[k] = 'blocchi'; }); });
		});
		return Object.keys(keys).map(function (k) { return '{' + k + '}'; }).join(' ');
	}

	function storySel(stage, block) {
		var sel = { setting: settingForBlock(block), format: previewFormat().id, blocks: {} };
		if (stage && block) sel.blocks[stage.id] = block.id;
		return sel;
	}

	function spreadEditor(stage, stageIndex, block, k) {
		var sp = block.spreads[k];
		var ed = createEditor({
			units: 2,
			binding: 'center',
			sheet: function () { return { kind: 'story', stageIndex: state.stages.indexOf(stage), stageId: stage.id, spread: k }; },
			sel: function () { return storySel(stage, block); },
			target: function (key) {
				if (key === 'text0') return sp.texts[0];
				if (key === 'text1') return sp.texts[1];
				return sp.elements[key];
			}
		});
		var first = 4 + stageIndex * 4 + k * 2; // pag. 1 titolo, 2-3 rispetto, poi 4 pagine per tappa
		var fields = h('div.cl-spread-fields', {}, [
			fMedia('Illustrazione della doppia pagina', sp, 'bg_image', 'Disegnala con l\'abbondanza su tutti i lati; viene ritagliata al centro se le proporzioni non coincidono.'),
			h('div.cl-row', {}, [
				fCheck('Bambino/a', sp.elements.avatar, 'show', rerenderSpreadTable),
				fCheck('Personaggio', sp.elements.npc, 'show', rerenderSpreadTable),
				fCheck('Oggetto della storia', sp.elements.prop, 'show', rerenderSpreadTable)
			]),
			sp.elements.npc.show ? fMedia('PNG del personaggio (scontornato)', sp, 'npc_image', 'Lascia vuoto se il personaggio è già disegnato nell\'illustrazione.') : null,
			textFields(sp.texts[0], 'Testo 1'),
			textFields(sp.texts[1], 'Testo 2')
		]);
		function rerenderSpreadTable() { rerenderTab(); }
		return h('div.cl-spread', {}, [
			h('h4.cl-spread-title', { text: 'Doppia pagina ' + (k + 1) + ' · pag. ' + first + '-' + (first + 1) }),
			h('div.cl-spread-body', {}, [fields, ed.root])
		]);
	}

	function textFields(t, label) {
		var area = fText(label, t, 'text', { rows: 3 });
		var opts = h('div.cl-row.cl-text-opts', {}, [
			fCheck('Mostra', t, 'show'),
			fCheck('Riquadro bianco', t, 'panel'),
			fSelect('Allineamento', t, 'align', { left: 'Sinistra', center: 'Centro', right: 'Destra' })
		]);
		return h('div.cl-text-block', {}, [area, opts]);
	}

	function blockCard(stage, stageIndex, block, bi) {
		var key = 'block:' + block.id;
		var details = h('details.cl-block', { open: ui.open[key] ? true : null });
		var summary = h('summary', {}, [
			h('span.cl-block-label', { text: block.label || 'Senza titolo' }),
			block.settings.length ? h('span.cl-badge', { text: 'solo: ' + block.settings.map(function (id) { var s = state.settings.find(function (x) { return x.id === id; }); return s ? s.label : id; }).join(', ') }) : null,
			h('span.cl-block-actions', {}, [
				h('button.button-link', { type: 'button', text: '↑', title: 'Sposta su', onclick: function (e) { e.preventDefault(); moveItem(stage.blocks, bi, -1); } }),
				h('button.button-link', { type: 'button', text: '↓', title: 'Sposta giù', onclick: function (e) { e.preventDefault(); moveItem(stage.blocks, bi, 1); } }),
				h('button.button-link.cl-danger', { type: 'button', text: 'Elimina', onclick: function (e) { e.preventDefault(); removeItem(stage.blocks, bi, 'la tappa', 1); } })
			])
		]);
		details.appendChild(summary);
		var body = h('div.cl-block-body');
		details.appendChild(body);

		function fill() {
			if (body.childElementCount) return;
			var settingsBox = h('div.cl-row');
			state.settings.forEach(function (s) {
				var cb = h('input', { type: 'checkbox' });
				cb.checked = block.settings.indexOf(s.id) !== -1;
				cb.addEventListener('change', function () {
					var i = block.settings.indexOf(s.id);
					if (cb.checked && i === -1) block.settings.push(s.id);
					if (!cb.checked && i !== -1) block.settings.splice(i, 1);
					changed();
				});
				settingsBox.appendChild(h('label.cl-check', {}, [cb, ' ' + s.label]));
			});
			body.appendChild(h('div.cl-grid-2', {}, [
				h('div', {}, [
					fText('Titolo del blocco (lo vede il cliente)', block, 'label', { onInput: function (v) { $('.cl-block-label', summary).textContent = v || 'Senza titolo'; } }),
					fText('Descrizione breve per il cliente', block, 'description'),
					field('Disponibile per le ambientazioni', settingsBox, 'Nessuna spunta = disponibile per tutte.')
				]),
				h('div', {}, [
					fMedia('PNG dell\'oggetto della storia (facoltativo)', block, 'prop_image', 'Se questo blocco consegna un oggetto, caricalo qui: potrai mostrarlo in questa doppia pagina e in quelle delle tappe successive.'),
					fTokens(block.tokens, 'Valori che questo blocco mette a disposizione dei testi, suoi e delle tappe successive (es. {aiutante}).')
				])
			]));
			body.appendChild(h('p.cl-hint', {}, [h('strong', { text: 'Segnaposti utilizzabili qui: ' }), tokenHint(stageIndex)]));
			body.appendChild(spreadEditor(stage, stageIndex, block, 0));
			body.appendChild(spreadEditor(stage, stageIndex, block, 1));
			refreshAll();
		}
		details.addEventListener('toggle', function () {
			ui.open[key] = details.open;
			if (details.open) fill();
		});
		if (details.open) fill();
		return details;
	}

	function tabStory(app) {
		var pages = E.innerPageCount(state);
		var stagesCount = state.stages.length;
		var summary = h('div.cl-howto', {}, [
			h('p', {}, [h('strong', { text: 'Struttura del libro: ' }), 'pag. 1 titolo · pag. 2-3 rispetto · ' + stagesCount + ' tappe da 4 pagine (2 doppie pagine ciascuna) · 2 pagine di rispetto · ultima pagina di branding = ', h('strong', { text: pages + ' pagine interne' }), '.']),
			pages < 30 ? h('p.cl-error', { text: 'Gelato richiede almeno 30 pagine interne: aggiungi tappe fino ad arrivarci (6 tappe = 30 pagine).' }) : null,
			h('p', { text: 'Il cliente sceglie un blocco per ogni tappa, nell\'ordine. Trascina gli elementi sulle anteprime; il quadratino ↘ ridimensiona, il pallino ⟳ ruota, le frecce della tastiera spostano di precisione. Linea rossa = taglio, blu = margine di sicurezza (4 mm), fascia grigia = piega.' })
		]);
		app.appendChild(summary);

		state.stages.forEach(function (stage, si) {
			var firstPage = 4 + si * 4;
			var blocksWrap = h('div.cl-blocks');
			stage.blocks.forEach(function (b, bi) { blocksWrap.appendChild(blockCard(stage, si, b, bi)); });
			var head = h('div.cl-stage-fields', {}, [
				fText('Nome della tappa', stage, 'label'),
				field('Fase del racconto', fSelect('', stage, 'phase', PHASES))
			]);
			app.appendChild(card('Tappa ' + (si + 1) + ' · pag. ' + firstPage + '-' + (firstPage + 3) + (stage.label ? ' · ' + stage.label : ''), [
				head,
				blocksWrap,
				h('button.button', { type: 'button', text: '+ Aggiungi blocco a questa tappa', onclick: function () {
					var b = newBlock();
					stage.blocks.push(b);
					ui.open['block:' + b.id] = true;
					markDirty();
					rerenderTab();
				} })
			], {
				cls: 'phase-' + stage.phase,
				actions: [
					h('span.cl-phase', { text: PHASES[stage.phase] || '' }),
					h('button.button-link', { type: 'button', text: '↑', title: 'Sposta su', onclick: function () { moveItem(state.stages, si, -1); } }),
					h('button.button-link', { type: 'button', text: '↓', title: 'Sposta giù', onclick: function () { moveItem(state.stages, si, 1); } }),
					h('button.button-link.cl-danger', { type: 'button', text: 'Elimina tappa', onclick: function () { removeItem(state.stages, si, 'la storia', 1); } })
				]
			}));
		});

		app.appendChild(h('button.button.button-primary', { type: 'button', text: '+ Aggiungi tappa (4 pagine)', onclick: function () {
			state.stages.push({ id: uid('tappa'), label: 'Nuova tappa', phase: 'peripezie', blocks: [newBlock()] });
			markDirty();
			rerenderTab();
		} }));
	}

	/* ---------- Ambientazioni ---------- */
	function tabSettings(app) {
		app.appendChild(h('div.cl-howto', {}, [h('p', { text: 'L\'ambientazione è la prima scelta del cliente dopo il bambino: decide la copertina, le pagine di rispetto (se carichi un\'immagine dedicata), i colori di riserva e i segnaposti di luogo usati nei testi, come {nel_luogo}.' })]));
		state.settings.forEach(function (s, i) {
			var ed = createEditor({
				units: 1,
				binding: 'left',
				sheet: function () { return { kind: 'cover_front' }; },
				sel: function () { return { setting: s.id, format: previewFormat().id, blocks: {} }; },
				target: function (key) { return s.cover[key]; }
			});
			var fields = h('div', {}, [
				fText('Nome dell\'ambientazione (lo vede il cliente)', s, 'label'),
				fText('Descrizione breve', s, 'description'),
				fMedia('Illustrazione della copertina (fronte)', s, 'cover_image', 'Quadrata, con abbondanza (o rimbocco per la copertina rigida).'),
				fMedia('Immagine delle pagine di rispetto (facoltativa)', s, 'rispetto_image', 'Doppia pagina 2:1. Se vuota si usano quelle generali di "Pagine fisse".'),
				fTokens(s.tokens, 'Ogni ambientazione dovrebbe avere gli stessi segnaposti (es. {luogo}, {nel_luogo}) così i testi funzionano con tutte.'),
				h('details.cl-fallback', {}, [
					h('summary', { text: 'Sfondo di riserva (solo quando manca un\'illustrazione)' }),
					h('div.cl-row', {}, [
						fColor('Cielo', s, 'bg_sky'),
						fColor('Terreno', s, 'bg_ground'),
						fSelect('Decorazione', s, 'bg_decor', { trees: 'Alberi', stars: 'Stelle', waves: 'Onde', none: 'Nessuna' })
					])
				])
			]);
			app.appendChild(card(s.label || 'Ambientazione', [h('div.cl-grid-preview', {}, [fields, h('div', {}, [h('p.cl-preview-label', { text: 'Copertina (fronte)' }), ed.root])])], {
				actions: [
					h('button.button-link', { type: 'button', text: '↑', onclick: function () { moveItem(state.settings, i, -1); } }),
					h('button.button-link', { type: 'button', text: '↓', onclick: function () { moveItem(state.settings, i, 1); } }),
					h('button.button-link.cl-danger', { type: 'button', text: 'Elimina', onclick: function () {
						removeItem(state.settings, i, 'il catalogo', 1);
						if (state.settings.indexOf(s) === -1) {
							// Togli l'ambientazione eliminata dai blocchi che la citavano
							state.stages.forEach(function (st) { st.blocks.forEach(function (b) { b.settings = b.settings.filter(function (id) { return id !== s.id; }); }); });
						}
					} })
				]
			}));
		});
		app.appendChild(h('button.button.button-primary', { type: 'button', text: '+ Aggiungi ambientazione', onclick: function () {
			var base = state.settings[0];
			var ns = {
				id: uid('amb'), label: 'Nuova ambientazione', description: '', cover_image: '', rispetto_image: '',
				bg_sky: '#E0F2FE', bg_ground: '#0369A1', bg_decor: 'none',
				tokens: {}, cover: base ? clone(base.cover) : {}
			};
			if (base) Object.keys(base.tokens).forEach(function (k) { ns.tokens[k] = ''; });
			state.settings.push(ns);
			normalize();
			markDirty();
			rerenderTab();
		} }));
	}

	/* ---------- Pagine fisse ---------- */
	function tabFixed(app) {
		var fp = state.fixed_pages;
		var selFn = function () { return { setting: previewSettingId(), format: previewFormat().id, blocks: {} }; };

		app.appendChild(card('Titolo del libro', [
			h('div.cl-grid-2', {}, [
				fText('Titolo', fp, 'title_template', { help: 'Usato in copertina e a pagina 1. Puoi usare i segnaposti, es. {nome}.' }),
				fText('Sottotitolo', fp, 'subtitle_template', { help: 'Es. Un\'avventura {nel_luogo}' })
			])
		]));

		var titleEd = createEditor({
			units: 1, binding: 'left',
			sheet: function () { return { kind: 'title', pages: [1], side: 'right' }; },
			sel: selFn,
			target: function (key) { return fp.title_page[key]; }
		});
		app.appendChild(card('Pagina 1 · titolo (pagina destra)', [h('div.cl-grid-preview', {}, [
			h('div', {}, [
				h('p', { text: 'La prima pagina del libro: il bambino creato dal cliente e il titolo su fondo bianco (o su un\'immagine tua).' }),
				fColor('Colore di fondo', fp.title_page, 'bg_color'),
				fMedia('Immagine di fondo (facoltativa)', fp.title_page, 'bg_image')
			]),
			titleEd.root
		])]));

		['start', 'end'].forEach(function (which) {
			var r = fp.rispetto[which];
			var n = E.innerPageCount(state);
			var pagesLabel = which === 'start' ? 'pag. 2-3' : 'pag. ' + (n - 2) + '-' + (n - 1);
			var ed = createEditor({
				units: 2, binding: 'center', editable: false,
				sheet: function () { return { kind: 'rispetto', which: which }; },
				sel: selFn,
				target: function () { return null; }
			});
			app.appendChild(card('Doppia pagina di rispetto ' + (which === 'start' ? 'iniziale' : 'finale') + ' · ' + pagesLabel, [h('div.cl-grid-preview.is-wide', {}, [
				h('div', {}, [
					fColor('Colore di fondo', r, 'bg_color'),
					fMedia('Immagine (doppia pagina 2:1)', r, 'bg_image', 'Vale per tutte le ambientazioni che non hanno un\'immagine di rispetto propria.')
				]),
				ed.root
			])]));
		});

		var brandEd = createEditor({
			units: 1, binding: 'right', editable: false,
			sheet: function () { return { kind: 'branding', pages: [E.innerPageCount(state)], side: 'left' }; },
			sel: selFn,
			target: function () { return null; }
		});
		app.appendChild(card('Ultima pagina · branding (pagina sinistra)', [h('div.cl-grid-preview', {}, [
			h('div', {}, [
				h('p', { text: 'La pagina con il tuo marchio, uguale in ogni libro. Carica un\'immagine quadrata con l\'abbondanza.' }),
				fMedia('Immagine della pagina di branding', fp.branding, 'bg_image'),
				fColor('Colore di fondo', fp.branding, 'bg_color')
			]),
			brandEd.root
		])]));

		var coverCanvas = h('canvas.cl-cover-canvas');
		coverCanvas.setAttribute('data-refresh', '1');
		coverCanvas._refresh = function () {
			var fmt = previewFormat();
			var g = E.coverGeometry(fmt);
			coverCanvas.width = 1000;
			coverCanvas.height = Math.round(1000 * g.H / g.W);
			E.renderCover(coverCanvas, state, selFn(), testChild, avatarImg(), { onAssetLoad: coverCanvas._refresh });
		};
		app.appendChild(card('Retro e dorso della copertina', [
			h('div.cl-row', {}, [
				fColor('Colore del retro', fp.back_cover, 'bg_color'),
				fColor('Colore del dorso', fp, 'spine_color')
			]),
			fMedia('Immagine del retro (facoltativa)', fp.back_cover, 'bg_image', 'Copre retro e rimbocco sinistro.'),
			h('p.cl-preview-label', { text: 'Copertina completa con il formato di anteprima (retro · dorso · fronte)' }),
			coverCanvas
		]));
	}

	/* ---------- Anteprima del libro ---------- */
	function tabBook(app) {
		var sel = ui.bookSel;
		sel.setting = sel.setting || previewSettingId();
		sel.format = sel.format || previewFormat().id;
		var controls = h('div.cl-book-controls');
		var grid = h('div.cl-book-grid');

		function selectFor(label, options, value, onChange) {
			var s = h('select');
			options.forEach(function (o) { s.appendChild(h('option', { value: o[0], text: o[1] })); });
			s.value = value;
			s.addEventListener('change', function () { onChange(s.value); });
			return h('label', {}, [h('span', { text: label }), s]);
		}

		function build() {
			controls.innerHTML = '';
			var r = E.resolveSelection(state, sel);
			sel.setting = r.setting ? r.setting.id : '';
			controls.appendChild(selectFor('Ambientazione', state.settings.map(function (s) { return [s.id, s.label]; }), sel.setting, function (v) { sel.setting = v; build(); }));
			state.stages.forEach(function (st, i) {
				var list = st.blocks.filter(function (b) { return E.blockAvailable(b, sel.setting); });
				var cur = r.blocks[st.id];
				controls.appendChild(selectFor((i + 1) + '. ' + (st.label || 'Tappa'), list.map(function (b) { return [b.id, b.label]; }), cur ? cur.id : '', function (v) { sel.blocks[st.id] = v; build(); }));
			});
			controls.appendChild(selectFor('Formato', state.formats.map(function (f) { return [f.id, f.label]; }), sel.format, function (v) { sel.format = v; build(); }));
			var pdf = h('button.button', { type: 'button', text: '⬇ Scarica PDF di prova (150 DPI)' });
			pdf.addEventListener('click', function () {
				pdf.disabled = true;
				pdf.textContent = 'Generazione in corso…';
				setTimeout(function () {
					E.exportPrintPDF(state, sel, testChild, { dpi: 150 }).then(function () {
						pdf.disabled = false;
						pdf.textContent = '⬇ Scarica PDF di prova (150 DPI)';
					});
				}, 30);
			});
			controls.appendChild(pdf);

			grid.innerHTML = '';
			E.bookSheets(state).forEach(function (sheet) {
				var thumb = bookThumb(sheet, sel, 560);
				var fig = h('figure.cl-book-sheet', {}, [
					h('button.cl-book-open', { type: 'button', title: 'Vai a modificare', onclick: function () { goTo(sheet, sel); } }, [thumb]),
					h('figcaption', { text: sheet.label })
				]);
				grid.appendChild(fig);
			});
			refreshAll();
		}
		app.appendChild(h('p', { text: 'Sfoglia il libro con una combinazione di scelte e il personaggio di prova. Clicca un foglio per andare a modificarlo.' }));
		app.appendChild(controls);
		app.appendChild(grid);
		build();
	}

	function goTo(sheet, sel) {
		if (sheet.kind === 'story') {
			var st = state.stages[sheet.stageIndex];
			var b = E.resolveSelection(state, sel).blocks[st.id];
			if (b) ui.open['block:' + b.id] = true;
			ui.previewSetting = sel.setting;
			showTab('storia');
			var el = document.querySelectorAll('.cl-card')[sheet.stageIndex];
			if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
		} else if (sheet.kind === 'cover') {
			ui.previewSetting = sel.setting;
			showTab('ambientazioni');
		} else {
			showTab('fisse');
		}
	}

	/* ---------- Formati ---------- */
	function tabFormats(app) {
		app.appendChild(h('div.cl-howto', {}, [
			h('p', { text: 'I formati tra cui sceglie il cliente, con il loro prezzo. Le misure vanno prese dal modello del prodotto scaricabile dalla dashboard di Gelato (Catalogo prodotti → formato → Download template): le dimensioni del catalogo Gelato non includono l\'abbondanza, i modelli sì.' }),
			h('p', { text: 'Le misure della copertina dipendono dal numero di pagine (il dorso cresce con lo spessore): se le lasci a 0 il plugin genera una copertina provvisoria senza dorso.' })
		]));
		state.formats.forEach(function (f, i) {
			var g = E.coverGeometry(f);
			app.appendChild(card(f.label || 'Formato', [
				h('div.cl-grid-2', {}, [
					h('div', {}, [
						fText('Nome (lo vede il cliente)', f, 'label'),
						fText('Descrizione breve', f, 'description'),
						h('div.cl-row', {}, [
							fNumber('Prezzo', f, 'price', { step: 0.5, min: 0 }),
							fNumber('Lato pagina rifilata (mm)', f, 'trim_mm', { step: 1, min: 50 }),
							fNumber('Abbondanza (mm)', f, 'bleed_mm', { step: 0.5, min: 0 })
						]),
						h('div.cl-row', {}, [
							fCheck('Disponibile per i clienti', f, 'enabled'),
							fCheck('Aggiungi le pagine bianche di risguardo al PDF (dopo la copertina e alla fine)', f, 'blank_endpapers')
						])
					]),
					h('div', {}, [
						fText('Product UID di Gelato', f, 'gelato_product_uid', { help: 'Servirà per inviare gli ordini a Gelato tramite API.' }),
						h('div.cl-row', {}, [
							fNumber('Copertina: larghezza totale (mm)', f.cover, 'width_mm', { step: 0.1, min: 0 }),
							fNumber('Copertina: altezza totale (mm)', f.cover, 'height_mm', { step: 0.1, min: 0 }),
							fNumber('Dorso (mm)', f.cover, 'spine_mm', { step: 0.1, min: 0 })
						]),
						g.provisional ? h('p.cl-error', { text: 'Misure della copertina non inserite: per ora la copertina è provvisoria (' + g.W.toFixed(1) + ' × ' + g.H.toFixed(1) + ' mm, senza dorso).' }) : h('p', { text: 'Copertina: ' + g.W + ' × ' + g.H + ' mm, rimbocco ' + g.wrapX.toFixed(1) + ' mm.' })
					])
				])
			], {
				actions: [h('button.button-link.cl-danger', { type: 'button', text: 'Elimina', onclick: function () { removeItem(state.formats, i, 'il catalogo', 1); } })]
			}));
		});
		app.appendChild(h('button.button.button-primary', { type: 'button', text: '+ Aggiungi formato', onclick: function () {
			state.formats.push({ id: uid('formato'), label: 'Nuovo formato', description: '', trim_mm: 200, bleed_mm: 3, price: 30, gelato_product_uid: '', enabled: false, blank_endpapers: true, cover: { width_mm: 0, height_mm: 0, spine_mm: 0 } });
			markDirty();
			rerenderTab();
		} }));
	}

	/* ---------- Personaggio: acconciature e palette ---------- */
	function tabCharacter(app) {
		var hairWrap = h('div.cl-hair-grid');
		state.hair_styles.forEach(function (hs, i) {
			var img = h('img', { alt: '' });
			var err = h('span.cl-hair-error', { text: 'SVG non valido', hidden: true });
			var thumb = h('button.cl-hair-thumb', { type: 'button', title: 'Prova sul personaggio', onclick: function () { testChild.hairStyle = hs.id; scheduleRefresh(); } }, [img, err]);
			thumb.setAttribute('data-refresh', '1');
			thumb._refresh = function () {
				var url = E.svgToDataUrl(E.buildAvatarSVGString(state, Object.assign({}, testChild, { hairStyle: hs.id })));
				if (img.getAttribute('src') !== url) {
					img.onload = function () { err.hidden = true; img.hidden = false; };
					img.onerror = function () { err.hidden = false; img.hidden = true; };
					img.src = url;
				}
				thumb.classList.toggle('is-active', testChild.hairStyle === hs.id);
			};
			hairWrap.appendChild(h('div.cl-hair-card', {}, [
				thumb,
				h('div', {}, [
					fText('Nome', hs, 'label'),
					fText('Tracciato SVG (tavola 1000×1000)', hs, 'svg', { rows: 4 }),
					h('button.button-link.cl-danger', { type: 'button', text: 'Elimina', onclick: function () { removeItem(state.hair_styles, i, 'il personaggio', 1); } })
				])
			]));
		});
		app.appendChild(card('Acconciature', [
			h('p', { html: 'Incolla i tracciati SVG esportati da Illustrator su una tavola 1000×1000. Usa <code>class="fill-hair"</code> sui tracciati che devono prendere il colore scelto dal cliente.' }),
			hairWrap,
			h('button.button', { type: 'button', text: '+ Aggiungi acconciatura', onclick: function () {
				state.hair_styles.push({ id: uid('capelli'), label: 'Nuova acconciatura', svg: '' });
				markDirty();
				rerenderTab();
			} })
		]));

		var palGrid = h('div.cl-pal-grid');
		[['skin', 'Carnagioni'], ['hair', 'Colori dei capelli'], ['eyes', 'Colori degli occhi'], ['shirt', 'Colori della maglietta']].forEach(function (p) {
			var list = state.palettes[p[0]];
			var rows = h('div');
			list.forEach(function (c, i) {
				rows.appendChild(h('div.cl-pal-row', {}, [
					(function () { var x = h('input', { type: 'color' }); x.value = c.hex; x.addEventListener('input', function () { c.hex = x.value; changed(); }); return x; })(),
					(function () { var x = h('input.widefat', { type: 'text' }); x.value = c.label; x.addEventListener('input', function () { c.label = x.value; changed(); }); return x; })(),
					h('button.button-link.cl-danger', { type: 'button', text: '✕', onclick: function () { removeItem(list, i, 'la palette', 1); } })
				]));
			});
			palGrid.appendChild(h('div.cl-pal-card', {}, [
				h('h4', { text: p[1] }),
				rows,
				h('button.button.button-small', { type: 'button', text: '+ Aggiungi colore', onclick: function () { list.push({ label: 'Nuovo colore', hex: '#3B82F6' }); markDirty(); rerenderTab(); } })
			]));
		});
		app.appendChild(card('Palette dei colori', [palGrid]));
	}

	/* =========================================================
	 * Pannello laterale
	 * ========================================================= */
	var sideRefs = {};

	function buildSide() {
		var side = $('#cl-side');
		var name = h('input', { type: 'text', maxlength: 22 });
		name.value = testChild.name;
		name.addEventListener('input', function () { testChild.name = name.value; scheduleRefresh(); });
		var gender = h('div.cl-seg', {}, [['M', 'Bambino'], ['F', 'Bambina']].map(function (g) {
			return h('button' + (testChild.gender === g[0] ? '.active' : ''), { type: 'button', text: g[1], 'data-v': g[0], onclick: function (e) {
				testChild.gender = g[0];
				Array.prototype.forEach.call(gender.children, function (b) { b.classList.toggle('active', b === e.currentTarget); });
				scheduleRefresh();
			} });
		}));
		var glasses = h('input', { type: 'checkbox' });
		glasses.addEventListener('change', function () { testChild.glasses = glasses.checked ? 'round' : 'none'; scheduleRefresh(); });
		var guides = h('input', { type: 'checkbox', checked: true });
		guides.addEventListener('change', function () { ui.showGuides = guides.checked; scheduleRefresh(); });

		sideRefs.hair = h('select');
		sideRefs.hair.addEventListener('change', function () { testChild.hairStyle = sideRefs.hair.value; scheduleRefresh(); });
		sideRefs.swatches = {};
		sideRefs.format = h('select');
		sideRefs.format.addEventListener('change', function () { ui.previewFormat = sideRefs.format.value; scheduleRefresh(); });
		sideRefs.setting = h('select');
		sideRefs.setting.addEventListener('change', function () { ui.previewSetting = sideRefs.setting.value; scheduleRefresh(); });
		sideRefs.pages = h('p.cl-pages');

		var save = h('button.button.button-primary.button-large.cl-save', { type: 'button', text: '💾 Salva il catalogo', onclick: function () {
			$('#cl-catalog-json').value = JSON.stringify(state);
			dirty = false;
			$('#cl-save-form').submit();
		} });

		var swatchRow = function (label, key) {
			var w = h('div.cl-swatches');
			sideRefs.swatches[key] = w;
			return h('div.cl-side-row', {}, [h('span.cl-side-label', { text: label }), w]);
		};

		side.appendChild(h('div.cl-side-card', {}, [
			h('h2', { text: 'Personaggio di prova' }),
			h('p.cl-muted', { text: 'Solo per le anteprime: non viene salvato.' }),
			h('div.cl-side-avatar', {}, [h('img', { id: 'cl-test-avatar', alt: '' })]),
			h('div.cl-side-row', {}, [h('span.cl-side-label', { text: 'Nome' }), name]),
			h('div.cl-side-row', {}, [h('span.cl-side-label', { text: 'Sesso' }), gender]),
			h('div.cl-side-row', {}, [h('span.cl-side-label', { text: 'Acconciatura' }), sideRefs.hair]),
			swatchRow('Carnagione', 'skinColor'),
			swatchRow('Capelli', 'hairColor'),
			swatchRow('Occhi', 'eyeColor'),
			swatchRow('Maglietta', 'shirtColor'),
			h('label.cl-check', {}, [glasses, ' Occhiali tondi']),
			h('hr'),
			h('div.cl-side-row', {}, [h('span.cl-side-label', { text: 'Formato di anteprima' }), sideRefs.format]),
			h('div.cl-side-row', {}, [h('span.cl-side-label', { text: 'Ambientazione di prova' }), sideRefs.setting]),
			h('label.cl-check', {}, [guides, ' Mostra taglio, margini e piega']),
			sideRefs.pages,
			save,
			h('p.cl-dirty', { id: 'cl-dirty', hidden: true, text: 'Hai modifiche non salvate.' })
		]));
	}

	function fillSelect(sel, items, value) {
		var sig = items.map(function (i) { return i[0] + ':' + i[1]; }).join('|');
		if (sel._sig !== sig) {
			sel.innerHTML = '';
			items.forEach(function (i) { sel.appendChild(h('option', { value: i[0], text: i[1] })); });
			sel._sig = sig;
		}
		sel.value = value;
	}

	function syncSide() {
		syncTestChild();
		fillSelect(sideRefs.hair, state.hair_styles.map(function (x) { return [x.id, x.label]; }), testChild.hairStyle);
		var fmt = previewFormat();
		fillSelect(sideRefs.format, state.formats.map(function (f) { return [f.id, f.label]; }), fmt.id);
		fillSelect(sideRefs.setting, state.settings.map(function (s) { return [s.id, s.label]; }), previewSettingId());
		[['skinColor', 'skin'], ['hairColor', 'hair'], ['eyeColor', 'eyes'], ['shirtColor', 'shirt']].forEach(function (p) {
			var w = sideRefs.swatches[p[0]];
			w.innerHTML = '';
			state.palettes[p[1]].forEach(function (c, i) {
				w.appendChild(h('button.cl-sw' + (i === palIdx[p[0]] ? '.active' : ''), { type: 'button', title: c.label, style: 'background:' + c.hex, onclick: function () { palIdx[p[0]] = i; scheduleRefresh(); } }));
			});
		});
		var n = E.innerPageCount(state);
		sideRefs.pages.textContent = 'Libro: ' + n + ' pagine interne' + (n < 30 ? ' (Gelato ne richiede almeno 30)' : '');
		sideRefs.pages.classList.toggle('cl-error', n < 30);
	}

	/* =========================================================
	 * Avvio
	 * ========================================================= */
	function init() {
		if (!$('#cl-app')) return;
		normalize();
		buildSide();
		window.addEventListener('beforeunload', function (e) {
			if (!dirty) return;
			e.preventDefault();
			e.returnValue = '';
		});
		showTab('storia');
	}

	if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
	else init();
})();
