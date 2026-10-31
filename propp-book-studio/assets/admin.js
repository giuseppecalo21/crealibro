/**
 * Propp Book Studio — editor visuale del pannello admin.
 *
 * Ogni scheda del catalogo ha un'anteprima che usa lo stesso motore del configuratore
 * (window.ProppStudioEngine), alimentato con i valori del modulo non ancora salvati.
 * Gli elementi si trascinano direttamente sulla tavola e i campi numerici si aggiornano da soli.
 */
(function () {
	'use strict';

	var E = window.ProppStudioEngine;
	var D = window.ProppAdminData;
	if (!E || !D) return;

	var TYPE_COLORS = { avatar: '#2563eb', prop: '#d97706', npc: '#db2777' };
	var TYPE_FILLS = { avatar: 'rgba(37,99,235,0.10)', prop: 'rgba(217,119,6,0.12)', npc: 'rgba(219,39,119,0.12)' };
	// Ingombro reale della figura del bambino dentro il PNG 1000x1000 (il resto è trasparente)
	var AVATAR_BOX = { x0: 0.23, y0: 0.10, x1: 0.77, y1: 0.95 };
	var SLOT_LIMITS = { x: [-50, 150], y: [-50, 150], scale: [0.02, 3], rotation: [-180, 180] };

	var form;
	var testChild;
	var palIdx = { skinColor: 0, hairColor: 0, eyeColor: 0, shirtColor: 0 };
	var showGuides = true;
	var baked = null;
	var bakedSig = '';
	var bakeToken = 0;
	var manifestCache = null;
	var tmpCounter = 0;
	var dirty = false;
	var activeSection = 'sec-scenarios';
	var refreshQueued = false;

	function $(sel, root) { return (root || document).querySelector(sel); }
	function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
	function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
	function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
	function newTmpId() { return 'tmp_' + (++tmpCounter); }

	function setPath(obj, path, value) {
		var parts = path.split('.');
		var o = obj;
		for (var i = 0; i < parts.length - 1; i++) {
			if (!o[parts[i]] || typeof o[parts[i]] !== 'object') o[parts[i]] = {};
			o = o[parts[i]];
		}
		o[parts[parts.length - 1]] = value;
	}

	/* =========================================================
	 * Catalogo "dal vivo": ricostruito dai campi del modulo
	 * ========================================================= */
	function readCard(card) {
		var opt = { tokens: {} };
		$$('[data-f]', card).forEach(function (inp) {
			var v = inp.value;
			if (inp.dataset.num) v = parseFloat(v); // NaN → il motore usa la posizione predefinita
			setPath(opt, inp.dataset.f, v);
		});
		opt.id = card.dataset.previewId;
		return opt;
	}

	function getManifest() {
		if (manifestCache) return manifestCache;
		var m = JSON.parse(JSON.stringify(D.manifest));
		m.palettes = m.palettes || {};

		$$('.pbs-pal-wrap').forEach(function (wrap) {
			m.palettes[wrap.dataset.pal] = $$('.pbs-pal-row', wrap).map(function (row) {
				return { hex: $('input[type=color]', row).value, label: $('input[type=text]', row).value };
			});
		});

		m.hair_styles = $$('#pbs-hair-repeater .pbs-hair-card').map(function (c) {
			return {
				id: c.dataset.previewId,
				label: $('input[type=text]', c).value || 'Senza nome',
				svg: $('textarea', c).value
			};
		});

		m.propp_categories.forEach(function (cat) {
			var repeater = document.getElementById('repeater-' + cat.step_key);
			if (repeater) cat.options = $$('.pbs-card', repeater).map(readCard);
		});

		manifestCache = m;
		return m;
	}

	function invalidate() { manifestCache = null; }

	function markDirty() {
		if (dirty) return;
		dirty = true;
		var note = $('#pbs-dirty-note');
		if (note) note.hidden = false;
	}

	/** Storia di prova per una scheda: la sua opzione + la prima opzione delle altre fasi */
	function storyFor(m, card) {
		var story = {};
		m.propp_categories.forEach(function (cat) {
			story[cat.step_key] = cat.options && cat.options[0] ? cat.options[0].id : '';
		});
		if (card) story[card.dataset.step] = card.dataset.previewId;
		return story;
	}

	function elementLabel(el) {
		if (el.type === 'npc') return (D.steps[el.step] && D.steps[el.step].npc_label) || 'Personaggio';
		return D.elementLabels[el.type] || el.type;
	}

	/* =========================================================
	 * Personaggio di prova
	 * ========================================================= */
	function avatarSignature(m) {
		var hair = m.hair_styles.find(function (h) { return h.id === testChild.hairStyle; }) || m.hair_styles[0];
		return JSON.stringify([testChild.skinColor, testChild.hairColor, testChild.eyeColor, testChild.shirtColor, testChild.glasses, hair ? hair.svg : '']);
	}

	function ensureAvatar() {
		var m = getManifest();
		var sig = avatarSignature(m);
		if (baked && sig === bakedSig) return Promise.resolve(baked);
		bakedSig = sig;
		var token = ++bakeToken;
		return E.bakeAvatarPNG(m, testChild).then(function (res) {
			if (token !== bakeToken) return baked;
			baked = res;
			var img = $('#pbs-test-avatar');
			var box = $('.pbs-side-avatar');
			if (img) img.src = res.error ? '' : res.dataUrl;
			if (box) box.classList.toggle('has-error', !!res.error);
			return res;
		});
	}

	function syncSidePanel(m) {
		var ids = m.hair_styles.map(function (h) { return h.id; });
		if (ids.indexOf(testChild.hairStyle) === -1) testChild.hairStyle = ids[0] || '';

		var sel = $('#pbs-test-hair');
		if (sel) {
			var sig = m.hair_styles.map(function (h) { return h.id + ':' + h.label; }).join('|');
			if (sel._sig !== sig) {
				sel.innerHTML = '';
				m.hair_styles.forEach(function (h) { sel.add(new Option(h.label, h.id)); });
				sel._sig = sig;
			}
			sel.value = testChild.hairStyle;
		}

		$$('.pbs-side-swatches').forEach(function (wrap) {
			var key = wrap.dataset.key;
			var list = m.palettes[wrap.dataset.pal] || [];
			if (!list.length) return;
			palIdx[key] = clamp(palIdx[key], 0, list.length - 1);
			testChild[key] = list[palIdx[key]].hex;

			wrap.innerHTML = '';
			list.forEach(function (c, i) {
				var b = document.createElement('button');
				b.type = 'button';
				b.className = 'pbs-sw' + (i === palIdx[key] ? ' active' : '');
				b.style.backgroundColor = c.hex;
				b.title = c.label || c.hex;
				b.setAttribute('aria-label', c.label || c.hex);
				b.addEventListener('click', function () {
					palIdx[key] = i;
					scheduleRefresh();
				});
				wrap.appendChild(b);
			});
		});
	}

	function updateHairThumbs(m) {
		$$('#pbs-hair-repeater .pbs-hair-card').forEach(function (c) {
			var img = $('.pbs-hair-thumb img', c);
			var err = $('.pbs-hair-error', c);
			var url = E.svgToDataUrl(E.buildAvatarSVGString(m, Object.assign({}, testChild, { hairStyle: c.dataset.previewId })));
			if (img.getAttribute('src') !== url) {
				img.onload = function () { err.hidden = true; img.hidden = false; };
				img.onerror = function () { err.hidden = false; img.hidden = true; };
				img.src = url;
			}
			c.classList.toggle('is-active', c.dataset.previewId === testChild.hairStyle);
		});
	}

	/* =========================================================
	 * Anteprima delle schede
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
		invalidate();
		var m = getManifest();
		syncSidePanel(m);
		updateHairThumbs(m);
		ensureAvatar().then(function () {
			$$('#sec-scenarios .pbs-card').forEach(renderCard);
			if (activeSection === 'sec-book') renderBook();
		});
	}

	function renderCard(card) {
		var m = getManifest();
		var canvas = $('canvas', card);
		var page = parseInt(card.dataset.page, 10) || 0;
		if (!card._rerender) card._rerender = function () { renderCard(card); };

		var layout = E.renderBookPageToCanvas(canvas, m, page, testChild, storyFor(m, card), baked && baked.imgElement, { onAssetLoad: card._rerender });
		card._layout = layout;
		if (layout) drawOverlay(canvas, layout, card._selected);
		updateWarnings(card, layout, m);
	}

	function box(el) {
		if (el.type === 'avatar' && el.drawn) {
			var s = el.size;
			return { x0: (AVATAR_BOX.x0 - 0.5) * s, y0: (AVATAR_BOX.y0 - 0.5) * s, x1: (AVATAR_BOX.x1 - 0.5) * s, y1: (AVATAR_BOX.y1 - 0.5) * s };
		}
		return { x0: -el.w / 2, y0: -el.h / 2, x1: el.w / 2, y1: el.h / 2 };
	}

	function toWorld(el, lx, ly) {
		var a = (el.rotation * Math.PI) / 180;
		return { x: el.cx + lx * Math.cos(a) - ly * Math.sin(a), y: el.cy + lx * Math.sin(a) + ly * Math.cos(a) };
	}

	function toLocal(el, p) {
		var a = (-el.rotation * Math.PI) / 180;
		var dx = p.x - el.cx;
		var dy = p.y - el.cy;
		return { x: dx * Math.cos(a) - dy * Math.sin(a), y: dx * Math.sin(a) + dy * Math.cos(a) };
	}

	function aabb(el) {
		var b = box(el);
		var pts = [toWorld(el, b.x0, b.y0), toWorld(el, b.x1, b.y0), toWorld(el, b.x1, b.y1), toWorld(el, b.x0, b.y1)];
		var xs = pts.map(function (p) { return p.x; });
		var ys = pts.map(function (p) { return p.y; });
		return { x0: Math.min.apply(null, xs), y0: Math.min.apply(null, ys), x1: Math.max.apply(null, xs), y1: Math.max.apply(null, ys) };
	}

	function handlePositions(el, W) {
		var b = box(el);
		var gap = W * 0.06;
		var below = el.cy + b.y0 - gap < W * 0.03;
		return {
			resize: { x: b.x1, y: b.y1 },
			rotate: { x: (b.x0 + b.x1) / 2, y: below ? b.y1 + gap : b.y0 - gap },
			rotateBelow: below,
			anchorY: below ? b.y1 : b.y0
		};
	}

	function drawOverlay(canvas, layout, selected) {
		var ctx = canvas.getContext('2d');
		var W = canvas.width;
		var H = canvas.height;
		ctx.save();

		if (showGuides) {
			var t = (W * E.BLEED_MM) / E.TOTAL_MM;       // linea di taglio
			var s = (W * (E.BLEED_MM + 5)) / E.TOTAL_MM; // 5 mm di margine di sicurezza
			ctx.fillStyle = 'rgba(239,68,68,0.20)';
			ctx.beginPath();
			ctx.rect(0, 0, W, H);
			ctx.rect(t, t, W - 2 * t, H - 2 * t);
			ctx.fill('evenodd');
			ctx.lineWidth = Math.max(1, W * 0.0025);
			ctx.setLineDash([W * 0.012, W * 0.008]);
			ctx.strokeStyle = 'rgba(220,38,38,0.95)';
			ctx.strokeRect(t, t, W - 2 * t, H - 2 * t);
			ctx.strokeStyle = 'rgba(37,99,235,0.8)';
			ctx.strokeRect(s, s, W - 2 * s, H - 2 * s);
			ctx.setLineDash([]);
		}

		layout.elements.forEach(function (el) {
			var isSel = el.slotKey === selected;
			var color = TYPE_COLORS[el.type];
			var b = box(el);

			ctx.save();
			ctx.translate(el.cx, el.cy);
			ctx.rotate((el.rotation * Math.PI) / 180);
			ctx.strokeStyle = color;
			ctx.lineWidth = isSel ? W * 0.004 : W * 0.0022;
			ctx.setLineDash(isSel ? [] : [W * 0.01, W * 0.007]);
			if (!el.drawn || isSel) {
				ctx.fillStyle = TYPE_FILLS[el.type];
				ctx.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
			}
			ctx.strokeRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);

			if (isSel) {
				var hp = handlePositions(el, W);
				var hs = W * 0.024;
				ctx.setLineDash([]);
				ctx.fillStyle = '#ffffff';
				ctx.fillRect(hp.resize.x - hs / 2, hp.resize.y - hs / 2, hs, hs);
				ctx.strokeRect(hp.resize.x - hs / 2, hp.resize.y - hs / 2, hs, hs);
				ctx.beginPath();
				ctx.moveTo(hp.rotate.x, hp.anchorY);
				ctx.lineTo(hp.rotate.x, hp.rotate.y);
				ctx.stroke();
				ctx.beginPath();
				ctx.arc(hp.rotate.x, hp.rotate.y, hs * 0.62, 0, Math.PI * 2);
				ctx.fill();
				ctx.stroke();
			}
			ctx.restore();

			// Etichetta dell'elemento
			var text = elementLabel(el) + (el.drawn ? '' : ' · non visibile');
			ctx.font = 'bold ' + Math.round(W * 0.022) + 'px system-ui, -apple-system, sans-serif';
			ctx.textBaseline = 'middle';
			ctx.textAlign = 'left';
			var pad = W * 0.009;
			var chipH = W * 0.036;
			var tw = ctx.measureText(text).width + pad * 2;
			var bb = aabb(el);
			var x = clamp(bb.x0, 2, W - tw - 2);
			var y = clamp(bb.y0 - chipH - 4, 2, H - chipH - 2);
			ctx.globalAlpha = isSel ? 1 : 0.85;
			ctx.fillStyle = color;
			ctx.fillRect(x, y, tw, chipH);
			ctx.fillStyle = '#ffffff';
			ctx.fillText(text, x + pad, y + chipH / 2 + 1);
			ctx.globalAlpha = 1;
		});

		ctx.restore();
	}

	function updateWarnings(card, layout, m) {
		var warnBox = $('.pbs-preview-warn', card);
		if (!warnBox) return;
		var msgs = [];
		var opt = readCard(card);
		var magic = E.getSelectedOption(m, '3_magic_item', storyFor(m, card)['3_magic_item']);

		var checks = [
			[opt.bg_image, 'L\'illustrazione di sfondo non si carica: controlla l\'URL (o che il file sia sullo stesso dominio del sito).'],
			[opt.prop_image, 'Il PNG dell\'oggetto magico non si carica: controlla l\'URL.'],
			[opt.npc_image, 'Il PNG del personaggio non si carica: controlla l\'URL.']
		];
		checks.forEach(function (c) {
			if (c[0] && E.getImageStatus(c[0]) === 'error') msgs.push(c[1]);
		});

		if (layout) {
			if (!layout.isCover && layout.textLines > layout.maxTextLines) {
				msgs.push('Il testo di questa pagina occupa ' + layout.textLines + ' righe, ma nel riquadro ne entrano ' + layout.maxTextLines + ': va accorciato.');
			}
			var W = $('canvas', card).width;
			var t = (W * E.BLEED_MM) / E.TOTAL_MM;
			layout.elements.forEach(function (el) {
				if (!el.drawn) return;
				var bb = aabb(el);
				if (bb.x0 < t || bb.y0 < t || bb.x1 > W - t || bb.y1 > W - t) {
					msgs.push('«' + elementLabel(el) + '» supera la linea di taglio: la parte esterna andrà persa in stampa.');
				}
			});
			var hasNpc = layout.elements.some(function (el) { return el.type === 'npc' && !el.drawn; });
			if (hasNpc) {
				msgs.push('Il riquadro rosa del personaggio non compare nel libro finché non carichi un suo PNG: se è già disegnato nell\'illustrazione puoi ignorarlo.');
			}
			if (card.dataset.step === '1_setting' && (layout.index === 0 || layout.index === 5) && magic && !magic.prop_image) {
				msgs.push('L\'oggetto magico mostrato è un segnaposto: in questa tavola compare quello scelto dal cliente nella fase 3.');
			}
		}

		warnBox.innerHTML = '';
		msgs.forEach(function (msg) {
			var p = document.createElement('p');
			p.textContent = msg;
			warnBox.appendChild(p);
		});
		warnBox.hidden = !msgs.length;
	}

	/* =========================================================
	 * Interazione: trascinamento, ridimensionamento, rotazione
	 * ========================================================= */
	function toCanvasPoint(canvas, e) {
		var r = canvas.getBoundingClientRect();
		return {
			x: ((e.clientX - r.left) * canvas.width) / r.width,
			y: ((e.clientY - r.top) * canvas.height) / r.height
		};
	}

	function findEl(layout, slotKey) {
		if (!layout || !slotKey) return null;
		return layout.elements.find(function (el) { return el.slotKey === slotKey; }) || null;
	}

	function hitElement(layout, p) {
		for (var i = layout.elements.length - 1; i >= 0; i--) {
			var el = layout.elements[i];
			var l = toLocal(el, p);
			var b = box(el);
			if (l.x >= b.x0 && l.x <= b.x1 && l.y >= b.y0 && l.y <= b.y1) return el;
		}
		return null;
	}

	function hitHandle(el, p, W) {
		var l = toLocal(el, p);
		var hp = handlePositions(el, W);
		var r = W * 0.035;
		if (dist(l, hp.resize) < r) return 'resize';
		if (dist(l, hp.rotate) < r) return 'rotate';
		return null;
	}

	function formatAxis(axis, v) {
		var lim = SLOT_LIMITS[axis];
		if (axis === 'rotation') {
			v = ((v + 180) % 360 + 360) % 360 - 180;
		}
		v = clamp(v, lim[0], lim[1]);
		return axis === 'scale' ? String(Math.round(v * 1000) / 1000) : String(Math.round(v * 10) / 10);
	}

	function setSlotValues(card, slotKey, values) {
		Object.keys(values).forEach(function (axis) {
			var inp = $('input[data-f="' + slotKey + '.' + axis + '"]', card);
			if (inp) inp.value = formatAxis(axis, values[axis]);
		});
		invalidate();
		markDirty();
		renderCard(card);
	}

	function selectSlot(card, slotKey) {
		card._selected = slotKey || null;
		$$('tr[data-slot]', card).forEach(function (tr) {
			tr.classList.toggle('is-selected', tr.dataset.slot === card._selected);
		});
	}

	function bindCanvas(card) {
		var canvas = $('canvas', card);
		var drag = null;

		canvas.addEventListener('pointerdown', function (e) {
			var layout = card._layout;
			if (!layout) return;
			var W = canvas.width;
			var p = toCanvasPoint(canvas, e);
			var el = null;
			var mode = null;

			var current = findEl(layout, card._selected);
			if (current) {
				mode = hitHandle(current, p, W);
				if (mode) el = current;
			}
			if (!mode) {
				el = hitElement(layout, p);
				if (el) mode = 'move';
			}

			selectSlot(card, el ? el.slotKey : null);
			if (!el) {
				renderCard(card);
				return;
			}

			e.preventDefault();
			canvas.focus({ preventScroll: true });
			canvas.setPointerCapture(e.pointerId);
			var hp = handlePositions(el, W);
			drag = {
				mode: mode,
				slotKey: el.slotKey,
				p0: p,
				start: { x: el.slot.x, y: el.slot.y, scale: el.slot.scale, rotation: el.slot.rotation },
				c: { x: el.cx, y: el.cy },
				d0: Math.max(10, dist(p, { x: el.cx, y: el.cy })),
				rotOffset: hp.rotateBelow ? -90 : 90
			};
			canvas.classList.add('is-dragging');
			renderCard(card);
		});

		canvas.addEventListener('pointermove', function (e) {
			var p = toCanvasPoint(canvas, e);
			var W = canvas.width;
			if (!drag) {
				var layout = card._layout;
				var cur = 'default';
				var sel = layout && findEl(layout, card._selected);
				var h = sel && hitHandle(sel, p, W);
				if (h === 'resize') cur = 'nwse-resize';
				else if (h === 'rotate') cur = 'grab';
				else if (layout && hitElement(layout, p)) cur = 'move';
				canvas.style.cursor = cur;
				return;
			}

			var s = drag.start;
			var v = {};
			if (drag.mode === 'move') {
				v.x = s.x + ((p.x - drag.p0.x) / W) * 100;
				v.y = s.y + ((p.y - drag.p0.y) / canvas.height) * 100;
			} else if (drag.mode === 'resize') {
				v.scale = s.scale * (dist(p, drag.c) / drag.d0);
			} else if (drag.mode === 'rotate') {
				var a = (Math.atan2(p.y - drag.c.y, p.x - drag.c.x) * 180) / Math.PI + drag.rotOffset;
				a = ((a + 180) % 360 + 360) % 360 - 180;
				if (e.shiftKey) a = Math.round(a / 15) * 15;
				else if (Math.abs(a) < 3) a = 0;
				v.rotation = a;
			}
			setSlotValues(card, drag.slotKey, v);
		});

		function endDrag(e) {
			if (!drag) return;
			drag = null;
			canvas.classList.remove('is-dragging');
			if (canvas.hasPointerCapture && canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
		}
		canvas.addEventListener('pointerup', endDrag);
		canvas.addEventListener('pointercancel', endDrag);

		canvas.addEventListener('keydown', function (e) {
			var el = findEl(card._layout, card._selected);
			if (!el) return;
			var step = e.shiftKey ? 2 : 0.5;
			var v = null;
			switch (e.key) {
				case 'ArrowLeft': v = { x: el.slot.x - step }; break;
				case 'ArrowRight': v = { x: el.slot.x + step }; break;
				case 'ArrowUp': v = { y: el.slot.y - step }; break;
				case 'ArrowDown': v = { y: el.slot.y + step }; break;
				case '+': case '=': v = { scale: el.slot.scale * 1.03 }; break;
				case '-': case '_': v = { scale: el.slot.scale / 1.03 }; break;
				case '[': v = { rotation: el.slot.rotation - (e.shiftKey ? 5 : 1) }; break;
				case ']': v = { rotation: el.slot.rotation + (e.shiftKey ? 5 : 1) }; break;
				case 'Escape':
					selectSlot(card, null);
					renderCard(card);
					e.preventDefault();
					return;
			}
			if (v) {
				e.preventDefault();
				setSlotValues(card, el.slotKey, v);
			}
		});
	}

	function setCardPage(card, page) {
		card.dataset.page = String(page);
		$$('.pbs-page-tab[data-page]', card).forEach(function (t) {
			t.classList.toggle('active', t.dataset.page === String(page));
		});
		$$('.pbs-slot-table', card).forEach(function (t) {
			t.hidden = t.dataset.page !== String(page);
		});
		selectSlot(card, null);
	}

	function initCard(card) {
		bindCanvas(card);

		$$('.pbs-page-tab[data-page]', card).forEach(function (tab) {
			tab.addEventListener('click', function () {
				setCardPage(card, parseInt(tab.dataset.page, 10));
				renderCard(card);
			});
		});

		// Cliccando una riga della tabella si seleziona l'elemento sulla tavola
		$$('tr[data-slot]', card).forEach(function (tr) {
			var pick = function () {
				if (card._selected === tr.dataset.slot) return;
				selectSlot(card, tr.dataset.slot);
				renderCard(card);
			};
			tr.addEventListener('focusin', pick);
			$('th', tr).addEventListener('click', pick);
		});

		$('.pbs-card-remove', card).addEventListener('click', function () {
			var repeater = card.parentElement;
			if ($$('.pbs-card', repeater).length <= 1) {
				window.alert('Ogni fase deve avere almeno un\'opzione: aggiungine un\'altra prima di eliminare questa.');
				return;
			}
			if (!window.confirm('Rimuovere l\'opzione «' + ($('.pbs-label-input', card).value || 'senza titolo') + '»? Diventa definitivo quando salvi il catalogo.')) return;
			card.remove();
			markDirty();
			scheduleRefresh();
		});
	}

	/* =========================================================
	 * Anteprima del libro completo
	 * ========================================================= */
	function stepForPage(pageIndex) {
		var found = null;
		Object.keys(D.steps).forEach(function (k) {
			D.steps[k].pages.forEach(function (p) {
				if (p.page === pageIndex) found = k;
			});
		});
		return found;
	}

	function bookStory(m) {
		var story = {};
		$$('.pbs-book-select').forEach(function (sel) {
			var cat = m.propp_categories.find(function (c) { return c.step_key === sel.dataset.step; });
			if (!cat) return;
			var sig = cat.options.map(function (o) { return o.id + ':' + o.label; }).join('|');
			if (sel._sig !== sig) {
				var prev = sel.value;
				sel.innerHTML = '';
				cat.options.forEach(function (o) { sel.add(new Option(o.label || '(senza titolo)', o.id)); });
				sel._sig = sig;
				if (cat.options.some(function (o) { return o.id === prev; })) sel.value = prev;
			}
			story[sel.dataset.step] = sel.value;
		});
		return story;
	}

	function renderBook() {
		var grid = $('#pbs-book-grid');
		if (!grid) return;
		var m = getManifest();
		var story = bookStory(m);

		if (!grid.children.length) {
			E.PAGE_DEFS.forEach(function (def, i) {
				var fig = document.createElement('figure');
				fig.className = 'pbs-book-page';
				fig.innerHTML = '<button type="button" class="pbs-book-open" title="Modifica le posizioni di questa tavola"><canvas width="600" height="600"></canvas></button><figcaption><span></span><em hidden></em></figcaption>';
				$('span', fig).textContent = def.title;
				$('.pbs-book-open', fig).addEventListener('click', function () { goToEditor(i); });
				grid.appendChild(fig);
			});
		}

		var rerender = renderBook;
		$$('.pbs-book-page', grid).forEach(function (fig, i) {
			var layout = E.renderBookPageToCanvas($('canvas', fig), m, i, testChild, story, baked && baked.imgElement, { onAssetLoad: rerender });
			var warn = $('em', fig);
			var over = layout && !layout.isCover && layout.textLines > layout.maxTextLines;
			warn.hidden = !over;
			if (over) warn.textContent = 'testo troppo lungo';
		});
	}

	function showSection(id) {
		activeSection = id;
		$$('.pbs-admin-tab').forEach(function (t) { t.classList.toggle('active', t.dataset.target === id); });
		$$('.pbs-admin-section').forEach(function (s) { s.classList.toggle('active', s.id === id); });
		if (id === 'sec-book') ensureAvatar().then(renderBook);
		if (id === 'sec-scenarios') $$('#sec-scenarios .pbs-card').forEach(renderCard);
	}

	function goToEditor(pageIndex) {
		var step = stepForPage(pageIndex);
		if (!step) return;
		var sel = $('.pbs-book-select[data-step="' + step + '"]');
		var id = sel ? sel.value : '';
		var card = $$('#repeater-' + step + ' .pbs-card').find(function (c) { return c.dataset.previewId === id; });
		if (!card) return;
		showSection('sec-scenarios');
		setCardPage(card, pageIndex);
		renderCard(card);
		card.scrollIntoView({ behavior: 'smooth', block: 'start' });
		card.classList.add('is-flash');
		setTimeout(function () { card.classList.remove('is-flash'); }, 1600);
	}

	/* =========================================================
	 * Avvio
	 * ========================================================= */
	function ensureUniquePreviewIds() {
		var seen = {};
		$$('#sec-scenarios .pbs-card, #pbs-hair-repeater .pbs-hair-card').forEach(function (el) {
			var key = (el.dataset.step || 'hair') + ':' + el.dataset.previewId;
			if (!el.dataset.previewId || seen[key]) el.dataset.previewId = newTmpId();
			seen[(el.dataset.step || 'hair') + ':' + el.dataset.previewId] = true;
		});
	}

	function cloneTemplate(id, cardSelector) {
		var tpl = document.getElementById(id);
		if (!tpl) return null;
		var html = tpl.innerHTML.split('__KEY__').join('n' + Date.now() + '_' + (++tmpCounter));
		var wrap = document.createElement('div');
		wrap.innerHTML = html;
		return wrap.querySelector(cardSelector);
	}

	function openMediaFrame(input) {
		if (!window.wp || !wp.media) return;
		var frame = wp.media({
			title: 'Scegli un\'immagine',
			button: { text: 'Usa questa immagine' },
			library: { type: 'image' },
			multiple: false
		});
		frame.on('select', function () {
			var attachment = frame.state().get('selection').first().toJSON();
			input.value = attachment.url;
			input.dispatchEvent(new Event('input', { bubbles: true }));
		});
		frame.open();
	}

	function updateMediaThumb(input) {
		var field = input.closest('.pbs-media-field');
		if (!field) return;
		var thumb = $('.pbs-media-thumb', field);
		var img = $('img', thumb);
		var url = input.value.trim();
		img.src = url;
		thumb.classList.toggle('is-empty', !url);
	}

	function init() {
		form = document.getElementById('pbs-admin-form');
		if (!form) return;

		var hs = D.manifest.hair_styles || [];
		testChild = {
			name: 'Giorgio',
			gender: 'M',
			hairStyle: hs[0] ? hs[0].id : '',
			skinColor: '#FAD7B8',
			hairColor: '#4A2511',
			eyeColor: '#2980B9',
			shirtColor: '#E11D48',
			glasses: 'none'
		};

		ensureUniquePreviewIds();
		$$('#sec-scenarios .pbs-card').forEach(initCard);

		// Tab principali
		$$('.pbs-admin-tab').forEach(function (tab) {
			tab.addEventListener('click', function () { showSection(tab.dataset.target); });
		});

		// Qualsiasi modifica al modulo aggiorna le anteprime
		form.addEventListener('input', function (e) {
			var t = e.target;
			if (!t.name) return; // es. i menu dell'anteprima del libro: non fanno parte del catalogo
			if (t.classList.contains('pbs-label-input')) {
				var title = $('.pbs-card-title', t.closest('.pbs-card'));
				if (title) title.textContent = t.value || 'Nuova opzione';
			}
			if (t.closest('.pbs-media-field')) updateMediaThumb(t);
			markDirty();
			scheduleRefresh();
		});
		form.addEventListener('change', function (e) {
			if (!e.target.name) return;
			markDirty();
			scheduleRefresh();
		});

		form.addEventListener('click', function (e) {
			var up = e.target.closest('.pbs-upload-btn');
			if (up) {
				e.preventDefault();
				openMediaFrame($('input[type=text]', up.closest('.pbs-media-row')));
				return;
			}
			var clear = e.target.closest('.pbs-clear-btn');
			if (clear) {
				e.preventDefault();
				var inp = $('input[type=text]', clear.closest('.pbs-media-row'));
				inp.value = '';
				inp.dispatchEvent(new Event('input', { bubbles: true }));
				return;
			}
			var palRemove = e.target.closest('.pbs-pal-remove');
			if (palRemove) {
				palRemove.closest('.pbs-pal-row').remove();
				markDirty();
				scheduleRefresh();
				return;
			}
			var hairRemove = e.target.closest('.pbs-hair-remove');
			if (hairRemove) {
				if ($$('#pbs-hair-repeater .pbs-hair-card').length <= 1) {
					window.alert('Serve almeno un\'acconciatura.');
					return;
				}
				hairRemove.closest('.pbs-hair-card').remove();
				markDirty();
				scheduleRefresh();
				return;
			}
			var hairThumb = e.target.closest('.pbs-hair-thumb');
			if (hairThumb) {
				testChild.hairStyle = hairThumb.closest('.pbs-hair-card').dataset.previewId;
				scheduleRefresh();
			}
		});

		form.addEventListener('submit', function () { dirty = false; });
		window.addEventListener('beforeunload', function (e) {
			if (!dirty) return;
			e.preventDefault();
			e.returnValue = '';
		});

		// Nuove opzioni
		$$('.pbs-add-scenario-btn').forEach(function (btn) {
			btn.addEventListener('click', function () {
				var step = btn.dataset.step;
				var card = cloneTemplate('pbs-tpl-' + step, '.pbs-card');
				if (!card) return;
				card.dataset.previewId = newTmpId();
				document.getElementById('repeater-' + step).appendChild(card);
				initCard(card);
				markDirty();
				scheduleRefresh();
				card.scrollIntoView({ behavior: 'smooth', block: 'start' });
				var label = $('.pbs-label-input', card);
				if (label) label.focus({ preventScroll: true });
			});
		});

		var addHair = document.getElementById('pbs-add-hair-btn');
		if (addHair) {
			addHair.addEventListener('click', function () {
				var card = cloneTemplate('pbs-tpl-hair', '.pbs-hair-card');
				if (!card) return;
				card.dataset.previewId = newTmpId();
				document.getElementById('pbs-hair-repeater').appendChild(card);
				markDirty();
				scheduleRefresh();
			});
		}

		$$('.pbs-add-color-btn').forEach(function (btn) {
			btn.addEventListener('click', function () {
				var pal = btn.dataset.pal;
				var row = document.createElement('div');
				row.className = 'pbs-pal-row';
				row.innerHTML =
					'<input type="color" name="palettes[' + pal + '][hex][]" value="#3B82F6" />' +
					'<input type="text" class="widefat" name="palettes[' + pal + '][label][]" placeholder="Nome del colore" />' +
					'<button type="button" class="button-link-delete pbs-pal-remove" aria-label="Rimuovi colore">✕</button>';
				document.getElementById('pal-wrap-' + pal).appendChild(row);
				$('input[type=text]', row).focus();
				markDirty();
				scheduleRefresh();
			});
		});

		// Personaggio di prova
		var nameInput = document.getElementById('pbs-test-name');
		nameInput.addEventListener('input', function () {
			testChild.name = nameInput.value;
			scheduleRefresh();
		});
		$$('#pbs-test-gender button').forEach(function (b) {
			b.addEventListener('click', function () {
				$$('#pbs-test-gender button').forEach(function (x) { x.classList.toggle('active', x === b); });
				testChild.gender = b.dataset.value;
				scheduleRefresh();
			});
		});
		document.getElementById('pbs-test-hair').addEventListener('change', function (e) {
			testChild.hairStyle = e.target.value;
			scheduleRefresh();
		});
		document.getElementById('pbs-test-glasses').addEventListener('change', function (e) {
			testChild.glasses = e.target.checked ? 'round' : 'none';
			scheduleRefresh();
		});
		document.getElementById('pbs-show-guides').addEventListener('change', function (e) {
			showGuides = e.target.checked;
			$$('#sec-scenarios .pbs-card').forEach(renderCard);
		});

		// Anteprima del libro
		$$('.pbs-book-select').forEach(function (sel) {
			sel.addEventListener('change', renderBook);
		});
		var pdfBtn = document.getElementById('pbs-book-pdf');
		if (pdfBtn) {
			pdfBtn.addEventListener('click', function () {
				var m = getManifest();
				var label = pdfBtn.textContent;
				pdfBtn.disabled = true;
				pdfBtn.textContent = 'Generazione in corso…';
				E.exportPrintReadyPDF(m, testChild, bookStory(m), 1200).then(function () {
					pdfBtn.disabled = false;
					pdfBtn.textContent = label;
				});
			});
		}

		refreshAll();
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init);
	} else {
		init();
	}
})();
