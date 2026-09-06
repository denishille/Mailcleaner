#!/usr/bin/env osascript -l JavaScript
//
// Sortiert Notizen in Apple Notizen anhand von regeln.json in Zielordner.
//
// Verschiebt ausschliesslich — es wird nichts geloescht, nichts geleert und
// keine Notiz veraendert. Ohne --apply passiert gar nichts, das Skript zeigt
// nur, was es taete.
//
//   osascript -l JavaScript aufraeumen.js regeln.json
//   osascript -l JavaScript aufraeumen.js regeln.json --apply
//
// Eine Regel braucht ein "ziel" (Ordnername oder Pfad wie "Rap/Texte") und
// mindestens eines davon:
//
//   "notizen": [ { "id": "..." }, ... ]   genau diese Notizen (aus bestandsaufnahme.js)
//   "titel":   "Einkauf|Rezept"           regulaerer Ausdruck auf den Titel
//   "text":    "Hook|Refrain"             regulaerer Ausdruck auf den Inhalt
//
// Muster-Regeln durchsuchen nur den Ordner aus "quelle" (Vorgabe: "Notizen",
// also den Standardordner, in dem alles Neue landet). "quelle": "alle"
// durchsucht jeden Ordner. Notizen-Listen gelten unabhaengig davon.
//
// Bei iCloud-Konten synchronisiert Notizen die Verschiebung, die Ordnung ist
// also auch auf dem Handy da.

ObjC.import('Foundation');

function liesDatei(pfad) {
  const absolut = $.NSString.alloc.initWithUTF8String(pfad).stringByExpandingTildeInPath;
  const inhalt = $.NSString.stringWithContentsOfFileEncodingError(absolut, $.NSUTF8StringEncoding, null);
  if (!inhalt || !inhalt.js) throw new Error(`Kann ${pfad} nicht lesen.`);
  return inhalt.js;
}

// "Zuletzt gelöscht" ist tabu: weder Quelle noch Ziel. Dorthin verschieben
// hiesse loeschen.
const PAPIERKORB = ['zuletzt gelöscht', 'recently deleted'];

// macOS liefert Umlaute in Ordnernamen oft zerlegt (a + Trema), die JSON-Datei
// enthaelt sie zusammengesetzt. Ohne Normalisierung waere "Gedächtnis" nie gleich.
function schluessel(text) {
  return String(text || '').normalize('NFC').toLowerCase().trim();
}

// Ordner koennen verschachtelt sein. Wir merken uns jeden mit vollem Pfad.
function sammleOrdner(behaelter, praefix, konto, ergebnis) {
  let kinder;
  try {
    kinder = behaelter.folders();
  } catch (e) {
    return ergebnis;
  }
  for (const ordner of kinder) {
    let name, id;
    try {
      name = ordner.name();
      id = ordner.id();
    } catch (e) {
      continue;
    }
    const pfad = praefix ? `${praefix}/${name}` : name;
    ergebnis.push({
      id: id,
      pfad: pfad,
      name: name,
      konto: konto,
      objekt: ordner,
      papierkorb: PAPIERKORB.includes(schluessel(name)),
    });
    sammleOrdner(ordner, pfad, konto, ergebnis);
  }
  return ergebnis;
}

// Sucht einen Ordner: erst als Pfad ("Rap/Texte"), dann als blosser Name.
// Gibt es ihn in mehreren Konten, entscheidet "konto" in regeln.json, sonst
// das Konto, aus dem die Notiz kommt, sonst der erste Treffer.
function findeOrdner(ordnerListe, gesucht, bevorzugtesKonto) {
  const ziel = schluessel(gesucht).replace(/^\/+|\/+$/g, '');
  const treffer = ordnerListe.filter(o => !o.papierkorb && (
    schluessel(o.pfad) === ziel ||
    schluessel(`${o.konto}/${o.pfad}`) === ziel ||
    schluessel(o.name) === ziel
  ));
  if (treffer.length === 0) return null;
  // Pfadtreffer vor Namenstreffer, dann das bevorzugte Konto.
  treffer.sort((a, b) => {
    const pa = schluessel(a.pfad) === ziel || schluessel(`${a.konto}/${a.pfad}`) === ziel ? 0 : 1;
    const pb = schluessel(b.pfad) === ziel || schluessel(`${b.konto}/${b.pfad}`) === ziel ? 0 : 1;
    if (pa !== pb) return pa - pb;
    const ka = a.konto === bevorzugtesKonto ? 0 : 1;
    const kb = b.konto === bevorzugtesKonto ? 0 : 1;
    return ka - kb;
  });
  return treffer[0];
}

function istPapierkorbZiel(gesucht) {
  const ziel = schluessel(gesucht).split('/').pop();
  return PAPIERKORB.includes(ziel);
}

function alsRegex(muster, feld, sag) {
  if (!muster) return null;
  try {
    return new RegExp(muster, 'i');
  } catch (e) {
    sag(`  "${feld}": "${muster}" ist kein gültiger regulärer Ausdruck (${e.message}), Regel übersprungen.`);
    return undefined;
  }
}

// Alle Notizen eines Ordners mit dem, was zum Pruefen einer Regel noetig ist.
// Ein Aufruf pro Eigenschaft, nicht pro Notiz — sonst dauert es bei vielen
// Notizen ewig.
function liesOrdner(ordner, mitText, sag) {
  const sammlung = ordner.objekt.notes;
  let ids, namen, gesperrt, texte;
  try {
    ids = sammlung.id();
    namen = sammlung.name();
  } catch (e) {
    sag(`  ${ordner.pfad}: nicht lesbar (${e.message}), übersprungen.`);
    return [];
  }
  try {
    gesperrt = sammlung.passwordProtected();
  } catch (e) {
    gesperrt = ids.map(() => false);
  }
  if (mitText) {
    try {
      texte = sammlung.plaintext();
    } catch (e) {
      texte = ids.map(() => '');
    }
  }
  const ergebnis = [];
  for (let i = 0; i < ids.length; i += 1) {
    ergebnis.push({
      id: ids[i],
      titel: namen[i] || '',
      text: mitText ? (texte[i] || '') : '',
      gesperrt: Boolean(gesperrt[i]),
      ordner: ordner,
    });
  }
  return ergebnis;
}

function run(argv) {
  const Notes = Application('Notes');

  const regelDatei = argv.find(a => !a.startsWith('--')) || 'regeln.json';
  const scharf = argv.includes('--apply');
  const konfiguration = JSON.parse(liesDatei(regelDatei));

  const sag = zeile => console.log(zeile);

  const regeln = (konfiguration.regeln || []).filter(r =>
    r.ziel && String(r.ziel).trim() !== '' &&
    ((Array.isArray(r.notizen) && r.notizen.length > 0) || r.titel || r.text)
  );

  if (regeln.length === 0) {
    sag('Keine Regel mit ausgefülltem "ziel" gefunden.');
    sag(`Trage in ${regelDatei} bei den Gruppen, die du sortieren willst,`);
    sag('einen Zielordner ein — z. B. "ziel": "Rap/Texte".');
    return;
  }

  sag(scharf ? '=== ES WIRD VERSCHOBEN ===' : '=== TROCKENLAUF (--apply zum Ausführen) ===');
  sag('');

  const ordnerListe = [];
  for (const konto of Notes.accounts()) {
    let kontoName;
    try {
      kontoName = konto.name();
    } catch (e) {
      continue;
    }
    if (konfiguration.konto && konfiguration.konto !== kontoName) continue;
    sammleOrdner(konto, '', kontoName, ordnerListe);
  }
  const ordnerNachId = new Map(ordnerListe.map(o => [o.id, o]));

  // Quellordner fuer Muster-Regeln.
  const quelle = konfiguration.quelle || 'Notizen';
  let quellOrdner;
  if (schluessel(quelle) === 'alle') {
    quellOrdner = ordnerListe.filter(o => !o.papierkorb);
  } else {
    const gesucht = schluessel(quelle);
    quellOrdner = ordnerListe.filter(o => !o.papierkorb && (schluessel(o.pfad) === gesucht || schluessel(o.name) === gesucht));
    if (quellOrdner.length === 0) {
      sag(`Quellordner "${quelle}" nicht gefunden — Muster-Regeln finden nichts. ("quelle": "alle" durchsucht jeden Ordner.)`);
      sag('');
    }
  }
  // Jeder Quellordner wird nur einmal gelesen — mit Inhalt, sobald irgendeine
  // Regel im Text sucht.
  const brauchtText = regeln.some(r => r.text);
  const quellInhalt = new Map(); // ordner.id -> Notizen

  let gesamtTreffer = 0;
  let gesamtVerschoben = 0;
  const fehlendeOrdner = [];
  const bearbeitet = new Set(); // jede Notiz hoechstens einmal, erste Regel gewinnt

  for (const regel of regeln) {
    const name = regel.name || regel.titel || regel.text || regel.ziel;

    if (istPapierkorbZiel(regel.ziel)) {
      sag(`${name}: Ziel "${regel.ziel}" ist der Papierkorb — Verschieben dorthin wäre Löschen, übersprungen.`);
      continue;
    }

    const titelRegex = alsRegex(regel.titel, 'titel', sag);
    const textRegex = alsRegex(regel.text, 'text', sag);
    if (titelRegex === undefined || textRegex === undefined) continue;

    // Kandidaten einsammeln, bevor irgendetwas verschoben wird.
    const kandidaten = [];

    for (const eintrag of regel.notizen || []) {
      const id = typeof eintrag === 'string' ? eintrag : eintrag && eintrag.id;
      if (!id) continue;
      let notiz, titel, gesperrt, behaelter;
      try {
        notiz = Notes.notes.byId(id);
        titel = notiz.name();
        gesperrt = notiz.passwordProtected();
        behaelter = notiz.container();
      } catch (e) {
        sag(`  Notiz ${id} nicht gefunden (gelöscht?), übersprungen.`);
        continue;
      }
      let ordner = null;
      try {
        ordner = ordnerNachId.get(behaelter.id()) || null;
      } catch (e) {
        ordner = null;
      }
      if (ordner && ordner.papierkorb) continue; // liegt in "Zuletzt gelöscht"
      kandidaten.push({ id: id, titel: titel, gesperrt: gesperrt, ordner: ordner, objekt: notiz });
    }

    if (titelRegex || textRegex) {
      for (const ordner of quellOrdner) {
        if (!quellInhalt.has(ordner.id)) quellInhalt.set(ordner.id, liesOrdner(ordner, brauchtText, sag));
        for (const n of quellInhalt.get(ordner.id)) {
          const passtTitel = titelRegex ? titelRegex.test(n.titel) : true;
          const passtText = textRegex ? textRegex.test(n.text) : true;
          if (passtTitel && passtText) kandidaten.push({ ...n, objekt: null });
        }
      }
    }

    // Zielordner bestimmen: im Konto der ersten Notiz, falls es ihn dort gibt.
    const ersteMitOrdner = kandidaten.find(k => k.ordner);
    const bevorzugtesKonto = konfiguration.konto || (ersteMitOrdner ? ersteMitOrdner.ordner.konto : undefined);
    const ziel = findeOrdner(ordnerListe, regel.ziel, bevorzugtesKonto);
    if (!ziel) {
      if (!fehlendeOrdner.includes(regel.ziel)) fehlendeOrdner.push(regel.ziel);
      continue;
    }

    let uebersprungen = { gesperrt: 0, schonDa: 0, doppelt: 0 };
    const zuVerschieben = [];
    for (const k of kandidaten) {
      if (bearbeitet.has(k.id)) { uebersprungen.doppelt += 1; continue; }
      bearbeitet.add(k.id);
      if (k.gesperrt) { uebersprungen.gesperrt += 1; continue; }
      if (k.ordner && k.ordner.id === ziel.id) { uebersprungen.schonDa += 1; continue; }
      zuVerschieben.push(k);
    }

    if (zuVerschieben.length === 0 && kandidaten.length === 0) continue;
    gesamtTreffer += zuVerschieben.length;

    const grenze = regel.hoechstens || konfiguration.hoechstens || 0;
    const begrenzt = grenze > 0 ? zuVerschieben.slice(0, grenze) : zuVerschieben;

    const hinweise = [];
    if (begrenzt.length < zuVerschieben.length) hinweise.push(`von ${zuVerschieben.length}, begrenzt`);
    if (uebersprungen.schonDa) hinweise.push(`${uebersprungen.schonDa} schon dort`);
    if (uebersprungen.gesperrt) hinweise.push(`${uebersprungen.gesperrt} gesperrt, nicht angefasst`);
    if (uebersprungen.doppelt) hinweise.push(`${uebersprungen.doppelt} schon durch frühere Regel`);
    const zusatz = hinweise.length ? ` (${hinweise.join(', ')})` : '';

    const wort = begrenzt.length === 1 ? 'Notiz' : 'Notizen';
    sag(`${name} → ${ziel.konto}/${ziel.pfad}: ${begrenzt.length} ${wort}${zusatz}`);
    for (const k of begrenzt) {
      const von = k.ordner ? k.ordner.pfad : '?';
      sag(`    ${von}: ${(k.titel || '(ohne Titel)').slice(0, 70)}`);
    }

    if (!scharf) { sag(''); continue; }

    let verschoben = 0;
    for (const k of begrenzt) {
      try {
        const objekt = k.objekt || Notes.notes.byId(k.id);
        Notes.move(objekt, { to: ziel.objekt });
        verschoben += 1;
      } catch (e) {
        sag(`    Fehler bei „${(k.titel || '').slice(0, 40)}": ${e.message}`);
      }
    }
    gesamtVerschoben += verschoben;
    if (verschoben !== begrenzt.length) sag(`    ${verschoben} von ${begrenzt.length} verschoben.`);
    sag('');
  }

  if (fehlendeOrdner.length > 0) {
    sag('Diese Zielordner gibt es noch nicht — in Notizen anlegen (Ablage > Neuer Ordner,');
    sag('Unterordner per Ziehen auf einen Ordner):');
    for (const eintrag of fehlendeOrdner) sag(`  ${eintrag}`);
    sag('');
    sag('Das Skript legt bewusst keine Ordner an: wie deine Struktur aussieht,');
    sag('entscheidest du, nicht das Skript.');
    sag('');
  }

  if (scharf) {
    sag(`Fertig. ${gesamtVerschoben} ${gesamtVerschoben === 1 ? 'Notiz' : 'Notizen'} verschoben.`);
  } else {
    sag(gesamtTreffer === 1
      ? '1 Notiz würde verschoben. Nichts verändert.'
      : `${gesamtTreffer} Notizen würden verschoben. Nichts verändert.`);
  }

  // Kein Rueckgabewert: osascript wuerde ihn sonst noch einmal ausgeben,
  // und die ganze Ausgabe erschiene doppelt.
}
