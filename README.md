# CreaLibro

Plugin WordPress/WooCommerce per libri illustrati personalizzati a doppia pagina.

Per installarlo, copia la cartella `crealibro/` in `wp-content/plugins/`, attivala e inserisci lo shortcode `[crealibro]` nella pagina del configuratore.

## Struttura del libro

| Pagine | Contenuto |
| --- | --- |
| copertina | retro · dorso · fronte (illustrazione dell'ambientazione, bambino e titolo) |
| 1 | pagina singola: titolo e bambino su fondo bianco |
| 2-3 | doppia pagina di rispetto |
| 4-27 | storia: 6 tappe × 1 blocco scelto dal cliente × 2 doppie pagine |
| 28-29 | doppia pagina di rispetto |
| 30 | pagina singola di branding |

Le tappe seguono le quattro fasi della fiaba (equilibrio iniziale, rottura, peripezie, ristabilimento) e si possono aggiungere o togliere: ogni tappa vale 4 pagine.

Il PDF di stampa contiene copertina, risguardo bianco, pagine interne singole con abbondanza e risguardo finale. Misure, prezzo e Product UID di Gelato si impostano per ogni formato.

```
crealibro/
├── crealibro.php            plugin, pannello admin, carrello e ordini
└── assets/
    ├── engine.js            motore di rendering e PDF (condiviso)
    ├── configurator.js/.css configuratore del cliente
    ├── admin.js/.css        editor visuale in wp-admin
    └── order.js             PDF di stampa dalla pagina ordine
```
