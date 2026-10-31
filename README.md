# Propp Book Studio

Plugin WordPress/WooCommerce per libri illustrati personalizzati 20x20 cm.

Per installarlo, copia la cartella `propp-book-studio/` in `wp-content/plugins/` e attivalo.

```
propp-book-studio/
├── propp-book-studio.php   plugin, pannello admin, carrello e ordini
└── assets/
    ├── studio.js           motore di rendering condiviso + configuratore del cliente
    ├── studio.css          stile del configuratore (shortcode [propp_book_editor])
    ├── admin.js            editor visuale delle scene in wp-admin
    └── admin.css           stile del pannello admin
```

Il pannello **Propp Studio** in wp-admin mostra accanto a ogni opzione un'anteprima della tavola,
disegnata con lo stesso motore del configuratore: bambino, oggetto magico e personaggi si
posizionano trascinandoli, e il risultato si controlla tavola per tavola nella scheda
"Anteprima del libro".
