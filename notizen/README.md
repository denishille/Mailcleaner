# Notizen aufräumen — Apple Notizen

Dasselbe Prinzip wie beim Postfach, eine Ebene höher: erst schauen, was da
ist, dann eine Struktur festlegen, dann sortieren. Zwei Skripte, beide laufen
**lokal auf dem Mac** über Apple Notizen. Kein Login, keine Cloud, kein Export.

Weil Notizen bei iCloud-Konten jede Verschiebung synchronisiert, ist die
Ordnung danach auch auf dem iPhone da — dort entsteht das meiste Chaos,
dort soll es auch verschwinden.

## Einmal einrichten

Beim ersten Lauf fragt macOS, ob das Programm (Terminal oder die Claude-App)
Notizen steuern darf. Bestätigen. Mehr braucht es nicht — im Unterschied zum
Postfach keinen Festplattenvollzugriff, die Skripte reden nur mit Notizen.

## Schritt 1 — Bestandsaufnahme

```bash
osascript -l JavaScript bestandsaufnahme.js --ausgabe .
```

Liest nur, verändert keine Notiz. Bei mehreren hundert Notizen dauert es
ein, zwei Minuten; der Fortschritt läuft ordnerweise durch.

Heraus kommen zwei Dateien:

- **`bericht.md`** — was in welchem Ordner liegt, wann was entstanden ist,
  und vor allem **was drin steckt**: Raptexte, Reimskizzen, Listen,
  Linksammlungen, leere Notizen, Schnipsel. Dazu Dubletten (Kopien vom
  Handy), Notizen ohne Titel und die häufigsten Wörter in Titeln — das sind
  deine Themen und damit Kandidaten für Ordner.
- **`regeln.json`** — dieselben Gruppen als Vorlage, `ziel` noch leer, mit
  der Liste der Notizen, die dazugehören.

### Wie Raptexte erkannt werden

Kein Verfahren versteht den Inhalt. Das Skript schaut auf die Form:

- viele kurze Zeilen (Songzeilen sind kurz, Fließtext kommt aus Notizen als
  wenige sehr lange Zeilen),
- **Reime**: die letzten drei Buchstaben des letzten Worts, verglichen mit der
  nächsten und übernächsten Zeile — Paarreim und Kreuzreim,
- Marken wie `Hook`, `Part 1`, `Refrain`, `Bridge` am Zeilenanfang.

Wer sich reimt und kurz schreibt, ist Raptext. Wer sich nur ein bisschen
reimt, landet unter „Vermutlich Raptexte — vorher prüfen". Vier bis sieben
gereimte Zeilen sind eine „Reimskizze": Punchlines, Hooks, Ideen ohne Song.
Der Bericht zeigt pro Notiz Zeilen und Reimquote, damit du Fehlgriffe siehst,
bevor etwas verschoben wird.

## Schritt 2 — Struktur festlegen

Das ist der eigentliche Aufräumschritt, und den macht kein Skript. Ein
Vorschlag, der zu dem passt, was der Bericht typischerweise findet:

```
Notizen            Posteingang — alles Neue landet hier und wird regelmäßig geleert
Rap/
  Texte            fertige oder in Arbeit befindliche Songs
  Skizzen          Reime, Punchlines, Hooks ohne Song
  Fassungen        ältere Versionen, die du nicht wegwerfen willst
Listen             Einkauf, Packen, Todo — kurzlebig, darf regelmäßig leer sein
Wissen             Recherche, Anleitungen, Links
Projekte/          ein Unterordner pro Vorhaben
Archiv             erledigt, aber nicht weg
```

Grundregeln, damit es so bleibt:

1. **„Notizen" ist der Posteingang**, kein Wohnort. Am Handy schnell
   tippen, am Mac einsortieren — wie beim Postfach.
2. **Erste Zeile ist der Titel.** Notizen nimmt die erste Zeile als
   Überschrift; eine Notiz, die mit dem Text losgeht, heißt später nach
   ihrer ersten Songzeile. Für Raptexte: Titel, Leerzeile, dann Text.
3. **Marken benutzen.** `Hook`, `Part 1`, `Part 2` als eigene Zeilen — das
   hilft dir beim Lesen und dem Skript beim Erkennen.
4. **Fassungen statt Kopien.** Wer einen Text umschreibt, kopiert ihn oft
   erst. Die alte Fassung nach `Rap/Fassungen`, nicht daneben liegen lassen.
5. **Nicht zu tief.** Zwei Ebenen reichen. Was in keinen Ordner passt,
   bleibt in „Notizen" oder geht ins Archiv — ein Ordner „Sonstiges" ist nur
   ein zweiter Posteingang.

Zielordner **in Notizen von Hand anlegen** (Ablage → Neuer Ordner;
Unterordner durch Ziehen auf einen Ordner), dann in `regeln.json` eintragen:

```json
{
  "quelle": "Notizen",
  "hoechstens": 0,
  "regeln": [
    { "name": "Raptexte",     "ziel": "Rap/Texte",   "notizen": [ { "id": "x-coredata://…", "_titel": "Nachts allein" } ] },
    { "name": "Reimskizzen",  "ziel": "Rap/Skizzen", "notizen": [ … ] },
    { "name": "Listen",       "ziel": "Listen",      "notizen": [ … ] },
    { "name": "Links",        "ziel": "Wissen",      "notizen": [ … ] },
    { "name": "Rezepte",      "ziel": "Wissen",      "titel": "Rezept|Kochen" },
    { "name": "Hooks im Text","ziel": "Rap/Texte",   "text": "^\\s*\\[?(Hook|Part \\d)" }
  ]
}
```

Regeln ohne ausgefülltes `ziel` bleiben wirkungslos — leer lassen heißt
schlicht: Finger weg. Aus der Liste einer Regel darfst du einzelne Notizen
streichen, die nicht dazugehören. Die `_`-Felder sind nur Lesehilfe.

Drei Arten, Notizen zu treffen — eine Regel darf mehrere kombinieren:

| Feld | Wirkung |
|---|---|
| `"notizen": [ { "id": … } ]` | genau diese Notizen, egal in welchem Ordner sie liegen |
| `"titel": "Einkauf\|Rezept"` | regulärer Ausdruck auf den Titel, Groß/Klein egal |
| `"text": "Hook\|Refrain"` | regulärer Ausdruck auf den Inhalt |

Muster-Regeln durchsuchen nur den Ordner aus `quelle` (Vorgabe: „Notizen",
der Posteingang). `"quelle": "alle"` durchsucht jeden Ordner. Jede Notiz wird
höchstens einmal verschoben: die erste passende Regel gewinnt, die
Reihenfolge in der Datei zählt.

Optionale Schalter:

| Feld | Wirkung |
|---|---|
| `"hoechstens": 20` | pro Regel höchstens 20 Notizen anfassen — gut für den ersten scharfen Lauf |
| `"konto": "iCloud"` | nur dieses Konto bearbeiten |
| `"ziel": "iCloud/Rap/Texte"` | Ordner mit Kontonamen ansprechen, wenn es ihn in mehreren Konten gibt |

## Schritt 3 — Trockenlauf, dann ausführen

```bash
osascript -l JavaScript aufraeumen.js regeln.json            # zeigt nur an
osascript -l JavaScript aufraeumen.js regeln.json --apply    # verschiebt
```

Der Trockenlauf listet jede Notiz mit Herkunftsordner auf. Erst lesen, dann
scharf schalten. Fehlende Zielordner werden gemeldet, nicht angelegt.

## Was die Skripte nicht tun

- **Nichts löschen.** Es wird ausschließlich verschoben. „Zuletzt gelöscht"
  ist als Ziel gesperrt — dorthin verschieben wäre löschen — und wird auch
  als Quelle nie angefasst. Leere Notizen und Dubletten landen in der
  Vorlage, damit du sie in einen Ordner schieben und dort bewusst von Hand
  löschen kannst.
- **Keine Notiz verändern.** Kein Titel wird gesetzt, kein Text angefasst.
- **Keine gesperrten Notizen anfassen.** Passwortgeschützte Notizen geben
  keinen Inhalt her und werden übersprungen, auch wenn ihre ID in einer
  Regel steht.
- **Keine Inhalte irgendwohin senden.** Bericht und Vorlage liegen nur auf
  deiner Platte; die `.gitignore` hält sie aus dem Repository.
- **Keine Ordner anlegen**, siehe oben.

## Grenzen

- Die Erkennung ist Formsache. Ein Gedicht ist ein „Raptext", ein Text
  ohne Reime und ohne Marken fällt durch. Deshalb der Bericht mit Reimquote,
  deshalb die Vorlage zum Streichen.
- Notizen-IDs (`x-coredata://…`) gelten für diesen Mac. Auf einem anderen
  Rechner passt die Vorlage nicht; dort die Bestandsaufnahme neu laufen
  lassen.
- Verschieben zwischen Konten (iCloud ↔ „Auf meinem Mac") lehnt Notizen
  meist ab. Das Skript meldet den Fehler pro Notiz und macht weiter.
- Der Bericht kennt Anhänge nur als Zahl. Wie viel Platz Fotos und Scans
  brauchen, sagt er nicht.
