/**
 * CreaLibro — pulsante "Genera PDF di stampa" nella pagina ordine di WooCommerce.
 * Usa la fotografia del catalogo salvata nell'ordine, quindi il libro stampato
 * è quello scelto dal cliente anche se nel frattempo il catalogo è cambiato.
 */
(function () {
	'use strict';
	var E = window.CreaLibroEngine;
	if (!E) return;

	document.addEventListener('click', function (e) {
		var btn = e.target.closest('.crealibro-print-btn');
		if (!btn) return;
		e.preventDefault();
		var status = btn.parentElement.querySelector('.crealibro-print-status');
		var data;
		try {
			data = JSON.parse(btn.dataset.order);
		} catch (err) {
			status.textContent = 'Dati dell\'ordine non leggibili.';
			return;
		}
		btn.disabled = true;
		status.textContent = 'Generazione in corso: può richiedere qualche decina di secondi…';
		// Lascia al browser il tempo di mostrare il messaggio prima del calcolo
		setTimeout(function () {
			E.exportPrintPDF(data.snapshot, data.selection, data.child, { dpi: 300 })
				.then(function (res) {
					status.textContent = 'PDF pronto: ' + res.pageCount + ' pagine nel file (copertina e risguardi compresi).';
					btn.disabled = false;
				})
				.catch(function (err) {
					status.textContent = 'Errore: ' + (err && err.message ? err.message : err);
					btn.disabled = false;
				});
		}, 50);
	});
})();
