(function () {
	'use strict';

	if (typeof ProppStudioData === 'undefined') return;

	const manifest = ProppStudioData.manifest;

	// Cache in memoria per le illustrazioni caricate dalla Libreria Media di WordPress
	const mediaCache = {};

	// Stato reattivo dell'utente
	const state = {
		currentPage: 0, // 0: Copertina, 1: Ambiente, 2: Donatore, 3: Oggetto Magico, 4: Sfida, 5: Ritorno
		showBleed: false,
		bakedAvatarImg: null,
		bakedAvatarDataUrl: '',
		child: {
			name: 'Giorgio',
			gender: 'M',
			skinColor: (manifest.palettes.skin[0] && manifest.palettes.skin[0].hex) || '#FAD7B8',
			hairStyle: (manifest.hair_styles[0] && manifest.hair_styles[0].id) || 'short_tuft',
			hairColor: (manifest.palettes.hair[0] && manifest.palettes.hair[0].hex) || '#4A2511',
			eyeColor: (manifest.palettes.eyes[0] && manifest.palettes.eyes[0].hex) || '#2980B9',
			shirtColor: (manifest.palettes.shirt[0] && manifest.palettes.shirt[0].hex) || '#E11D48',
			glasses: 'none'
		},
		story: {
			'1_setting': manifest.propp_categories[0].options[0].id,
			'2_donor': manifest.propp_categories[1].options[0].id,
			'3_magic_item': manifest.propp_categories[2].options[0].id,
			'4_antagonist': manifest.propp_categories[3].options[0].id
		}
	};

	/**
	 * 0. GESTIONE IMMAGINI ESTERNE (Sfondi 20x20 e PNG Oggetti Magici da WP Media)
	 */
	function getLoadedImage(url, onLoadCallback) {
		if (!url || typeof url !== 'string' || url.trim() === '') return null;
		const cleanUrl = url.trim();

		if (mediaCache[cleanUrl]) {
			if (mediaCache[cleanUrl].loaded) {
				return mediaCache[cleanUrl].img;
			}
			return null;
		}

		const img = new Image();
		img.crossOrigin = 'anonymous';
		mediaCache[cleanUrl] = { img: img, loaded: false, error: false };

		img.onload = function () {
			mediaCache[cleanUrl].loaded = true;
			if (typeof onLoadCallback === 'function') {
				onLoadCallback();
			}
		};

		img.onerror = function () {
			mediaCache[cleanUrl].error = true;
		};

		img.src = cleanUrl;
		return null;
	}

	function preloadSingleImagePromise(url) {
		return new Promise((resolve) => {
			if (!url || typeof url !== 'string' || url.trim() === '') {
				resolve(null);
				return;
			}
			const cleanUrl = url.trim();
			if (mediaCache[cleanUrl] && mediaCache[cleanUrl].loaded) {
				resolve(mediaCache[cleanUrl].img);
				return;
			}
			const img = new Image();
			img.crossOrigin = 'anonymous';
			img.onload = function () {
				mediaCache[cleanUrl] = { img: img, loaded: true, error: false };
				resolve(img);
			};
			img.onerror = function () {
				mediaCache[cleanUrl] = { img: null, loaded: false, error: true };
				resolve(null);
			};
			img.src = cleanUrl;
		});
	}

	async function preloadStoryImages(storySelections) {
		const opt1 = getSelectedOption('1_setting', storySelections['1_setting']);
		const opt2 = getSelectedOption('2_donor', storySelections['2_donor']);
		const opt3 = getSelectedOption('3_magic_item', storySelections['3_magic_item']);
		const opt4 = getSelectedOption('4_antagonist', storySelections['4_antagonist']);

		const urlsToLoad = [
			opt1 && opt1.bg_image,
			opt2 && opt2.bg_image,
			opt3 && opt3.bg_image,
			opt3 && opt3.prop_image,
			opt4 && opt4.bg_image
		];

		await Promise.all(urlsToLoad.map(u => preloadSingleImagePromise(u)));
	}

	/**
	 * 1. AVATAR PNG BAKER
	 * Compone i livelli vettoriali del bambino con i colori dinamici e produce un PNG scontornato 1000x1000
	 */
	function buildAvatarSVGString(child) {
		const hairObj = manifest.hair_styles.find(h => h.id === child.hairStyle) || manifest.hair_styles[0];
		const hairMarkup = hairObj
			? hairObj.svg.replace(/class="fill-hair"/g, `fill="${child.hairColor}"`)
			: '';

		const glassesMarkup = child.glasses === 'round'
			? `<g stroke="#1E293B" stroke-width="14" fill="rgba(255,255,255,0.25)">
				<circle cx="420" cy="395" r="52"/>
				<circle cx="580" cy="395" r="52"/>
				<line x1="472" y1="395" x2="528" y2="395"/>
			   </g>`
			: '';

		return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" width="1000" height="1000">
			<!-- Ombra a terra morbida -->
			<ellipse cx="500" cy="915" rx="190" ry="34" fill="rgba(0,0,0,0.18)"/>
			<!-- Gambe e Scarpe -->
			<rect x="415" y="720" width="58" height="165" rx="26" fill="#1E293B"/>
			<rect x="527" y="720" width="58" height="165" rx="26" fill="#1E293B"/>
			<ellipse cx="435" cy="890" rx="48" ry="26" fill="#F8FAFC"/>
			<ellipse cx="565" cy="890" rx="48" ry="26" fill="#F8FAFC"/>
			<!-- Braccia (Pelle) -->
			<path d="M350,535 Q255,610 285,695" stroke="${child.skinColor}" stroke-width="64" stroke-linecap="round" fill="none"/>
			<path d="M650,535 Q745,595 735,480" stroke="${child.skinColor}" stroke-width="64" stroke-linecap="round" fill="none"/>
			<!-- Busto / Maglietta -->
			<path d="M335,515 C335,470 665,470 665,515 L695,745 C695,765 305,765 305,745 Z" fill="${child.shirtColor}"/>
			<!-- Stella decorativa sulla maglietta -->
			<polygon points="500,565 516,600 555,605 526,632 534,670 500,650 466,670 474,632 445,605 484,600" fill="rgba(255,255,255,0.65)"/>
			<!-- Collo e Orecchie -->
			<rect x="455" y="445" width="90" height="80" rx="30" fill="${child.skinColor}"/>
			<circle cx="295" cy="395" r="38" fill="${child.skinColor}"/>
			<circle cx="705" cy="395" r="38" fill="${child.skinColor}"/>
			<!-- Viso Base -->
			<ellipse cx="500" cy="375" rx="198" ry="182" fill="${child.skinColor}"/>
			<!-- Guance rosate -->
			<ellipse cx="370" cy="435" rx="32" ry="18" fill="rgba(244,63,94,0.28)"/>
			<ellipse cx="630" cy="435" rx="32" ry="18" fill="rgba(244,63,94,0.28)"/>
			<!-- Occhi -->
			<circle cx="420" cy="390" r="26" fill="#FFFFFF"/>
			<circle cx="580" cy="390" r="26" fill="#FFFFFF"/>
			<circle cx="420" cy="390" r="16" fill="${child.eyeColor}"/>
			<circle cx="580" cy="390" r="16" fill="${child.eyeColor}"/>
			<circle cx="426" cy="384" r="6" fill="#FFFFFF"/>
			<circle cx="586" cy="384" r="6" fill="#FFFFFF"/>
			<!-- Sorriso e Nasino -->
			<path d="M488,415 Q500,428 512,415" stroke="rgba(0,0,0,0.35)" stroke-width="7" stroke-linecap="round" fill="none"/>
			<path d="M445,462 Q500,508 555,462" stroke="#881337" stroke-width="11" stroke-linecap="round" fill="none"/>
			<!-- Occhiali opzionali -->
			${glassesMarkup}
			<!-- Acconciatura scelta -->
			${hairMarkup}
		</svg>`;
	}

	function bakeAvatarPNG(childConfig) {
		return new Promise((resolve) => {
			const svgString = buildAvatarSVGString(childConfig);
			const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
			const url = URL.createObjectURL(svgBlob);
			const img = new Image();

			img.onload = function () {
				const offCanvas = document.createElement('canvas');
				offCanvas.width = 1000;
				offCanvas.height = 1000;
				const ctx = offCanvas.getContext('2d');
				ctx.clearRect(0, 0, 1000, 1000);
				ctx.drawImage(img, 0, 0, 1000, 1000);
				URL.revokeObjectURL(url);

				const pngDataUrl = offCanvas.toDataURL('image/png');
				const bakedImg = new Image();
				bakedImg.onload = function () {
					resolve({ imgElement: bakedImg, dataUrl: pngDataUrl });
				};
				bakedImg.src = pngDataUrl;
			};
			img.src = url;
		});
	}

	/**
	 * 2. MOTORE TESTUALE DI PROPP (Declinazione di genere + variabili incrociate)
	 */
	function getSelectedOption(stepKey, selectedId) {
		const cat = manifest.propp_categories.find(c => c.step_key === stepKey);
		if (!cat || !cat.options || !cat.options.length) return null;
		return cat.options.find(o => o.id === selectedId) || cat.options[0];
	}

	function resolveProppTokens(template, child, storySelections) {
		if (!template) return '';
		const isF = child.gender === 'F';
		const opt1 = getSelectedOption('1_setting', storySelections['1_setting']);
		const opt2 = getSelectedOption('2_donor', storySelections['2_donor']);
		const opt3 = getSelectedOption('3_magic_item', storySelections['3_magic_item']);
		const opt4 = getSelectedOption('4_antagonist', storySelections['4_antagonist']);

		const dictionary = Object.assign(
			{},
			opt1 ? opt1.tokens : {},
			opt2 ? opt2.tokens : {},
			opt3 ? opt3.tokens : {},
			opt4 ? opt4.tokens : {},
			{
				nome: (child.name && child.name.trim()) ? child.name.trim() : 'Giorgio',
				o_a: isF ? 'a' : 'o',
				il_la: isF ? 'la' : 'il',
				un_una: isF ? 'una' : 'un',
				e_trice: isF ? 'trice' : 'e',
				e_ina: isF ? 'ina' : 'e'
			}
		);

		let output = template;
		for (let pass = 0; pass < 2; pass++) {
			output = output.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key) => {
				return typeof dictionary[key] !== 'undefined' ? dictionary[key] : match;
			});
		}
		return output;
	}

	/**
	 * 3. SCENE COMPOSITOR 20x20
	 * Disegna lo sfondo (illustrazione WP Media o vettoriale di fallback), il PNG del bimbo, l'oggetto magico e i testi
	 */
	function renderBookPageToCanvas(canvas, pageIndex, child, story, bakedAvatarImg) {
		if (!canvas) return;
		const ctx = canvas.getContext('2d');
		const W = canvas.width;
		const H = canvas.height;
		ctx.clearRect(0, 0, W, H);

		const opt1 = getSelectedOption('1_setting', story['1_setting']);
		const opt2 = getSelectedOption('2_donor', story['2_donor']);
		const opt3 = getSelectedOption('3_magic_item', story['3_magic_item']);
		const opt4 = getSelectedOption('4_antagonist', story['4_antagonist']);

		if (!opt1 || !opt2 || !opt3 || !opt4) return;

		const pages = [
			{
				title: resolveProppTokens('{nome} e {item_name}', child, story),
				subtitle: resolveProppTokens('Un\'avventura in {place_name}', child, story),
				isCover: true,
				bgImage: opt1.bg_image || '',
				sky: opt1.bg_sky || '#DCFCE7',
				ground: opt1.bg_ground || '#15803D',
				decor: opt1.bg_decor || 'trees',
				avatarSlot: { x: 50, y: 58, scale: 0.56, rotation: 0 },
				propSlot: { x: 70, y: 56, scale: 0.22 },
				text: ''
			},
			{
				label: 'Capitolo 1 • L\'Ambiente',
				bgImage: opt1.bg_image || '',
				sky: opt1.bg_sky || '#DCFCE7',
				ground: opt1.bg_ground || '#15803D',
				decor: opt1.bg_decor || 'trees',
				avatarSlot: opt1.avatar_slot || { x: 50, y: 54, scale: 0.5, rotation: 0 },
				propSlot: null,
				text: resolveProppTokens(opt1.tokens ? opt1.tokens.intro_text : '', child, story)
			},
			{
				label: 'Capitolo 2 • Il Donatore',
				bgImage: opt2.bg_image || '',
				sky: opt2.bg_sky || '#FEF3C7',
				ground: opt2.bg_ground || '#B45309',
				decor: opt2.bg_decor || 'trees',
				avatarSlot: opt2.avatar_slot || { x: 36, y: 55, scale: 0.47, rotation: 0 },
				propSlot: null,
				donorNpc: opt2.id,
				text: resolveProppTokens(opt2.tokens ? opt2.tokens.donor_text : '', child, story)
			},
			{
				label: 'Capitolo 3 • Il Mezzo Magico',
				bgImage: opt3.bg_image || '',
				sky: opt3.bg_sky || '#E0E7FF',
				ground: opt3.bg_ground || '#3730A3',
				decor: 'stars',
				avatarSlot: opt3.avatar_slot || { x: 45, y: 54, scale: 0.49, rotation: 0 },
				propSlot: opt3.prop_slot || { x: 64, y: 55, scale: 0.20 },
				text: resolveProppTokens(opt3.tokens ? opt3.tokens.item_gift : '', child, story)
			},
			{
				label: 'Capitolo 4 • La Sfida',
				bgImage: opt4.bg_image || '',
				sky: opt4.bg_sky || '#FEE2E2',
				ground: opt4.bg_ground || '#991B1B',
				decor: opt1.bg_decor || 'trees',
				avatarSlot: opt4.avatar_slot || { x: 35, y: 56, scale: 0.46, rotation: -4 },
				propSlot: opt4.prop_slot || { x: 53, y: 52, scale: 0.22 },
				villainNpc: opt4.id,
				text: resolveProppTokens(opt4.tokens ? opt4.tokens.climax_text : '', child, story)
			},
			{
				label: 'Capitolo 5 • Il Ritorno',
				bgImage: opt1.bg_image || '',
				sky: opt1.bg_sky || '#DCFCE7',
				ground: opt1.bg_ground || '#15803D',
				decor: opt1.bg_decor || 'trees',
				avatarSlot: { x: 50, y: 53, scale: 0.50, rotation: 0 },
				propSlot: { x: 67, y: 54, scale: 0.19 },
				text: resolveProppTokens(opt4.tokens ? opt4.tokens.ending_text : '', child, story)
			}
		];

		const p = pages[pageIndex] || pages[0];

		// 1. Disegna lo Sfondo: usa l'illustrazione 20x20 caricata in WP Media, altrimenti il paesaggio vettoriale
		const customBg = getLoadedImage(p.bgImage, () => {
			renderBookPageToCanvas(canvas, pageIndex, child, story, bakedAvatarImg);
		});

		if (customBg) {
			ctx.drawImage(customBg, 0, 0, W, H);
		} else {
			ctx.fillStyle = p.sky;
			ctx.fillRect(0, 0, W, H);

			drawEnvironmentDecor(ctx, W, H, p.decor, p.ground);

			ctx.fillStyle = p.ground;
			ctx.beginPath();
			ctx.moveTo(0, H * 0.64);
			ctx.quadraticCurveTo(W * 0.5, H * 0.56, W, H * 0.65);
			ctx.lineTo(W, H);
			ctx.lineTo(0, H);
			ctx.closePath();
			ctx.fill();

			// Disegna Donatore o Antagonista di fallback solo se non c'è una tavola illustrata custom
			if (p.donorNpc) {
				drawSceneCharacter(ctx, W * 0.70, H * 0.50, W * 0.22, p.donorNpc);
			}
			if (p.villainNpc) {
				drawSceneCharacter(ctx, W * 0.73, H * 0.48, W * 0.28, p.villainNpc);
			}
		}

		// 2. Iniezione del PNG SCONTORNATO del Bambino (Baked Avatar PNG)
		if (bakedAvatarImg && p.avatarSlot) {
			ctx.save();
			const cx = (Number(p.avatarSlot.x) / 100) * W;
			const cy = (Number(p.avatarSlot.y) / 100) * H;
			const size = Number(p.avatarSlot.scale) * W;
			ctx.translate(cx, cy);
			if (p.avatarSlot.rotation) {
				ctx.rotate((Number(p.avatarSlot.rotation) * Math.PI) / 180);
			}
			ctx.drawImage(bakedAvatarImg, -size / 2, -size / 2, size, size);
			ctx.restore();
		}

		// 3. Oggetto Magico di Propp (PNG custom caricato da WP Media oppure icona vettoriale di fallback)
		if (p.propSlot && opt3) {
			const propX = (Number(p.propSlot.x) / 100) * W;
			const propY = (Number(p.propSlot.y) / 100) * H;
			const propSize = Number(p.propSlot.scale) * W;

			const customPropImg = getLoadedImage(opt3.prop_image, () => {
				renderBookPageToCanvas(canvas, pageIndex, child, story, bakedAvatarImg);
			});

			if (customPropImg) {
				ctx.save();
				ctx.drawImage(customPropImg, propX - propSize / 2, propY - propSize / 2, propSize, propSize);
				ctx.restore();
			} else {
				drawMagicProp(ctx, propX, propY, propSize, opt3);
			}
		}

		// 4. Tipografia Copertina o Box Narrativo
		if (p.isCover) {
			ctx.fillStyle = 'rgba(255,255,255,0.92)';
			roundRect(ctx, W * 0.08, H * 0.07, W * 0.84, H * 0.20, W * 0.025);
			ctx.fill();

			ctx.fillStyle = '#0F172A';
			ctx.textAlign = 'center';
			ctx.font = `bold ${Math.round(W * 0.045)}px "Georgia", serif`; 		ctx.fillText(p.title, W * 0.5, H * 0.155, W * 0.78);  		ctx.fillStyle = '#475569'; 		ctx.font = `italic ${Math.round(W * 0.028)}px "Georgia", serif`;
			ctx.fillText(p.subtitle, W * 0.5, H * 0.22);
		} else {
			ctx.fillStyle = 'rgba(255,255,255,0.94)';
			roundRect(ctx, W * 0.07, H * 0.73, W * 0.86, H * 0.20, W * 0.02);
			ctx.fill();

			ctx.fillStyle = '#1E293B';
			ctx.textAlign = 'left';
			ctx.font = `${Math.round(W * 0.029)}px "Georgia", serif`; 		wrapText(ctx, p.text, W * 0.11, H * 0.79, W * 0.78, Math.round(W * 0.042));  		ctx.fillStyle = '#64748B'; 		ctx.textAlign = 'right'; 		ctx.font = `bold ${Math.round(W * 0.02)}px sans-serif`;
			ctx.fillText(`Pag. ${pageIndex}`, W * 0.90, H * 0.905); 	} }  function drawEnvironmentDecor(ctx, W, H, type, accentColor) { 	ctx.save(); 	if (type === 'stars') { 		ctx.fillStyle = 'rgba(255,255,255,0.75)'; 		[[0.15, 0.18], [0.82, 0.14], [0.65, 0.28], [0.25, 0.35], [0.88, 0.38], [0.45, 0.12]].forEach(([rx, ry], i) => { 			ctx.beginPath(); 			ctx.arc(W * rx, H * ry, (i \% 2 + 1) * (W * 0.006), 0, Math.PI * 2); 			ctx.fill(); 		}); 	} else if (type === 'trees') { 		ctx.fillStyle = accentColor; 		ctx.globalAlpha = 0.35; 		[[0.16, 0.52, 0.12], [0.84, 0.50, 0.14], [0.28, 0.56, 0.09]].forEach(([rx, ry, r]) => { 			ctx.beginPath(); 			ctx.arc(W * rx, H * ry, W * r, 0, Math.PI * 2); 			ctx.fill(); 		}); 	} else if (type === 'waves') { 		ctx.strokeStyle = 'rgba(255,255,255,0.55)'; 		ctx.lineWidth = W * 0.01; 		ctx.beginPath(); 		ctx.arc(W * 0.8, H * 0.22, W * 0.08, 0, Math.PI * 2); 		ctx.stroke(); 	} 	ctx.restore(); }  function drawMagicProp(ctx, x, y, size, propOption) { 	ctx.save(); 	ctx.translate(x, y); 	ctx.fillStyle = 'rgba(255,255,255,0.45)'; 	ctx.beginPath(); 	ctx.arc(0, 0, size * 0.52, 0, Math.PI * 2); 	ctx.fill();  	ctx.fillStyle = propOption.prop_color \vert{}\vert{} '#FACC15'; 	ctx.strokeStyle = '#1E293B'; 	ctx.lineWidth = size * 0.05; 	if (propOption.prop_shape === 'lantern') { 		ctx.beginPath(); 		ctx.arc(0, 0, size * 0.32, 0, Math.PI * 2); 		ctx.fill(); 		ctx.stroke(); 	} else { 		ctx.fillRect(-size * 0.12, -size * 0.32, size * 0.24, size * 0.64); 		ctx.strokeRect(-size * 0.12, -size * 0.32, size * 0.24, size * 0.64); 	} 	ctx.restore(); }  function drawSceneCharacter(ctx, x, y, size, npcId) { 	ctx.save(); 	ctx.translate(x, y); 	ctx.fillStyle = (npcId && (npcId.includes('dragon') \vert{}\vert{} npcId.includes('giant'))) ? '#7C3AED' : '#D97706'; 	ctx.beginPath(); 	ctx.arc(0, 0, size * 0.45, 0, Math.PI * 2); 	ctx.fill(); 	ctx.fillStyle = '#FFFFFF'; 	ctx.beginPath(); 	ctx.arc(-size * 0.14, -size * 0.08, size * 0.09, 0, Math.PI * 2); 	ctx.arc(size * 0.14, -size * 0.08, size * 0.09, 0, Math.PI * 2); 	ctx.fill(); 	ctx.fillStyle = '#0F172A'; 	ctx.beginPath(); 	ctx.arc(-size * 0.14, -size * 0.08, size * 0.04, 0, Math.PI * 2); 	ctx.arc(size * 0.14, -size * 0.08, size * 0.04, 0, Math.PI * 2); 	ctx.fill(); 	ctx.restore(); }  function roundRect(ctx, x, y, w, h, r) { 	ctx.beginPath(); 	ctx.moveTo(x + r, y); 	ctx.arcTo(x + w, y, x + w, y + h, r); 	ctx.arcTo(x + w, y + h, x, y + h, r); 	ctx.arcTo(x, y + h, x, y, r); 	ctx.arcTo(x, y, x + w, y, r); 	ctx.closePath(); }  function wrapText(ctx, text, x, y, maxWidth, lineHeight) { 	const words = String(text \vert{}\vert{} '').split(' '); 	let line = ''; 	let testY = y; 	for (let n = 0; n < words.length; n++) { 		const testLine = line + words[n] + ' '; 		if (ctx.measureText(testLine).width > maxWidth && n > 0) { 			ctx.fillText(line.trim(), x, testY); 			line = words[n] + ' '; 			testY += lineHeight; 		} else { 			line = testLine; 		} 	} 	ctx.fillText(line.trim(), x, testY); }  /**  * 4. COMPILATORE PDF 1.4 PURO (Zero librerie esterne, formato esatto 206x206 mm con 3mm bleed)  */ function buildMultiPagePdfFromJpegs(jpegPages, widthMm, heightMm) { 	const ptW = (widthMm * 72 / 25.4).toFixed(2); // 206mm = 583.94 pt 	const ptH = (heightMm * 72 / 25.4).toFixed(2); 	const chunks = []; 	const offsets = []; 	let byteLength = 0; 	const encoder = new TextEncoder();  	function pushStr(str) { 		const bytes = encoder.encode(str); 		chunks.push(bytes); 		byteLength += bytes.length; 	} 	function pushBin(uint8) { 		chunks.push(uint8); 		byteLength += uint8.length; 	} 	function startObj(id) { 		offsets[id] = byteLength; 		pushStr(`${id} 0 obj\n`);
		}

		pushStr('%PDF-1.4\n%\xFF\xFF\xFF\xFF\n');

		const numPages = jpegPages.length;
		const kidsIds = [];
		for (let i = 0; i < numPages; i++) {
			kidsIds.push(3 + i * 3);
		}

		startObj(1);
		pushStr('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

		startObj(2);
		pushStr(`<< /Type /Pages /Kids [${kidsIds.map(id => id + ' 0 R').join(' ')}] /Count${numPages} >>\nendobj\n`);

		jpegPages.forEach((page, idx) => {
			const pageObjId = 3 + idx * 3;
			const contentObjId = pageObjId + 1;
			const imgObjId = pageObjId + 2;

			startObj(pageObjId);
			pushStr(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${ptW}${ptH}] /TrimBox [8.50 8.50 ${(ptW - 8.50).toFixed(2)}${(ptH - 8.50).toFixed(2)}] /Resources << /XObject << /Im${idx}${imgObjId} 0 R >> >> /Contents ${contentObjId} 0 R >>\nendobj\n`);  		const streamCmd = `q ${ptW} 0 0 ${ptH} 0 0 cm /Im${idx} Do Q`;
			startObj(contentObjId);
			pushStr(`<< /Length ${streamCmd.length} >>\nstream\n${streamCmd}\nendstream\nendobj\n`);

			startObj(imgObjId);
			pushStr(`<< /Type /XObject /Subtype /Image /Width ${page.width} /Height${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.bytes.length} >>\nstream\n`); 		pushBin(page.bytes); 		pushStr('\nendstream\nendobj\n'); 	});  	const xrefPos = byteLength; 	const totalObjs = 3 + numPages * 3; 	pushStr(`xref\n0 ${totalObjs}\n0000000000 65535 f \n`);
		for (let i = 1; i < totalObjs; i++) {
			pushStr(String(offsets[i]).padStart(10, '0') + ' 00000 n \n');
		}
		pushStr(`trailer\n<< /Size ${totalObjs} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`);

		return new Blob(chunks, { type: 'application/pdf' });
	}

	function dataUrlToUint8Array(dataUrl) {
		const raw = atob(dataUrl.split(',')[1]);
		const arr = new Uint8Array(raw.length);
		for (let i = 0; i < raw.length; i++) {
			arr[i] = raw.charCodeAt(i);
		}
		return arr;
	}

	async function exportPrintReadyPDF(childConfig, storyConfig, resolutionPx = 2433) {
		// Pre-carica in memoria eventuali sfondi e oggetti custom dalla Libreria Media prima di disegnare il PDF
		await preloadStoryImages(storyConfig);
		const baked = await bakeAvatarPNG(childConfig);

		const printCanvas = document.createElement('canvas');
		printCanvas.width = resolutionPx; // 2433 px = 206mm a 300 DPI
		printCanvas.height = resolutionPx;

		const jpegPages = [];
		for (let p = 0; p < 6; p++) {
			renderBookPageToCanvas(printCanvas, p, childConfig, storyConfig, baked.imgElement);
			const jpegUrl = printCanvas.toDataURL('image/jpeg', 0.94);
			jpegPages.push({
				width: resolutionPx,
				height: resolutionPx,
				bytes: dataUrlToUint8Array(jpegUrl)
			});
		}

		const pdfBlob = buildMultiPagePdfFromJpegs(jpegPages, 206, 206);
		const link = document.createElement('a');
		link.href = URL.createObjectURL(pdfBlob);
		const cleanName = (childConfig.name || 'Libro').toLowerCase().replace(/[^a-z0-9]/g, '');
		link.download = `libro-20x20-${cleanName}-206x206mm.pdf`; 	document.body.appendChild(link); 	link.click(); 	document.body.removeChild(link); }  /**  * 5. INIZIALIZZAZIONE INTERFACCIA FRONTEND E ADMIN  */ function initFrontendApp() { 	const app = document.getElementById('propp-studio-app'); 	if (!app) return;  	const mainCanvas = document.getElementById('pbs-scene-canvas'); 	const bakedPreviewImg = document.getElementById('pbs-baked-preview-img'); 	const pageIndicator = document.getElementById('pbs-page-indicator');  	async function refreshAvatarAndScene() { 		const baked = await bakeAvatarPNG(state.child); 		state.bakedAvatarImg = baked.imgElement; 		state.bakedAvatarDataUrl = baked.dataUrl; 		if (bakedPreviewImg) bakedPreviewImg.src = baked.dataUrl; 		redrawCurrentPage(); 	}  	function redrawCurrentPage() { 		renderBookPageToCanvas(mainCanvas, state.currentPage, state.child, state.story, state.bakedAvatarImg); 		const titles = ['Copertina', '1. Situazione Iniziale', '2. Il Donatore', '3. Il Mezzo Magico', '4. La Sfida', '5. Il Ritorno']; 		if (pageIndicator) { 			pageIndicator.textContent = `${titles[state.currentPage]} (${state.currentPage + 1} / 6)`; 		} 	}  	// Selettori acconciature 	const hairGrid = document.getElementById('pbs-hair-style-selector'); 	if (hairGrid) { 		manifest.hair_styles.forEach(style => { 			const btn = document.createElement('button'); 			btn.type = 'button'; 			btn.className = 'pbs-choice-card' + (style.id === state.child.hairStyle ? ' active' : ''); 			btn.textContent = style.label; 			btn.addEventListener('click', () => { 				state.child.hairStyle = style.id; 				hairGrid.querySelectorAll('.pbs-choice-card').forEach(b => b.classList.remove('active')); 				btn.classList.add('active'); 				refreshAvatarAndScene(); 			}); 			hairGrid.appendChild(btn); 		}); 	}  	function renderSwatches(containerId, paletteList, stateKey) { 		const wrap = document.getElementById(containerId); 		if (!wrap \vert{}\vert{} !Array.isArray(paletteList)) return; 		paletteList.forEach(item => { 			const sw = document.createElement('button'); 			sw.type = 'button'; 			sw.className = 'pbs-swatch' + (state.child[stateKey] === item.hex ? ' active' : ''); 			sw.style.backgroundColor = item.hex; 			sw.title = item.label; 			sw.addEventListener('click', () => { 				state.child[stateKey] = item.hex; 				wrap.querySelectorAll('.pbs-swatch').forEach(b => b.classList.remove('active')); 				sw.classList.add('active'); 				refreshAvatarAndScene(); 			}); 			wrap.appendChild(sw); 		}); 	}  	renderSwatches('pbs-skin-color-selector', manifest.palettes.skin, 'skinColor'); 	renderSwatches('pbs-hair-color-selector', manifest.palettes.hair, 'hairColor'); 	renderSwatches('pbs-eye-color-selector', manifest.palettes.eyes, 'eyeColor'); 	renderSwatches('pbs-shirt-color-selector', manifest.palettes.shirt, 'shirtColor');  	// Carte di Propp (Step 2) 	const proppContainer = document.getElementById('pbs-propp-modules-container'); 	function renderProppSelectors() { 		if (!proppContainer) return; 		proppContainer.innerHTML = ''; 		manifest.propp_categories.forEach((cat, idx) => { 			const block = document.createElement('div'); 			block.className = 'pbs-propp-block'; 			const title = document.createElement('h4'); 			title.textContent = cat.title; 			block.appendChild(title);  			const grid = document.createElement('div'); 			grid.className = 'pbs-propp-options'; 			cat.options.forEach(opt => { 				const card = document.createElement('button'); 				card.type = 'button'; 				card.className = 'pbs-choice-card' + (state.story[cat.step_key] === opt.id ? ' active' : ''); 				card.textContent = opt.label; 				card.addEventListener('click', () => { 					state.story[cat.step_key] = opt.id; 					state.currentPage = idx + 1; 					renderProppSelectors(); 					redrawCurrentPage(); 				}); 				grid.appendChild(card); 			}); 			block.appendChild(grid); 			proppContainer.appendChild(block); 		}); 	} 	renderProppSelectors();  	// Input Nome, Sesso, Occhiali 	const nameInput = document.getElementById('pbs-child-name'); 	if (nameInput) { 		nameInput.addEventListener('input', (e) => { 			state.child.name = e.target.value; 			redrawCurrentPage(); 		}); 	}  	document.querySelectorAll('#pbs-gender-selector .pbs-pill').forEach(btn => { 		btn.addEventListener('click', () => { 			document.querySelectorAll('#pbs-gender-selector .pbs-pill').forEach(b => b.classList.remove('active')); 			btn.classList.add('active'); 			state.child.gender = btn.dataset.gender; 			redrawCurrentPage(); 		}); 	});  	document.querySelectorAll('#pbs-glasses-selector .pbs-pill').forEach(btn => { 		btn.addEventListener('click', () => { 			document.querySelectorAll('#pbs-glasses-selector .pbs-pill').forEach(b => b.classList.remove('active')); 			btn.classList.add('active'); 			state.child.glasses = btn.dataset.glasses; 			refreshAvatarAndScene(); 		}); 	});  	// Navigazione Pagine e Tabs 	document.getElementById('pbs-prev-page').addEventListener('click', () => { 		state.currentPage = (state.currentPage - 1 + 6) \% 6; 		redrawCurrentPage(); 	}); 	document.getElementById('pbs-next-page').addEventListener('click', () => { 		state.currentPage = (state.currentPage + 1) \% 6; 		redrawCurrentPage(); 	});  	document.getElementById('pbs-toggle-bleed').addEventListener('change', (e) => { 		document.getElementById('pbs-bleed-guide').style.display = e.target.checked ? 'block' : 'none'; 	});  	function switchStep(stepNum) { 		document.querySelectorAll('.pbs-tab').forEach(t => t.classList.toggle('active', t.dataset.step === String(stepNum))); 		document.getElementById('pbs-step-1').classList.toggle('active', stepNum === 1); 		document.getElementById('pbs-step-2').classList.toggle('active', stepNum === 2); 	}  	document.querySelectorAll('.pbs-tab').forEach(t => { 		t.addEventListener('click', () => switchStep(Number(t.dataset.step))); 	}); 	document.getElementById('pbs-goto-step-2').addEventListener('click', () => switchStep(2));  	// Randomizzatore Propp 	document.getElementById('pbs-randomize-story').addEventListener('click', () => { 		manifest.propp_categories.forEach(cat => { 			if (cat.options && cat.options.length) { 				const rand = cat.options[Math.floor(Math.random() * cat.options.length)]; 				state.story[cat.step_key] = rand.id; 			} 		}); 		renderProppSelectors(); 		redrawCurrentPage(); 	});  	// Scarica PDF 206x206mm di prova direttamente nel browser 	document.getElementById('pbs-download-preview-pdf').addEventListener('click', async function () { 		const originalText = this.textContent; 		this.textContent = 'Generazione PDF 206x206mm in corso...'; 		this.disabled = true; 		await exportPrintReadyPDF(state.child, state.story, 1800); 		this.textContent = originalText; 		this.disabled = false; 	});  	// Aggiunta al Carrello WooCommerce (30,00 €) 	document.getElementById('pbs-add-to-cart-btn').addEventListener('click', function () { 		const btn = this; 		const feedback = document.getElementById('pbs-cart-feedback'); 		btn.disabled = true; 		btn.textContent = 'Salvataggio PNG e creazione ordine...';  		const summaryParts = manifest.propp_categories.map(cat => { 			const opt = getSelectedOption(cat.step_key, state.story[cat.step_key]); 			return opt ? opt.label : ''; 		});  		const payloadConfig = { 			child: state.child, 			story: state.story, 			story_summary: summaryParts.join(' → ') 		};  		const formData = new FormData(); 		formData.append('action', 'propp_add_to_cart'); 		formData.append('nonce', ProppStudioData.nonce); 		formData.append('product_id', ProppStudioData.productId); 		formData.append('avatar_png', state.bakedAvatarDataUrl); 		formData.append('config', JSON.stringify(payloadConfig));  		fetch(ProppStudioData.ajaxUrl, { 			method: 'POST', 			body: formData 		}) 			.then(r => r.json()) 			.then(res => { 				btn.disabled = false; 				btn.textContent = 'Aggiungi al Carrello (30,00 €)'; 				if (res.success) { 					feedback.innerHTML = `✅ ${res.data.message} <a href="${res.data.cart_url}">Vai alla cassa &rarr;</a>`;
						feedback.className = 'pbs-feedback success';
					} else {
						feedback.textContent = '⚠️ ' + (res.data && res.data.message ? res.data.message : 'Errore.');
						feedback.className = 'pbs-feedback error';
					}
				})
				.catch(() => {
					btn.disabled = false;
					btn.textContent = 'Aggiungi al Carrello (30,00 €)';
					feedback.textContent = '⚠️ Errore di connessione col server.';
					feedback.className = 'pbs-feedback error';
				});
		});

		refreshAvatarAndScene();
	}

	// Gestione pulsante "Genera PDF Esecutivo 300 DPI" nel backend Ordini di WooCommerce
	function initAdminOrderButtons() {
		document.querySelectorAll('.propp-admin-print-btn').forEach(btn => {
			btn.addEventListener('click', async function () {
				const cfg = JSON.parse(this.dataset.config);
				const prevLabel = this.textContent;
				this.textContent = 'Rendering 2433x2433px (300 DPI) in corso...';
				this.disabled = true;
				await exportPrintReadyPDF(cfg.child, cfg.story, 2433);
				this.textContent = prevLabel;
				this.disabled = false;
			});
		});
	}

	document.addEventListener('DOMContentLoaded', () => {
		initFrontendApp();
		initAdminOrderButtons();
	});
})();