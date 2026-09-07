# GeoQuiz – Land des Tages & GeoRankle

Zwei tägliche Geografie-Rätsel als reine Browser-App (HTML/CSS/JS, kein Build,
kein Server, keine Abhängigkeiten). Nachbau von trivi.gg „Daily Country“ und
Geotrivia „GeoRankle“.

## Spielen

`index.html` im Browser öffnen oder den Ordner statisch hosten (z. B. GitHub
Pages). Alles läuft lokal, Fortschritt und Serien liegen im `localStorage`.

## Land des Tages

- Ein geheimes Land pro Tag, für alle gleich (deterministisch aus dem Datum).
- 5 Versuche. Jeder Tipp zeigt Hinweise im Vergleich zum gesuchten Land:
  Kontinent, Einwohner, Fläche, BIP pro Kopf, Zahl der Nachbarländer,
  Küste/Binnenstaat, Flaggenfarben, Sprachen, Währung. Pfeile zeigen die
  Richtung, Gelb heißt „nah dran“ (bis Faktor 2 bzw. ±2 Nachbarn).
- Tolerante Eingabe: deutsche und englische Namen, Aliasse, ohne Akzente.
- Kleinststaaten unter 250.000 Einwohnern sind nie das gesuchte Land.
- Alle bisherigen Rätsel sind über Pfeile oder Auswahl spielbar, der Stand wird pro Rätsel gespeichert. Serie, Statistik, spoilerfreies Emoji-Raster zum Teilen.

## GeoRankle

- 8 Runden, je ein Land. Aus 24 Statistik-Kategorien die wählen, in der das
  Land weltweit am besten platziert ist. Jede Kategorie nur einmal pro Spiel.
- 100 Punkte für die beste noch verfügbare Kategorie, sonst
  `100 · e^(−(Rang − Bestrang)/40)`. Maximum 800.
- Jeden Tag ein neues Rätsel, alle bisherigen bleiben spielbar.

## Daten neu erzeugen

`data.js` (196 Länder: UN-Mitglieder plus Taiwan und Kosovo) wird aus offenen
Quellen gebaut:

- [mledoze/countries](https://github.com/mledoze/countries) – Namen,
  Übersetzungen, Grenzen, Sprachen, Währungen, Fläche
- [factbook/factbook.json](https://github.com/factbook/factbook.json) – CIA
  World Factbook (Bevölkerung, BIP, Lebenserwartung, Küste, CO₂ …)
- [lipis/flag-icons](https://github.com/lipis/flag-icons) – Flaggen als SVG

```bash
git clone --depth 1 https://github.com/factbook/factbook.json /tmp/factbook
git clone --depth 1 https://github.com/lipis/flag-icons /tmp/flag-icons
curl -o /tmp/countries.json https://raw.githubusercontent.com/mledoze/countries/master/countries.json

# Flaggenfarben (rastert die SVGs in headless Chromium)
python3 tools/flag_colors.py --countries /tmp/countries.json \
    --flags /tmp/flag-icons/flags/4x3 --chrome "$(which chromium)" --out tools/flagcolors.json

python3 tools/build_data.py --countries /tmp/countries.json --factbook /tmp/factbook \
    --flags /tmp/flag-icons/flags/4x3 --colors tools/flagcolors.json --out data.js
```
