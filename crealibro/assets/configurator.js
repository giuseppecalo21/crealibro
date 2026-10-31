/**
 * CreaLibro — configuratore del cliente (shortcode [crealibro]).
 * Passi: 1. il bambino · 2. l'ambientazione · 3. la storia, una tappa alla volta · 4. formato e carrello.
 */
(function () {
	'use strict';

	var E = window.CreaLibroEngine;
	var D = window.CreaLibroData;

	function h(tag, attrs, children) {
		var parts = tag.split('.');
		var el = document.createElement(parts[0] || 'div');
		if (parts.length > 1) el.className = parts.slice(1).join(' ');
		Object.keys(attrs || {}).forEach(function (k) {
			var v = attrs[k];
			if (v === null || v === undefined || v === false) return;
			if (k === 'text') el.textContent = v;
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

	function init() {
		var app = document.getElementById('crealibro-app');
		if (!app || !E || !D) return;
		var cat = D.catalog;
		var money = function (v) {
			try { return new Intl.NumberFormat('it-IT', { style: 'currency', currency: D.currency || 'EUR' }).format(v); } catch (e) { return v + ' €'; }
		};
		var first = function (key, fb) { var l = cat.palettes && cat.palettes[key]; return (l && l[0] && l[0].hex) || fb; };

		var child = {
			name: '',
			gender: 'M',
			hairStyle: cat.hair_styles[0] ? cat.hair_styles[0].id : '',
			skinColor: first('skin', '#FAD7B8'),
			hairColor: first('hair', '#4A2511'),
			eyeColor: first('eyes', '#2980B9'),
			shirtColor: first('shirt', '#E11D48'),
			glasses: 'none'
		};
		var sel = E.selectionIds(cat, {});
		var chosen = {};       // tappe in cui il cliente ha scelto esplicitamente
		var step = 1;
		var stageIdx = 0;
		var sheets = E.bookSheets(cat);
		var sheetIdx = 0;
		var baked = null;

		/* ---------- Anteprima a libro aperto ---------- */
		var canvas = h('canvas', { width: 1200, height: 600 });
		var pageLabel = h('span.clc-page-label');
		var preview = h('div.clc-preview', {}, [
			h('div.clc-book', {}, [canvas]),
			h('div.clc-nav', {}, [
				h('button.clc-btn-ghost', { type: 'button', text: '← Indietro', onclick: function () { goSheet(sheetIdx - 1); } }),
				pageLabel,
				h('button.clc-btn-ghost', { type: 'button', text: 'Avanti →', onclick: function () { goSheet(sheetIdx + 1); } })
			])
		]);

		function previewChild() {
			return Object.assign({}, child, { name: child.name.trim() || 'il tuo bambino' });
		}

		function drawSheet(c, sheet, selection) {
			var ctx = c.getContext('2d');
			var W = c.width, H = c.height, half = W / 2;
			var redraw = function () { drawSheet(c, sheet, selection); };
			var av = baked ? baked.imgElement : null;
			ctx.clearRect(0, 0, W, H);
			if (E.sheetUnits(sheet) === 2) {
				E.renderSheet(c, cat, sheet, selection, previewChild(), av, { onAssetLoad: redraw });
			} else {
				ctx.fillStyle = '#e8e4dc';
				ctx.fillRect(0, 0, W, H);
				if (sheet.kind === 'cover') {
					var back = (cat.fixed_pages && cat.fixed_pages.back_cover) || {};
					ctx.fillStyle = back.bg_color || '#1E293B';
					ctx.fillRect(0, 0, half, H);
					var bi = E.requestImage(back.bg_image, redraw);
					if (bi) ctx.drawImage(bi, 0, 0, half, H);
					E.renderSheet(c, cat, { kind: 'cover_front' }, selection, previewChild(), av, { trim: { x: half, y: 0, w: half, h: H }, clear: false, onAssetLoad: redraw });
				} else {
					var x = sheet.side === 'left' ? 0 : half;
					E.renderSheet(c, cat, sheet, selection, previewChild(), av, { trim: { x: x, y: 0, w: half, h: H }, clear: false, onAssetLoad: redraw });
				}
			}
			var grd = ctx.createLinearGradient(half - 18, 0, half + 18, 0);
			grd.addColorStop(0, 'rgba(0,0,0,0)');
			grd.addColorStop(0.5, 'rgba(0,0,0,0.18)');
			grd.addColorStop(1, 'rgba(0,0,0,0)');
			ctx.fillStyle = grd;
			ctx.fillRect(half - 18, 0, 36, H);
		}

		function drawPreview() {
			drawSheet(canvas, sheets[sheetIdx], sel);
			pageLabel.textContent = sheets[sheetIdx].label + ' (' + (sheetIdx + 1) + '/' + sheets.length + ')';
		}

		function goSheet(i) {
			sheetIdx = (i + sheets.length) % sheets.length;
			drawPreview();
		}

		function goToStageSheet(si) {
			var i = sheets.findIndex(function (s) { return s.kind === 'story' && s.stageIndex === si; });
			if (i !== -1) goSheet(i);
		}

		function refreshAvatar() {
			return E.bakeAvatarPNG(cat, child).then(function (res) {
				baked = res;
				drawPreview();
				renderStep();
			});
		}

		/* ---------- Passi ---------- */
		var tabs = h('div.clc-steps');
		var panel = h('div.clc-panel');
		var controls = h('div.clc-controls', {}, [tabs, panel]);
		app.innerHTML = '';
		app.appendChild(preview);
		app.appendChild(controls);

		var STEPS = [[1, 'Il bambino'], [2, 'L\'ambientazione'], [3, 'La storia'], [4, 'Formato']];

		function renderTabs() {
			tabs.innerHTML = '';
			STEPS.forEach(function (s) {
				tabs.appendChild(h('button.clc-step' + (step === s[0] ? '.active' : ''), { type: 'button', onclick: function () { setStep(s[0]); } }, [h('span.clc-step-n', { text: String(s[0]) }), s[1]]));
			});
		}

		function setStep(n) {
			step = n;
			if (n === 2) goSheet(0);
			if (n === 3) goToStageSheet(stageIdx);
			if (n === 4) goSheet(0);
			renderTabs();
			renderStep();
		}

		function group(label, content) {
			return h('div.clc-group', {}, [h('label.clc-label', { text: label }), content]);
		}

		function swatches(key, list) {
			var w = h('div.clc-swatches');
			(list || []).forEach(function (c) {
				w.appendChild(h('button.clc-swatch' + (child[key] === c.hex ? '.active' : ''), { type: 'button', title: c.label, 'aria-label': c.label, style: 'background:' + c.hex, onclick: function () { child[key] = c.hex; refreshAvatar(); } }));
			});
			return w;
		}

		function pills(options, value, onPick) {
			return h('div.clc-pills', {}, options.map(function (o) {
				return h('button.clc-pill' + (value === o[0] ? '.active' : ''), { type: 'button', text: o[1], onclick: function () { onPick(o[0]); } });
			}));
		}

		function thumb(sheet, selection, w, hgt) {
			var c = h('canvas', { width: w, height: hgt });
			drawSheet(c, sheet, selection);
			return c;
		}

		function stepChild() {
			var name = h('input.clc-input', { type: 'text', maxlength: 22, placeholder: 'Es. Sofia, Leonardo…' });
			name.value = child.name;
			name.addEventListener('input', function () { child.name = name.value; drawPreview(); });
			var pal = cat.palettes || {};
			return [
				group('Nome del bambino o della bambina', name),
				group('È un bambino o una bambina?', pills([['M', 'Bambino'], ['F', 'Bambina']], child.gender, function (v) { child.gender = v; drawPreview(); renderStep(); })),
				group('Capelli', pills(cat.hair_styles.map(function (x) { return [x.id, x.label]; }), child.hairStyle, function (v) { child.hairStyle = v; refreshAvatar(); })),
				group('Colore dei capelli', swatches('hairColor', pal.hair)),
				group('Carnagione', swatches('skinColor', pal.skin)),
				group('Colore degli occhi', swatches('eyeColor', pal.eyes)),
				group('Colore della maglietta', swatches('shirtColor', pal.shirt)),
				group('Occhiali', pills([['none', 'Nessuno'], ['round', 'Tondi']], child.glasses, function (v) { child.glasses = v; refreshAvatar(); })),
				h('button.clc-btn', { type: 'button', text: 'Avanti: scegli l\'ambientazione →', onclick: function () { setStep(2); } })
			];
		}

		function stepSetting() {
			var grid = h('div.clc-cards.is-square');
			cat.settings.forEach(function (s) {
				var tsel = Object.assign({}, sel, { setting: s.id });
				grid.appendChild(h('button.clc-card' + (sel.setting === s.id ? '.active' : ''), { type: 'button', onclick: function () {
					sel = E.selectionIds(cat, Object.assign({}, sel, { setting: s.id }));
					goSheet(0);
					renderStep();
				} }, [
					thumb({ kind: 'cover', label: '' }, tsel, 360, 180),
					h('strong', { text: s.label }),
					s.description ? h('span', { text: s.description }) : null
				]));
			});
			return [
				h('p.clc-intro', { text: 'Dove si svolge la storia? L\'ambientazione decide la copertina e il mondo in cui vive il protagonista.' }),
				grid,
				h('button.clc-btn', { type: 'button', text: 'Avanti: componi la storia →', onclick: function () { stageIdx = 0; setStep(3); } })
			];
		}

		function stepStory() {
			var stages = cat.stages;
			var st = stages[stageIdx];
			var list = st.blocks.filter(function (b) { return E.blockAvailable(b, sel.setting); });
			var progress = h('div.clc-progress', {}, stages.map(function (x, i) {
				return h('button.clc-dot' + (i === stageIdx ? '.current' : '') + (chosen[x.id] ? '.done' : ''), { type: 'button', title: x.label, text: String(i + 1), onclick: function () { stageIdx = i; goToStageSheet(i); renderStep(); } });
			}));
			var grid = h('div.clc-cards');
			list.forEach(function (b) {
				var tsel = JSON.parse(JSON.stringify(sel));
				tsel.blocks[st.id] = b.id;
				grid.appendChild(h('button.clc-card' + (sel.blocks[st.id] === b.id ? '.active' : ''), { type: 'button', onclick: function () {
					sel.blocks[st.id] = b.id;
					chosen[st.id] = true;
					goToStageSheet(stageIdx);
					renderStep();
				} }, [
					thumb({ kind: 'story', stageIndex: stageIdx, stageId: st.id, spread: 0 }, tsel, 360, 180),
					h('strong', { text: b.label }),
					b.description ? h('span', { text: b.description }) : null
				]));
			});
			var last = stageIdx === stages.length - 1;
			return [
				progress,
				h('p.clc-stage-title', {}, [h('strong', { text: 'Tappa ' + (stageIdx + 1) + ' di ' + stages.length + ': ' }), st.label]),
				grid,
				h('div.clc-row', {}, [
					stageIdx > 0 ? h('button.clc-btn-ghost', { type: 'button', text: '← Tappa precedente', onclick: function () { stageIdx--; goToStageSheet(stageIdx); renderStep(); } }) : h('span'),
					h('button.clc-btn', { type: 'button', text: last ? 'Avanti: scegli il formato →' : 'Tappa successiva →', onclick: function () {
						chosen[st.id] = true;
						if (last) { setStep(4); return; }
						stageIdx++;
						goToStageSheet(stageIdx);
						renderStep();
					} })
				])
			];
		}

		function stepFormat() {
			var grid = h('div.clc-formats');
			cat.formats.forEach(function (f) {
				grid.appendChild(h('button.clc-format' + (sel.format === f.id ? '.active' : ''), { type: 'button', onclick: function () { sel.format = f.id; renderStep(); } }, [
					h('strong', { text: f.label }),
					f.description ? h('span', { text: f.description }) : null,
					h('em', { text: money(f.price) })
				]));
			});
			var fmt = E.getFormat(cat, sel.format);
			var missing = cat.stages.filter(function (s) { return !chosen[s.id]; });
			var feedback = h('div.clc-feedback');
			var buy = h('button.clc-btn.clc-buy', { type: 'button', text: 'Aggiungi al carrello · ' + money(fmt ? fmt.price : 0) });
			buy.addEventListener('click', function () {
				if (!child.name.trim()) {
					feedback.textContent = 'Manca il nome del protagonista: lo trovi al passo 1.';
					feedback.className = 'clc-feedback error';
					return;
				}
				buy.disabled = true;
				buy.textContent = 'Un attimo…';
				var fd = new FormData();
				fd.append('action', 'crealibro_add_to_cart');
				fd.append('nonce', D.nonce);
				fd.append('avatar_png', baked ? baked.dataUrl : '');
				fd.append('config', JSON.stringify({ child: child, selection: E.selectionIds(cat, sel) }));
				fetch(D.ajaxUrl, { method: 'POST', body: fd, credentials: 'same-origin' })
					.then(function (r) { return r.json(); })
					.then(function (res) {
						buy.disabled = false;
						buy.textContent = 'Aggiungi al carrello · ' + money(fmt ? fmt.price : 0);
						if (res.success) {
							feedback.innerHTML = '';
							feedback.appendChild(document.createTextNode('✅ ' + res.data.message + ' '));
							feedback.appendChild(h('a', { href: res.data.cart_url, text: 'Vai al carrello →' }));
							feedback.className = 'clc-feedback success';
						} else {
							feedback.textContent = '⚠️ ' + (res.data && res.data.message ? res.data.message : 'Si è verificato un errore.');
							feedback.className = 'clc-feedback error';
						}
					})
					.catch(function () {
						buy.disabled = false;
						buy.textContent = 'Aggiungi al carrello · ' + money(fmt ? fmt.price : 0);
						feedback.textContent = '⚠️ Errore di connessione, riprova.';
						feedback.className = 'clc-feedback error';
					});
			});
			var r = E.resolveSelection(cat, sel);
			return [
				group('Scegli il formato', grid),
				h('div.clc-summary', {}, [
					h('p', {}, [h('strong', { text: 'Protagonista: ' }), child.name.trim() || '—']),
					h('p', {}, [h('strong', { text: 'Ambientazione: ' }), r.setting ? r.setting.label : '']),
					h('ol', {}, cat.stages.map(function (s) { var b = r.blocks[s.id]; return h('li', { text: s.label + ': ' + (b ? b.label : '') }); })),
					missing.length ? h('p.clc-note', { text: 'Non hai ancora guardato ' + missing.length + ' tappe: per quelle useremo la prima scelta. Puoi tornare al passo 3 per cambiarle.' }) : null
				]),
				buy,
				feedback
			];
		}

		function renderStep() {
			panel.innerHTML = '';
			var content = ({ 1: stepChild, 2: stepSetting, 3: stepStory, 4: stepFormat })[step]();
			content.forEach(function (c) { panel.appendChild(c); });
		}

		renderTabs();
		renderStep();
		drawPreview();
		refreshAvatar();
	}

	if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
	else init();
})();
