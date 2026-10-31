/**
 * CreaLibro — motore di rendering condiviso.
 *
 * Lo stesso codice disegna il libro nel configuratore del cliente, nel pannello admin
 * e nel PDF di stampa. Le funzioni pubbliche sono in window.CreaLibroEngine.
 *
 * Struttura del libro (con 6 tappe da 4 pagine = 30 pagine interne):
 *   copertina (fronte + dorso + retro)
 *   pag. 1        pagina singola (destra): titolo con il bambino
 *   pag. 2-3      doppia pagina di rispetto
 *   pag. 4-27     storia: ogni tappa = un blocco scelto dal cliente = 2 doppie pagine
 *   pag. 28-29    doppia pagina di rispetto
 *   pag. 30       pagina singola (sinistra): pagina finale / branding
 *
 * Coordinate: x e y sono in % della superficie rifilata (pagina o doppia pagina, senza
 * abbondanza); la scala degli elementi è relativa all'altezza della pagina rifilata,
 * così la stessa impaginazione vale per tutti i formati quadrati.
 */
(function () {
	'use strict';

	var BASE_FONT = 0.032;   // altezza del carattere del testo / altezza della pagina
	var LINE_HEIGHT = 1.42;
	var FONT_FAMILY = 'Georgia, "Times New Roman", serif';

	var PHASES = [
		{ id: 'equilibrio', label: 'Equilibrio iniziale' },
		{ id: 'rottura', label: 'Rottura dell\'equilibrio' },
		{ id: 'peripezie', label: 'Peripezie dell\'eroe' },
		{ id: 'ristabilimento', label: 'Ristabilimento dell\'equilibrio' }
	];

	var DEFAULT_SLOTS = {
		avatar: { x: 28, y: 56, scale: 0.6, rotation: 0 },
		npc: { x: 72, y: 54, scale: 0.55, rotation: 0 },
		prop: { x: 42, y: 60, scale: 0.2, rotation: 0 },
		text: { x: 75, y: 16, w: 40, size: 1, align: 'left', panel: true },
		text2: { x: 25, y: 16, w: 40, size: 1, align: 'left', panel: true },
		cover_avatar: { x: 50, y: 62, scale: 0.62, rotation: 0 },
		cover_title: { x: 50, y: 15, w: 86, size: 1.7, align: 'center', panel: true },
		cover_subtitle: { x: 50, y: 31, w: 80, size: 1, align: 'center', panel: false },
		title_avatar: { x: 50, y: 62, scale: 0.5, rotation: 0 },
		title_title: { x: 50, y: 16, w: 84, size: 2, align: 'center', panel: false },
		title_subtitle: { x: 50, y: 27, w: 80, size: 1, align: 'center', panel: false }
	};

	/* =========================================================
	 * 0. IMMAGINI ESTERNE
	 * ========================================================= */
	var mediaCache = {};

	function cleanUrl(url) {
		return (typeof url === 'string') ? url.trim() : '';
	}

	/** Restituisce l'immagine se pronta; altrimenti la scarica e chiama onLoad a download finito (o fallito). */
	function requestImage(url, onLoad) {
		var u = cleanUrl(url);
		if (!u) return null;
		var entry = mediaCache[u];
		if (!entry) {
			entry = mediaCache[u] = { img: new Image(), status: 'loading', listeners: [] };
			entry.img.crossOrigin = 'anonymous';
			var notify = function (status) {
				entry.status = status;
				var list = entry.listeners;
				entry.listeners = [];
				list.forEach(function (fn) { try { fn(); } catch (e) { /* ignora */ } });
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
			var done = function () { resolve(mediaCache[u].status === 'ok' ? mediaCache[u].img : null); };
			var img = requestImage(u, done);
			if (img) { resolve(img); return; }
			if (mediaCache[u].status === 'error') resolve(null);
		});
	}

	/* =========================================================
	 * 1. AVATAR (SVG → PNG trasparente 1000x1000)
	 * ========================================================= */
	function buildAvatarSVGString(cat, child) {
		var styles = (cat && cat.hair_styles) || [];
		var hairObj = styles.find(function (h) { return h.id === child.hairStyle; }) || styles[0];
		var hairMarkup = hairObj && hairObj.svg
			? String(hairObj.svg).replace(/class="fill-hair"/g, 'fill="' + child.hairColor + '"')
			: '';
		var glassesMarkup = child.glasses === 'round'
			? '<g stroke="#1E293B" stroke-width="14" fill="rgba(255,255,255,0.25)"><circle cx="420" cy="395" r="52"/><circle cx="580" cy="395" r="52"/><line x1="472" y1="395" x2="528" y2="395"/></g>'
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
			'<circle cx="420" cy="390" r="26" fill="#FFFFFF"/><circle cx="580" cy="390" r="26" fill="#FFFFFF"/>' +
			'<circle cx="420" cy="390" r="16" fill="' + child.eyeColor + '"/><circle cx="580" cy="390" r="16" fill="' + child.eyeColor + '"/>' +
			'<circle cx="426" cy="384" r="6" fill="#FFFFFF"/><circle cx="586" cy="384" r="6" fill="#FFFFFF"/>' +
			'<path d="M488,415 Q500,428 512,415" stroke="rgba(0,0,0,0.35)" stroke-width="7" stroke-linecap="round" fill="none"/>' +
			'<path d="M445,462 Q500,508 555,462" stroke="#881337" stroke-width="11" stroke-linecap="round" fill="none"/>' +
			glassesMarkup + hairMarkup +
		'</svg>';
	}

	function svgToDataUrl(svg) {
		return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
	}

	function bakeAvatarPNG(cat, child) {
		return new Promise(function (resolve) {
			var img = new Image();
			img.onload = function () {
				var off = document.createElement('canvas');
				off.width = 1000;
				off.height = 1000;
				off.getContext('2d').drawImage(img, 0, 0, 1000, 1000);
				var url = off.toDataURL('image/png');
				var baked = new Image();
				baked.onload = function () { resolve({ imgElement: baked, dataUrl: url, error: false }); };
				baked.src = url;
			};
			img.onerror = function () { resolve({ imgElement: null, dataUrl: '', error: true }); };
			img.src = svgToDataUrl(buildAvatarSVGString(cat, child));
		});
	}

	/* =========================================================
	 * 2. STRUTTURA DEL LIBRO E SCELTE DEL CLIENTE
	 * ========================================================= */
	function stages(cat) {
		return (cat && Array.isArray(cat.stages)) ? cat.stages : [];
	}

	function innerPageCount(cat) {
		return 6 + 4 * stages(cat).length;
	}

	function bookSheets(cat) {
		var out = [{ kind: 'cover', label: 'Copertina' }];
		out.push({ kind: 'title', pages: [1], side: 'right', label: 'Pag. 1 · Titolo' });
		var p = 2;
		out.push({ kind: 'rispetto', which: 'start', pages: [p, p + 1], label: 'Pag. ' + p + '-' + (p + 1) + ' · Rispetto' });
		p += 2;
		stages(cat).forEach(function (st, si) {
			for (var k = 0; k < 2; k++) {
				out.push({ kind: 'story', stageIndex: si, stageId: st.id, spread: k, pages: [p, p + 1], label: 'Pag. ' + p + '-' + (p + 1) + ' · ' + (st.label || ('Tappa ' + (si + 1))) });
				p += 2;
			}
		});
		out.push({ kind: 'rispetto', which: 'end', pages: [p, p + 1], label: 'Pag. ' + p + '-' + (p + 1) + ' · Rispetto' });
		p += 2;
		out.push({ kind: 'branding', pages: [p], side: 'left', label: 'Pag. ' + p + ' · Pagina finale' });
		return out;
	}

	function sheetUnits(sheet) {
		return (sheet.kind === 'rispetto' || sheet.kind === 'story') ? 2 : 1;
	}

	function blockAvailable(block, settingId) {
		return !block.settings || !block.settings.length || block.settings.indexOf(settingId) !== -1;
	}

	function getFormat(cat, id) {
		var list = (cat && cat.formats) || [];
		return list.find(function (f) { return f.id === id; }) || list.find(function (f) { return f.enabled !== false; }) || list[0] || null;
	}

	/** Completa una selezione parziale con valori validi (prima opzione disponibile). */
	function resolveSelection(cat, sel) {
		sel = sel || {};
		var settings = cat.settings || [];
		var setting = settings.find(function (s) { return s.id === sel.setting; }) || settings[0] || null;
		var sid = setting ? setting.id : '';
		var blocks = {};
		stages(cat).forEach(function (st) {
			var list = (st.blocks || []).filter(function (b) { return blockAvailable(b, sid); });
			var wanted = sel.blocks ? sel.blocks[st.id] : null;
			blocks[st.id] = list.find(function (b) { return b.id === wanted; }) || list[0] || (st.blocks || [])[0] || null;
		});
		var fmt = getFormat(cat, sel.format);
		return { setting: setting, blocks: blocks, format: fmt };
	}

	function selectionIds(cat, sel) {
		var r = resolveSelection(cat, sel);
		var ids = { setting: r.setting ? r.setting.id : '', format: r.format ? r.format.id : '', blocks: {} };
		Object.keys(r.blocks).forEach(function (k) { ids.blocks[k] = r.blocks[k] ? r.blocks[k].id : ''; });
		return ids;
	}

	function genderTokens(child) {
		var f = child.gender === 'F';
		return {
			nome: (child.name && child.name.trim()) ? child.name.trim() : 'Giorgio',
			o_a: f ? 'a' : 'o',
			il_la: f ? 'la' : 'il',
			lo_la: f ? 'la' : 'lo',
			un_una: f ? 'una' : 'un',
			lui_lei: f ? 'lei' : 'lui',
			e_trice: f ? 'trice' : 'e',
			e_ina: f ? 'ina' : 'e'
		};
	}

	function tokenDictionary(cat, sel, child) {
		var r = resolveSelection(cat, sel);
		var dict = {};
		if (r.setting) Object.assign(dict, r.setting.tokens || {});
		stages(cat).forEach(function (st) {
			var b = r.blocks[st.id];
			if (b) Object.assign(dict, b.tokens || {});
		});
		return Object.assign(dict, genderTokens(child));
	}

	function resolveTokens(template, dict) {
		var out = String(template || '');
		for (var pass = 0; pass < 3; pass++) {
			out = out.replace(/\{([a-zA-Z0-9_]+)\}/g, function (m, key) {
				return typeof dict[key] !== 'undefined' ? dict[key] : m;
			});
		}
		return out;
	}

	/** Segnaposto rimasti senza valore in un testo già risolto. */
	function unresolvedTokens(text) {
		var found = [];
		String(text || '').replace(/\{([a-zA-Z0-9_]+)\}/g, function (m) {
			if (found.indexOf(m) === -1) found.push(m);
			return m;
		});
		return found;
	}

	/** Oggetto della storia visibile alla tappa indicata: l'ultimo blocco (fino a quella tappa) che ne definisce uno. */
	function currentProp(cat, r, stageIndex) {
		var list = stages(cat);
		for (var i = Math.min(stageIndex, list.length - 1); i >= 0; i--) {
			var b = r.blocks[list[i].id];
			if (b && cleanUrl(b.prop_image)) return { url: cleanUrl(b.prop_image), block: b };
		}
		return null;
	}

	function num(v, d) {
		var n = parseFloat(v);
		return isFinite(n) ? n : d;
	}

	function slotWithDefaults(slot, key) {
		var d = DEFAULT_SLOTS[key] || DEFAULT_SLOTS.avatar;
		var s = slot || {};
		var out = {};
		Object.keys(d).forEach(function (k) {
			if (typeof d[k] === 'number') out[k] = num(s[k], d[k]);
			else if (typeof d[k] === 'boolean') out[k] = typeof s[k] === 'boolean' ? s[k] : d[k];
			else out[k] = s[k] || d[k];
		});
		return out;
	}

	/* =========================================================
	 * 3. IMPAGINAZIONE DI UN FOGLIO (pagina singola, doppia pagina o fronte di copertina)
	 * ========================================================= */
	function fallbackBg(setting) {
		return {
			sky: (setting && setting.bg_sky) || '#DCFCE7',
			ground: (setting && setting.bg_ground) || '#15803D',
			decor: (setting && setting.bg_decor) || 'trees'
		};
	}

	/**
	 * Descrive cosa contiene un foglio. Gli elementi hanno: type (avatar/npc/prop/text),
	 * key (chiave della posizione nei dati), slot e, per i testi, il testo già risolto.
	 */
	function computeSheetLayout(cat, sheet, sel, child) {
		var r = resolveSelection(cat, sel);
		var fixed = cat.fixed_pages || {};
		var dict = tokenDictionary(cat, sel, child);
		var setting = r.setting;
		var L = { sheet: sheet, units: sheetUnits(sheet), bg: { image: '', color: '', fallback: null }, elements: [], source: null };

		function text(key, template, slot, style, slotKey) {
			var t = resolveTokens(template, dict);
			L.elements.push({ type: 'text', key: key, slot: slotWithDefaults(slot, slotKey || key), text: t, style: style || 'body' });
		}

		if (sheet.kind === 'cover' || sheet.kind === 'cover_front') {
			var cv = (setting && setting.cover) || {};
			L.source = setting;
			L.bg.image = cleanUrl(setting && setting.cover_image);
			L.bg.fallback = fallbackBg(setting);
			L.elements.push({ type: 'avatar', key: 'avatar', slot: slotWithDefaults(cv.avatar, 'cover_avatar') });
			text('title', fixed.title_template, cv.title, 'title', 'cover_title');
			text('subtitle', fixed.subtitle_template, cv.subtitle, 'subtitle', 'cover_subtitle');
		} else if (sheet.kind === 'title') {
			var tp = fixed.title_page || {};
			L.source = tp;
			L.bg.image = cleanUrl(tp.bg_image);
			L.bg.color = tp.bg_color || '#FFFFFF';
			L.elements.push({ type: 'avatar', key: 'avatar', slot: slotWithDefaults(tp.avatar, 'title_avatar') });
			text('title', fixed.title_template, tp.title, 'title', 'title_title');
			text('subtitle', fixed.subtitle_template, tp.subtitle, 'subtitle', 'title_subtitle');
		} else if (sheet.kind === 'rispetto') {
			var rp = (fixed.rispetto && fixed.rispetto[sheet.which]) || {};
			L.bg.image = cleanUrl(setting && setting.rispetto_image) || cleanUrl(rp.bg_image);
			L.bg.color = rp.bg_color || '#F1F5F9';
		} else if (sheet.kind === 'branding') {
			var br = fixed.branding || {};
			L.bg.image = cleanUrl(br.bg_image);
			L.bg.color = br.bg_color || '#FFFFFF';
		} else if (sheet.kind === 'story') {
			var st = stages(cat)[sheet.stageIndex];
			var block = st ? r.blocks[st.id] : null;
			var spread = block && block.spreads ? block.spreads[sheet.spread] : null;
			L.source = spread;
			L.block = block;
			if (spread) {
				var els = spread.elements || {};
				L.bg.image = cleanUrl(spread.bg_image);
				L.bg.fallback = fallbackBg(setting);
				if (els.npc && els.npc.show) {
					L.elements.push({ type: 'npc', key: 'npc', slot: slotWithDefaults(els.npc, 'npc'), imageUrl: cleanUrl(spread.npc_image) });
				}
				if (!els.avatar || els.avatar.show !== false) {
					L.elements.push({ type: 'avatar', key: 'avatar', slot: slotWithDefaults(els.avatar, 'avatar') });
				}
				if (els.prop && els.prop.show) {
					var prop = currentProp(cat, r, sheet.stageIndex);
					L.elements.push({ type: 'prop', key: 'prop', slot: slotWithDefaults(els.prop, 'prop'), imageUrl: prop ? prop.url : '' });
				}
				(spread.texts || []).forEach(function (t, i) {
					if (!t || t.show === false || !String(t.text || '').trim()) return;
					text('text' + i, t.text, t, 'body', i === 0 ? 'text' : 'text2');
				});
			} else {
				L.bg.fallback = fallbackBg(setting);
			}
		}
		return L;
	}

	/* =========================================================
	 * 4. DISEGNO
	 * ========================================================= */
	function drawImageCover(ctx, img, x, y, w, h) {
		var iw = img.naturalWidth || img.width;
		var ih = img.naturalHeight || img.height;
		if (!iw || !ih) return;
		var s = Math.max(w / iw, h / ih);
		var dw = iw * s;
		var dh = ih * s;
		ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
	}

	function containSize(img, box) {
		var iw = img.naturalWidth || img.width;
		var ih = img.naturalHeight || img.height;
		if (!iw || !ih) return { w: box, h: box };
		var r = Math.min(box / iw, box / ih);
		return { w: iw * r, h: ih * r };
	}

	function drawFallbackLandscape(ctx, x, y, w, h, fb) {
		ctx.fillStyle = fb.sky;
		ctx.fillRect(x, y, w, h);
		ctx.save();
		if (fb.decor === 'stars') {
			ctx.fillStyle = 'rgba(255,255,255,0.75)';
			for (var i = 0; i < 12; i++) {
				ctx.beginPath();
				ctx.arc(x + w * ((i * 0.37 + 0.11) % 1), y + h * (0.08 + ((i * 0.53) % 0.38)), (i % 2 + 1) * h * 0.006, 0, Math.PI * 2);
				ctx.fill();
			}
		} else if (fb.decor === 'trees') {
			ctx.fillStyle = fb.ground;
			ctx.globalAlpha = 0.35;
			var n = Math.max(3, Math.round(w / h * 3));
			for (var t = 0; t < n; t++) {
				ctx.beginPath();
				ctx.arc(x + w * ((t + 0.5) / n), y + h * (0.5 + (t % 2) * 0.05), h * (0.1 + (t % 3) * 0.02), 0, Math.PI * 2);
				ctx.fill();
			}
		} else if (fb.decor === 'waves') {
			ctx.strokeStyle = 'rgba(255,255,255,0.55)';
			ctx.lineWidth = h * 0.01;
			ctx.beginPath();
			ctx.arc(x + w * 0.85, y + h * 0.2, h * 0.08, 0, Math.PI * 2);
			ctx.stroke();
		}
		ctx.restore();
		ctx.fillStyle = fb.ground;
		ctx.beginPath();
		ctx.moveTo(x, y + h * 0.64);
		ctx.quadraticCurveTo(x + w * 0.5, y + h * 0.56, x + w, y + h * 0.65);
		ctx.lineTo(x + w, y + h);
		ctx.lineTo(x, y + h);
		ctx.closePath();
		ctx.fill();
	}

	function drawPropPlaceholder(ctx, size) {
		ctx.fillStyle = 'rgba(255,255,255,0.5)';
		ctx.beginPath();
		ctx.arc(0, 0, size * 0.5, 0, Math.PI * 2);
		ctx.fill();
		ctx.fillStyle = '#FACC15';
		ctx.strokeStyle = '#1E293B';
		ctx.lineWidth = size * 0.05;
		ctx.beginPath();
		ctx.arc(0, 0, size * 0.3, 0, Math.PI * 2);
		ctx.fill();
		ctx.stroke();
	}

	function drawNpcPlaceholder(ctx, size) {
		ctx.fillStyle = '#D97706';
		ctx.beginPath();
		ctx.arc(0, 0, size * 0.25, 0, Math.PI * 2);
		ctx.fill();
		ctx.fillStyle = '#FFFFFF';
		ctx.beginPath();
		ctx.arc(-size * 0.08, -size * 0.04, size * 0.05, 0, Math.PI * 2);
		ctx.arc(size * 0.08, -size * 0.04, size * 0.05, 0, Math.PI * 2);
		ctx.fill();
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

	function fontFor(style, px) {
		if (style === 'title') return 'bold ' + px + 'px ' + FONT_FAMILY;
		if (style === 'subtitle') return 'italic ' + px + 'px ' + FONT_FAMILY;
		return px + 'px ' + FONT_FAMILY;
	}

	function wrapLines(ctx, text, maxWidth) {
		var lines = [];
		String(text || '').split(/\n/).forEach(function (para) {
			var words = para.split(/\s+/).filter(Boolean);
			var line = '';
			words.forEach(function (w) {
				var test = line ? line + ' ' + w : w;
				if (line && ctx.measureText(test).width > maxWidth) {
					lines.push(line);
					line = w;
				} else {
					line = test;
				}
			});
			lines.push(line);
		});
		return lines;
	}

	/** Disegna un riquadro di testo centrato in (x,y) e ne restituisce l'ingombro. */
	function drawTextBox(ctx, el, trim, scaleFactor, draw) {
		var s = el.slot;
		var px = Math.max(4, Math.round(BASE_FONT * s.size * trim.h * (scaleFactor || 1)));
		var pad = s.panel ? px * 0.7 : px * 0.15;
		var boxW = (s.w / 100) * trim.w;
		ctx.font = fontFor(el.style, px);
		var lines = wrapLines(ctx, el.text, Math.max(10, boxW - 2 * pad));
		var lh = px * LINE_HEIGHT;
		var boxH = lines.length * lh + 2 * pad - (lh - px) * 0.5;
		var cx = trim.x + (s.x / 100) * trim.w;
		var cy = trim.y + (s.y / 100) * trim.h;
		var x0 = cx - boxW / 2;
		var y0 = cy - boxH / 2;

		if (draw) {
			if (s.panel) {
				ctx.fillStyle = 'rgba(255,255,255,0.92)';
				roundRect(ctx, x0, y0, boxW, boxH, px * 0.6);
				ctx.fill();
			}
			ctx.fillStyle = el.style === 'subtitle' ? '#475569' : '#1E293B';
			ctx.textBaseline = 'alphabetic';
			var tx = s.align === 'center' ? cx : (s.align === 'right' ? x0 + boxW - pad : x0 + pad);
			ctx.textAlign = s.align === 'center' ? 'center' : (s.align === 'right' ? 'right' : 'left');
			lines.forEach(function (ln, i) {
				ctx.fillText(ln, tx, y0 + pad + px * 0.85 + i * lh);
			});
		}
		return { cx: cx, cy: cy, w: boxW, h: boxH, lines: lines.length };
	}

	/**
	 * Disegna un foglio.
	 * opts.trim     rettangolo rifilato in px sul canvas (default: tutto il canvas)
	 * opts.bleedPx  abbondanza in px attorno al rifilo, coperta dallo sfondo
	 * opts.onAssetLoad, opts.clear (default true)
	 * Restituisce il layout con le coordinate in px di ogni elemento.
	 */
	function renderSheet(canvas, cat, sheet, sel, child, bakedAvatar, opts) {
		opts = opts || {};
		var ctx = canvas.getContext('2d');
		var trim = opts.trim || { x: 0, y: 0, w: canvas.width, h: canvas.height };
		var bleed = opts.bleedPx || 0;
		if (opts.clear !== false) ctx.clearRect(0, 0, canvas.width, canvas.height);

		var L = computeSheetLayout(cat, sheet, sel, child);
		L.trim = trim;
		L.bleedPx = bleed;
		var rerender = opts.onAssetLoad || function () { renderSheet(canvas, cat, sheet, sel, child, bakedAvatar, opts); };

		var bx = trim.x - bleed, by = trim.y - bleed, bw = trim.w + 2 * bleed, bh = trim.h + 2 * bleed;
		ctx.save();
		ctx.beginPath();
		ctx.rect(bx, by, bw, bh);
		ctx.clip();

		var bg = requestImage(L.bg.image, rerender);
		L.bgLoaded = !!bg;
		if (bg) {
			drawImageCover(ctx, bg, bx, by, bw, bh);
		} else if (L.bg.fallback) {
			drawFallbackLandscape(ctx, bx, by, bw, bh, L.bg.fallback);
		} else {
			ctx.fillStyle = L.bg.color || '#FFFFFF';
			ctx.fillRect(bx, by, bw, bh);
		}

		var pageH = trim.h;
		L.elements.forEach(function (el) {
			if (el.type === 'text') {
				var box = drawTextBox(ctx, el, { x: trim.x, y: trim.y, w: trim.w, h: pageH }, 1, true);
				el.cx = box.cx; el.cy = box.cy; el.w = box.w; el.h = box.h; el.lines = box.lines;
				el.rotation = 0; el.drawn = true;
				return;
			}
			el.cx = trim.x + (el.slot.x / 100) * trim.w;
			el.cy = trim.y + (el.slot.y / 100) * trim.h;
			el.size = el.slot.scale * pageH;
			el.rotation = el.slot.rotation;
			el.w = el.h = el.size;
			el.drawn = false;
			el.usesFallback = false;

			var img = el.type === 'avatar' ? bakedAvatar : requestImage(el.imageUrl, rerender);
			ctx.save();
			ctx.translate(el.cx, el.cy);
			if (el.rotation) ctx.rotate((el.rotation * Math.PI) / 180);
			if (img) {
				var fit = containSize(img, el.size);
				el.w = fit.w; el.h = fit.h;
				ctx.drawImage(img, -fit.w / 2, -fit.h / 2, fit.w, fit.h);
				el.drawn = true;
			} else if (el.type === 'prop' && opts.placeholders) {
				drawPropPlaceholder(ctx, el.size);
				el.usesFallback = true;
			} else if (el.type === 'npc' && !bg && opts.placeholders) {
				drawNpcPlaceholder(ctx, el.size);
				el.usesFallback = true;
			}
			ctx.restore();
		});

		ctx.restore();
		return L;
	}

	/** Copertina completa per la stampa: retro | dorso | fronte, con abbondanza o rimbocco. */
	function coverGeometry(fmt) {
		var T = num(fmt.trim_mm, 200);
		var b = num(fmt.bleed_mm, 3);
		var c = fmt.cover || {};
		var spine = num(c.spine_mm, 0);
		var W = num(c.width_mm, 0) || (2 * T + spine + 2 * b);
		var H = num(c.height_mm, 0) || (T + 2 * b);
		return {
			T: T, W: W, H: H, spine: spine,
			wrapX: (W - 2 * T - spine) / 2,
			wrapY: (H - T) / 2,
			provisional: !(num(c.width_mm, 0) && num(c.height_mm, 0))
		};
	}

	function renderCover(canvas, cat, sel, child, bakedAvatar, opts) {
		opts = opts || {};
		var r = resolveSelection(cat, sel);
		var g = coverGeometry(r.format || {});
		var k = canvas.width / g.W; // px per mm
		var ctx = canvas.getContext('2d');
		var fixed = cat.fixed_pages || {};
		var rerender = opts.onAssetLoad || function () { renderCover(canvas, cat, sel, child, bakedAvatar, opts); };
		ctx.clearRect(0, 0, canvas.width, canvas.height);

		// Retro (rimbocco/abbondanza a sinistra compreso)
		var backW = (g.wrapX + g.T) * k;
		var back = fixed.back_cover || {};
		var backImg = requestImage(back.bg_image, rerender);
		ctx.fillStyle = back.bg_color || '#1E293B';
		ctx.fillRect(0, 0, backW, canvas.height);
		if (backImg) drawImageCover(ctx, backImg, 0, 0, backW, canvas.height);

		// Dorso
		var spineX = backW;
		ctx.fillStyle = fixed.spine_color || back.bg_color || '#1E293B';
		ctx.fillRect(spineX, 0, g.spine * k, canvas.height);

		// Fronte
		var frontX = spineX + g.spine * k;
		var frontW = canvas.width - frontX;
		ctx.save();
		ctx.beginPath();
		ctx.rect(frontX, 0, frontW, canvas.height);
		ctx.clip();
		var trim = { x: frontX, y: g.wrapY * k, w: g.T * k, h: g.T * k };
		var frontOpts = { trim: trim, bleedPx: Math.max(g.wrapX, g.wrapY) * k, clear: false, onAssetLoad: rerender };
		var L = renderSheet(canvas, cat, { kind: 'cover_front' }, sel, child, bakedAvatar, frontOpts);
		ctx.restore();
		return { layout: L, geometry: g };
	}

	/* =========================================================
	 * 5. PDF (pagine singole, come richiesto da Gelato)
	 * ========================================================= */
	function buildPdf(pages) {
		var chunks = [];
		var offsets = [];
		var byteLength = 0;
		var encoder = new TextEncoder();
		var mm = function (v) { return (v * 72 / 25.4).toFixed(2); };

		function pushStr(str) { var b = encoder.encode(str); chunks.push(b); byteLength += b.length; }
		function pushBin(u8) { chunks.push(u8); byteLength += u8.length; }
		function startObj(id) { offsets[id] = byteLength; pushStr(id + ' 0 obj\n'); }

		pushStr('%PDF-1.4\n%\xFF\xFF\xFF\xFF\n');
		var kids = pages.map(function (p, i) { return 3 + i * 3; });
		startObj(1);
		pushStr('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
		startObj(2);
		pushStr('<< /Type /Pages /Kids [' + kids.map(function (id) { return id + ' 0 R'; }).join(' ') + '] /Count ' + pages.length + ' >>\nendobj\n');

		pages.forEach(function (page, idx) {
			var pageId = 3 + idx * 3, contentId = pageId + 1, imgId = pageId + 2;
			var w = mm(page.widthMm), h = mm(page.heightMm);
			var trimBox = '';
			if (page.trimMm) {
				var t = page.trimMm;
				trimBox = ' /TrimBox [' + mm(t) + ' ' + mm(t) + ' ' + mm(page.widthMm - t) + ' ' + mm(page.heightMm - t) + ']';
			}
			var res = page.jpeg ? ' /Resources << /XObject << /Im' + idx + ' ' + imgId + ' 0 R >> >>' : ' /Resources << >>';
			startObj(pageId);
			pushStr('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + w + ' ' + h + ']' + trimBox + res + ' /Contents ' + contentId + ' 0 R >>\nendobj\n');

			var cmd = page.jpeg ? 'q ' + w + ' 0 0 ' + h + ' 0 0 cm /Im' + idx + ' Do Q' : '';
			startObj(contentId);
			pushStr('<< /Length ' + cmd.length + ' >>\nstream\n' + cmd + '\nendstream\nendobj\n');

			startObj(imgId);
			if (page.jpeg) {
				pushStr('<< /Type /XObject /Subtype /Image /Width ' + page.pxW + ' /Height ' + page.pxH + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + page.jpeg.length + ' >>\nstream\n');
				pushBin(page.jpeg);
				pushStr('\nendstream\nendobj\n');
			} else {
				pushStr('null\nendobj\n');
			}
		});

		var xref = byteLength;
		var total = 3 + pages.length * 3;
		pushStr('xref\n0 ' + total + '\n0000000000 65535 f \n');
		for (var i = 1; i < total; i++) pushStr(String(offsets[i]).padStart(10, '0') + ' 00000 n \n');
		pushStr('trailer\n<< /Size ' + total + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF');
		return new Blob(chunks, { type: 'application/pdf' });
	}

	function canvasToJpeg(canvas) {
		var raw = atob(canvas.toDataURL('image/jpeg', 0.92).split(',')[1]);
		var arr = new Uint8Array(raw.length);
		for (var i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
		return arr;
	}

	function collectImageUrls(cat, sel) {
		var r = resolveSelection(cat, sel);
		var fixed = cat.fixed_pages || {};
		var urls = [];
		if (r.setting) urls.push(r.setting.cover_image, r.setting.rispetto_image);
		['title_page', 'branding', 'back_cover'].forEach(function (k) { if (fixed[k]) urls.push(fixed[k].bg_image); });
		if (fixed.rispetto) ['start', 'end'].forEach(function (k) { if (fixed.rispetto[k]) urls.push(fixed.rispetto[k].bg_image); });
		Object.keys(r.blocks).forEach(function (k) {
			var b = r.blocks[k];
			if (!b) return;
			urls.push(b.prop_image);
			(b.spreads || []).forEach(function (s) { urls.push(s.bg_image, s.npc_image); });
		});
		return urls.filter(function (u) { return cleanUrl(u); });
	}

	/**
	 * Genera il PDF di stampa: copertina, risguardo bianco (facoltativo), pagine interne
	 * singole con abbondanza, risguardo bianco (facoltativo).
	 * opts.dpi (default 300), opts.download (default true), opts.onProgress(fatto, totale)
	 */
	function exportPrintPDF(cat, sel, child, opts) {
		opts = opts || {};
		var dpi = opts.dpi || 300;
		var r = resolveSelection(cat, sel);
		var fmt = r.format || { trim_mm: 200, bleed_mm: 3 };
		var T = num(fmt.trim_mm, 200), b = num(fmt.bleed_mm, 3);
		var pxMm = dpi / 25.4;
		var pagePx = Math.round((T + 2 * b) * pxMm);
		var bleedPx = b * pxMm;
		var trimPx = pagePx - 2 * bleedPx;

		return Promise.all(collectImageUrls(cat, sel).map(loadImage))
			.then(function () { return bakeAvatarPNG(cat, child); })
			.then(function (baked) {
				var av = baked.imgElement;
				var pages = [];
				var sheets = bookSheets(cat);
				var total = sheets.length;
				var noop = function () {};
				var progress = function (i) { if (opts.onProgress) opts.onProgress(i, total); };

				// Copertina
				var g = coverGeometry(fmt);
				var cc = document.createElement('canvas');
				cc.width = Math.round(g.W * pxMm);
				cc.height = Math.round(g.H * pxMm);
				renderCover(cc, cat, sel, child, av, { onAssetLoad: noop });
				pages.push({ widthMm: g.W, heightMm: g.H, jpeg: canvasToJpeg(cc), pxW: cc.width, pxH: cc.height });
				cc.width = cc.height = 1;
				progress(1);

				var blank = { widthMm: T + 2 * b, heightMm: T + 2 * b, trimMm: b, jpeg: null };
				if (fmt.blank_endpapers !== false) pages.push(blank);

				var page = document.createElement('canvas');
				page.width = page.height = pagePx;
				var spread = document.createElement('canvas');
				spread.width = Math.round((2 * T + 2 * b) * pxMm);
				spread.height = pagePx;
				var pushPage = function () {
					pages.push({ widthMm: T + 2 * b, heightMm: T + 2 * b, trimMm: b, jpeg: canvasToJpeg(page), pxW: pagePx, pxH: pagePx });
				};

				sheets.forEach(function (sheet, i) {
					if (sheet.kind === 'cover') return;
					if (sheetUnits(sheet) === 1) {
						renderSheet(page, cat, sheet, sel, child, av, { trim: { x: bleedPx, y: bleedPx, w: trimPx, h: trimPx }, bleedPx: bleedPx, onAssetLoad: noop });
						pushPage();
					} else {
						renderSheet(spread, cat, sheet, sel, child, av, { trim: { x: bleedPx, y: bleedPx, w: spread.width - 2 * bleedPx, h: trimPx }, bleedPx: bleedPx, onAssetLoad: noop });
						var pctx = page.getContext('2d');
						// Pagina sinistra: dal bordo esterno alla piega + abbondanza oltre la piega
						pctx.clearRect(0, 0, pagePx, pagePx);
						pctx.drawImage(spread, 0, 0, pagePx, pagePx, 0, 0, pagePx, pagePx);
						pushPage();
						// Pagina destra: dalla piega (meno l'abbondanza) al bordo esterno
						pctx.clearRect(0, 0, pagePx, pagePx);
						pctx.drawImage(spread, spread.width - pagePx, 0, pagePx, pagePx, 0, 0, pagePx, pagePx);
						pushPage();
					}
					progress(i + 1);
				});

				if (fmt.blank_endpapers !== false) pages.push(blank);

				var blob = buildPdf(pages);
				if (opts.download !== false) {
					var link = document.createElement('a');
					link.href = URL.createObjectURL(blob);
					var clean = (child.name || 'libro').toLowerCase().replace(/[^a-z0-9]/g, '') || 'libro';
					link.download = 'crealibro-' + clean + '-' + (fmt.id || 'formato') + '.pdf';
					document.body.appendChild(link);
					link.click();
					document.body.removeChild(link);
				}
				return { blob: blob, pageCount: pages.length };
			});
	}

	window.CreaLibroEngine = {
		PHASES: PHASES,
		DEFAULT_SLOTS: DEFAULT_SLOTS,
		BASE_FONT: BASE_FONT,
		buildAvatarSVGString: buildAvatarSVGString,
		svgToDataUrl: svgToDataUrl,
		bakeAvatarPNG: bakeAvatarPNG,
		innerPageCount: innerPageCount,
		bookSheets: bookSheets,
		sheetUnits: sheetUnits,
		blockAvailable: blockAvailable,
		getFormat: getFormat,
		resolveSelection: resolveSelection,
		selectionIds: selectionIds,
		tokenDictionary: tokenDictionary,
		genderTokens: genderTokens,
		resolveTokens: resolveTokens,
		unresolvedTokens: unresolvedTokens,
		slotWithDefaults: slotWithDefaults,
		computeSheetLayout: computeSheetLayout,
		renderSheet: renderSheet,
		renderCover: renderCover,
		coverGeometry: coverGeometry,
		requestImage: requestImage,
		loadImage: loadImage,
		getImageStatus: getImageStatus,
		exportPrintPDF: exportPrintPDF
	};
})();
