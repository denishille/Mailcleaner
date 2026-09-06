# Aufräumen — Postfach und Notizen

Zwei Werkzeugkästen nach demselben Muster: erst eine Bestandsaufnahme, die
nur liest, dann eine Regeldatei, in der du die Struktur festlegst, dann ein
Trockenlauf und erst danach das Verschieben. Nichts wird gelöscht, nichts
verlässt den Mac.

- **Postfach** (Apple Mail und GMX) — dieses Verzeichnis, Anleitung unten.
- **Notizen** (Apple Notizen, Raptexte sortieren) — [`notizen/`](notizen/README.md).

---

# Postfach aufräumen — Apple Mail und GMX

Zwei Skripte, um den Posteingang zu durchleuchten und nach eigenen Regeln zu
sortieren. Beides läuft **lokal auf dem Mac**, ohne Zugangsdaten, ohne Cloud,
ohne Konto bei irgendwem.

## Warum über Apple Mail und nicht direkt über GMX

GMX hat keine API, nur IMAP mit App-Passwort. Ist das GMX-Konto in Apple Mail
eingerichtet — was es üblicherweise ist —, dann kommt man über Apple Mail an
dieselben Mails, **ohne irgendwo ein Passwort zu hinterlegen**. Jedes
Verschieben synchronisiert Mail per IMAP zu GMX zurück, die Ordnung ist also
auch im Webmailer und auf dem Handy da.

## Einmal einrichten

Beide Berechtigungen setzt macOS, nicht das Skript:

1. **Festplattenvollzugriff** für das Programm, aus dem du die Skripte startest
   (Terminal oder die Claude-App): Systemeinstellungen → Datenschutz &
   Sicherheit → Festplattenvollzugriff. Danach das Programm **neu starten** —
   ohne Neustart greift die Freigabe nicht. Nötig, um den Mail-Index zu lesen.
2. **Automation**: Beim ersten Lauf von `aufraeumen.js` fragt macOS, ob das
   Programm Mail steuern darf. Bestätigen.

## Schritt 1 — Bestandsaufnahme

```bash
python3 bestandsaufnahme.py --ausgabe .
```

Liest nur, verändert nichts, startet Mail nicht einmal. Läuft Mail gerade,
arbeitet das Skript auf einer Kopie des Index.

Heraus kommen zwei Dateien:

- **`bericht.md`** — wie viele Mails wo liegen, Verteilung über die Jahre, die
  größten Absender, und die Aufräum-Kandidaten: Absender mit vielen Mails, von
  denen du die meisten nie geöffnet hast. Das sind fast immer Newsletter und
  Benachrichtigungen, und meist der Löwenanteil des Postfachs.
- **`regeln.json`** — dieselben Kandidaten als Vorlage, `ziel` noch leer.

## Schritt 2 — Struktur festlegen

Zielordner **in Mail von Hand anlegen** (Postfach → Neues Postfach), dann in
`regeln.json` eintragen, welcher Absender wohin soll:

```json
{
  "hoechstens": 0,
  "regeln": [
    { "absender": "newsletter@beispiel.de",   "ziel": "Archiv/Newsletter" },
    { "absender": "no-reply@plugin-shop.com", "ziel": "Archiv/Plugins" }
  ]
}
```

Absender ohne ausgefülltes `ziel` bleiben, wo sie sind — leer lassen heißt
also schlicht: Finger weg. Die `_mails`- und `_ungelesen_prozent`-Felder aus
der Vorlage sind nur Entscheidungshilfe und dürfen stehen bleiben.

Optionale Schalter:

| Feld | Wirkung |
|---|---|
| `"hoechstens": 50` | pro Regel höchstens 50 Mails anfassen — gut für den ersten scharfen Lauf |
| `"konto": "GMX"` | nur dieses eine Konto bearbeiten |

## Schritt 3 — Trockenlauf, dann ausführen

```bash
osascript -l JavaScript aufraeumen.js regeln.json            # zeigt nur an
osascript -l JavaScript aufraeumen.js regeln.json --apply    # verschiebt
```

Ohne `--apply` passiert nichts. Erst den Trockenlauf lesen, dann scharf
schalten.

Fehlende Zielordner werden gemeldet, nicht angelegt: wie deine Struktur
aussieht, entscheidest du.

## Was die Skripte nicht tun

- **Nichts löschen.** Es wird ausschließlich verschoben. Kein Papierkorb, kein
  Leeren, keine Regel, die etwas endgültig entfernt. Willst du wirklich etwas
  loswerden, verschieb es erst in einen Ordner und lösch den bewusst von Hand.
- **Keine Mail-Inhalte irgendwohin senden.** Beide Skripte laufen offline; das
  Analyseskript stellt keine einzige Netzverbindung her.
- **Keine Ordner anlegen**, siehe oben.
- **Keine Mail-Regeln in Mail anlegen.** Bestehende Regeln bleiben unberührt.

## Grenzen

- Das Analyseskript liest Apple Mails Envelope-Index. Dessen Schema ändert sich
  zwischen macOS-Versionen; das Skript erkennt vorhandene Spalten zur Laufzeit
  und nimmt den jeweils neuesten `V*`-Ordner. Bei einer künftigen Umstellung
  kann es trotzdem klemmen — dann meldet es das, statt falsche Zahlen zu zeigen.
- Der Index kennt nur, was Mail lokal indexiert hat. Postfächer, die auf
  „nur Kopfzeilen laden" stehen, sind vollständig dabei; auf dem Server
  archivierte Ordner, die Mail nie geöffnet hat, fehlen.
- `aufraeumen.js` durchsucht nur den Posteingang, keine Unterordner. Aufräumen
  heißt hier: Posteingang leeren.
- Bei mehreren tausend Treffern dauert das Verschieben spürbar — Mail wird
  einzeln pro Nachricht angesprochen. `hoechstens` hilft beim ersten Lauf.
