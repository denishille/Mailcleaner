#!/usr/bin/env osascript -l JavaScript
//
// Sortiert Nachrichten in Apple Mail anhand von regeln.json in Zielordner.
//
// Verschiebt ausschliesslich — es wird nichts geloescht und nichts geleert.
// Ohne --apply passiert gar nichts, das Skript zeigt nur, was es taete.
//
//   osascript -l JavaScript aufraeumen.js regeln.json
//   osascript -l JavaScript aufraeumen.js regeln.json --apply
//
// Bei IMAP-Konten wie GMX synchronisiert Mail die Verschiebung zum Server,
// die Ordnung ist also auch im Webmailer und auf dem Handy da.

ObjC.import('Foundation');

function liesDatei(pfad) {
  const absolut = $.NSString.alloc.initWithUTF8String(pfad)
    .stringByExpandingTildeInPath;
  const inhalt = $.NSString.stringWithContentsOfFileEncodingError(
    absolut, $.NSUTF8StringEncoding, null
  );
  if (!inhalt || !inhalt.js) throw new Error(`Kann ${pfad} nicht lesen.`);
  return inhalt.js;
}

// Mail liefert Unterordner je nach Kontotyp mal flach mit vollem Pfad, mal
// verschachtelt. Wir sammeln beides ein und merken uns jede Schreibweise.
function sammlePostfaecher(behaelter, praefix, ergebnis) {
  let kinder;
  try {
    kinder = behaelter.mailboxes();
  } catch (e) {
    return ergebnis;
  }
  for (const postfach of kinder) {
    let name;
    try {
      name = postfach.name();
    } catch (e) {
      continue;
    }
    const pfad = praefix ? `${praefix}/${name}` : name;
    ergebnis.push({ pfad: pfad, name: name, objekt: postfach });
    sammlePostfaecher(postfach, pfad, ergebnis);
  }
  return ergebnis;
}

// Der Papierkorb heisst je nach Anbieter und Sprache anders; Mail zeigt
// "Papierkorb", GMX nennt den Ordner "Gelöscht". Alle Schreibweisen gelten.
const PAPIERKORB = ['papierkorb', 'gelöscht', 'gelöschte objekte', 'trash', 'deleted messages'];

// macOS liefert Umlaute in Ordnernamen oft zerlegt (a + Trema), die JSON-Datei
// enthaelt sie zusammengesetzt. Ohne Normalisierung waere "Verträge" nie gleich.
function schluessel(text) {
  return String(text).normalize('NFC').toLowerCase();
}

function findePostfach(postfaecher, gesucht) {
  const ziel = schluessel(gesucht);
  const kandidaten = PAPIERKORB.includes(ziel) ? PAPIERKORB : [ziel];
  for (const name of kandidaten) {
    const treffer =
      postfaecher.find(p => schluessel(p.pfad) === name) ||
      postfaecher.find(p => schluessel(p.name) === name);
    if (treffer) return treffer;
  }
  return null;
}

function run(argv) {
  const Mail = Application('Mail');
  Mail.includeStandardAdditions = true;

  const regelDatei = argv.find(a => !a.startsWith('--')) || 'regeln.json';
  const scharf = argv.includes('--apply');
  const konfiguration = JSON.parse(liesDatei(regelDatei));

  const regeln = (konfiguration.regeln || []).filter(
    r => r.absender && r.ziel && String(r.ziel).trim() !== ''
  );

  const sag = zeile => console.log(zeile);

  if (regeln.length === 0) {
    sag('Keine Regel mit ausgefülltem "ziel" gefunden.');
    sag(`Trage in ${regelDatei} bei den Absendern, die du sortieren willst,`);
    sag('einen Zielordner ein — z. B. "ziel": "Archiv/Newsletter".');
    return;
  }

  sag(scharf ? '=== ES WIRD VERSCHOBEN ===' : '=== TROCKENLAUF (--apply zum Ausführen) ===');
  sag('');

  const konten = Mail.accounts();
  let gesamtTreffer = 0;
  let gesamtVerschoben = 0;
  const fehlendeOrdner = [];

  for (const konto of konten) {
    let kontoName;
    try {
      kontoName = konto.name();
    } catch (e) {
      continue;
    }
    if (konfiguration.konto && konfiguration.konto !== kontoName) continue;

    const postfaecher = sammlePostfaecher(konto, '', []);
    const posteingang = findePostfach(postfaecher, 'INBOX');
    if (!posteingang) {
      sag(`${kontoName}: kein Posteingang gefunden, übersprungen.`);
      continue;
    }

    sag(`--- ${kontoName} ---`);

    for (const regel of regeln) {
      const zielPostfach = findePostfach(postfaecher, regel.ziel);
      if (!zielPostfach) {
        const schluessel = `${kontoName} → ${regel.ziel}`;
        if (!fehlendeOrdner.includes(schluessel)) fehlendeOrdner.push(schluessel);
        continue;
      }

      // Erst alle Treffer einsammeln. Waehrend des Verschiebens aendert sich
      // der Postfachinhalt, eine live durchlaufene Liste verliert Eintraege.
      let treffer;
      try {
        treffer = posteingang.objekt.messages.whose({
          sender: { _contains: regel.absender },
        })();
      } catch (e) {
        sag(`  ${regel.absender}: Suche fehlgeschlagen (${e.message})`);
        continue;
      }

      if (treffer.length === 0) continue;
      gesamtTreffer += treffer.length;

      const grenze = regel.hoechstens || konfiguration.hoechstens || 0;
      const zuVerschieben = grenze > 0 ? treffer.slice(0, grenze) : treffer;
      const hinweis = zuVerschieben.length < treffer.length
        ? ` (von ${treffer.length}, begrenzt)` : '';

      const wort = zuVerschieben.length === 1 ? 'Mail' : 'Mails';
      sag(`  ${regel.absender} → ${regel.ziel}: ${zuVerschieben.length} ${wort}${hinweis}`);

      if (!scharf) continue;

      let verschoben = 0;
      for (const nachricht of zuVerschieben) {
        try {
          Mail.move(nachricht, { to: zielPostfach.objekt });
          verschoben += 1;
        } catch (e) {
          sag(`    Fehler bei einer Nachricht: ${e.message}`);
        }
      }
      gesamtVerschoben += verschoben;
      if (verschoben !== zuVerschieben.length) {
        sag(`    ${verschoben} von ${zuVerschieben.length} verschoben.`);
      }
    }
    sag('');
  }

  if (fehlendeOrdner.length > 0) {
    sag('Diese Zielordner gibt es noch nicht — in Mail anlegen (Postfach > Neues Postfach):');
    for (const eintrag of fehlendeOrdner) sag(`  ${eintrag}`);
    sag('');
    sag('Das Skript legt bewusst keine Ordner an: wie deine Struktur aussieht,');
    sag('entscheidest du, nicht das Skript.');
    sag('');
  }

  sag(scharf
    ? `Fertig. ${gesamtVerschoben} Nachrichten verschoben.`
    : `${gesamtTreffer} Nachrichten würden verschoben. Nichts verändert.`);

  // Kein Rueckgabewert: osascript wuerde ihn sonst noch einmal ausgeben,
  // und die ganze Ausgabe erschiene doppelt.
}
